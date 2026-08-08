/**
 * The M2.1 application-layer derived resolver.
 *
 * This is the only component that produces authoritative derived character
 * values. Repositories never calculate; UI never calculates. The resolver reads
 * durable build state, runtime state, typed overrides and content, calls the
 * pure M1.4 rules evaluation through `deriveCharacterState`, and returns an
 * immutable sheet with an explanation trace.
 *
 * Two rules shape every value:
 *
 * 1. An unknown required input resolves to `null`, which the UI renders as `—`
 *    together with a recovery action. It never becomes zero or a guess (D-03).
 * 2. Overrides are applied only after the automatic baseline is recalculated,
 *    and only against an allow-listed target path (D-04). No stored string is
 *    ever evaluated.
 */
import { z } from "zod";
import type {
  CharacterOverrideRecord,
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CompletenessClass,
} from "@/src/domain/character-record";
import { ABILITIES, isAllowedTargetPath } from "@/src/domain/character-record";
import type { Ability, Character, ContentEntry, ID, RulesetProfile } from "@/src/domain/model";
import { deriveCharacterState, type DerivedCharacterState } from "@/src/rules/derive-character";
import { NO_ARMOR_RESOLUTION } from "@/src/rules/armor-context";
import { abilityModifier, proficiencyBonus } from "@/src/rules/engine";
import { maximumHitPointsFor } from "@/src/rules/hit-points";
import { spellIsRitual } from "@/src/services/spell-list-index";
import {
  hitDieForClass,
  masteryWeaponRelations,
  proficiencyCatalog,
  scopeEntriesToRuleset,
} from "@/src/services/content-scope";

export const UNKNOWN_DISPLAY = "—";

/** Why a value could not be calculated, plus the action that would resolve it. */
export interface RecoveryAction {
  code:
    | "ABILITY_SCORE_MISSING"
    | "CLASS_MISSING"
    | "SPECIES_MISSING"
    | "ARMOUR_UNRESOLVED"
    | "RESOURCE_MAXIMUM_UNKNOWN"
    | "ACTION_DEFINITION_MISSING"
    | "MANUAL_VALUE_MISSING"
    | "SOURCE_MISSING";
  /** Non-sensitive field path, never a private value. */
  fieldPath: string;
  /** Short imperative label for the recovery control. */
  action: string;
}

export type ContributorKind =
  | "base"
  | "ability"
  | "proficiency"
  | "equipment"
  | "feature"
  | "species"
  | "manual"
  | "override";

/** One explained input to a derived value. Labels are public/synthetic only. */
export interface Contributor {
  kind: ContributorKind;
  label: string;
  amount?: number;
  entryId?: ID;
  sourceId?: ID;
}

export interface DerivedValue<T = number> {
  /** `null` is an unknown required input. The UI shows `—` plus `recovery`. */
  value: T | null;
  contributors: readonly Contributor[];
  recovery?: RecoveryAction;
  /** Present when a typed override changed the automatic result. */
  override?: {
    operation: "replace" | "add";
    value: number;
    automaticBaseline: number | null;
    stale: boolean;
  };
}

export interface DerivedProficiencyEntry {
  id: ID;
  label: string;
  ability: Ability;
  proficient: boolean;
  total: DerivedValue;
}

export interface DerivedAction {
  id: ID;
  label: string;
  kind: "attack" | "action" | "bonus-action" | "reaction";
  attackBonus: DerivedValue;
  /** Accessible roll expression, e.g. `1d20 + 5`. Never rolled by M2.1 (D-08). */
  attackExpression: string | null;
  damageExpression: string | null;
  damageContributors: readonly Contributor[];
  range?: string;
  masteryId?: ID;
}

export interface DerivedResource {
  id: ID;
  label: string;
  maximum: DerivedValue;
  current: DerivedValue;
  recharge: string;
}

export interface DerivedEquipmentItem {
  itemId: ID;
  label: string;
  quantity: number;
  status: "granted" | "carried" | "equipped";
  /** Numeric contribution to armour class, when the item provides one. */
  armorContribution?: number;
}

/** A granted feature, trait or feat, with its public/synthetic summary. */
export interface DerivedFeature {
  id: ID;
  label: string;
  summary?: string;
  group: "class" | "species" | "background";
}

/** A non-skill, non-save proficiency the build grants. */
export interface DerivedOtherProficiency {
  id: ID;
  label: string;
  type: "armor" | "weapon" | "tool" | "language";
}

export interface DerivedSpell {
  id: ID;
  label: string;
  summary?: string;
  level: number;
  school?: string;
  castingTime?: string;
  range?: string;
  duration?: string;
  concentration: boolean;
  /**
   * Castable as a ritual. Metadata the content declares, not a rule this sheet
   * enforces; a spell written before the field existed reads as `false`.
   */
  ritual: boolean;
}

/**
 * The declarative casting summary, present only when the ruleset content
 * declares one for a class this character has. Nothing here is guessed: the
 * attack and save numbers exist only when the declaration provides the inputs.
 */
export interface DerivedSpellcasting {
  abilityLabel: string;
  spellAttack: DerivedValue | null;
  saveDc: DerivedValue | null;
  /** Resource IDs (already present in `resources`) that act as spell slots. */
  slotResourceIds: readonly ID[];
  spells: readonly DerivedSpell[];
}

export interface SanitizedIssue {
  code: string;
  severity: "error" | "warning" | "info";
  /** Stable record ID only. */
  recordId?: ID;
  fieldPath?: string;
}

/**
 * A value creation finished but the installed content or runtime cannot
 * calculate. Carries the user-facing concept so the sheet can name what is
 * affected without the UI parsing an ID out of the field path.
 */
export interface UnavailableValue {
  fieldPath: string;
  /** The concept as the user knows it, never an ID. */
  label: string;
}

export interface DerivedCharacterSheet {
  characterId: ID;
  characterRevision: number;
  runtimeRevision: number | null;
  /** Safe fallback when the user has not named the character. */
  name: string;
  nickname?: string;
  level: number;
  classLabel: string | null;
  /** Named on the sheet whenever the committed class level carries a subclass. */
  subclassLabel: string | null;
  speciesLabel: string | null;
  backgroundLabel: string | null;
  /** `automatic` claims rules justification; `manual` never does (D-03). */
  mode: "automatic" | "manual";
  completeness: CompletenessClass;
  renderable: boolean;
  abilities: Readonly<Record<Ability, { score: DerivedValue; modifier: DerivedValue }>>;
  proficiencyBonus: DerivedValue;
  hitPoints: { maximum: DerivedValue; current: DerivedValue; temporary: number };
  hitDice: DerivedValue<string>;
  armorClass: DerivedValue;
  initiative: DerivedValue;
  speed: DerivedValue;
  saves: readonly DerivedProficiencyEntry[];
  checks: readonly DerivedProficiencyEntry[];
  actions: readonly DerivedAction[];
  resources: readonly DerivedResource[];
  equipment: readonly DerivedEquipmentItem[];
  features: readonly DerivedFeature[];
  otherProficiencies: readonly DerivedOtherProficiency[];
  /** Present only when the content declares spellcasting for this character. */
  spellcasting?: DerivedSpellcasting;
  conditions: readonly { conditionId: ID; label: string; summary?: string }[];
  /** Conditions this character's ruleset can track, for the add-condition list. */
  availableConditions: readonly { id: ID; label: string; summary?: string }[];
  /** Session state surfaced for the glance header. */
  hitDiceRemaining: number | null;
  exhaustion: number;
  deathSaves: { readonly successes: number; readonly failures: number };
  inspiration: boolean;
  activeRulesetId: ID;
  activeRulesetLabel: string | null;
  activeSourceIds: readonly ID[];
  issues: readonly SanitizedIssue[];
  /**
   * Values the content or runtime could not calculate. Non-empty does not mean
   * the build is unfinished: creation may owe nothing and this still be set.
   */
  unavailableValues: readonly UnavailableValue[];
  missingDependencyIds: readonly ID[];
  staleOverrideIds: readonly ID[];
  contentFingerprint: string;
  confidence: "calculated" | "uncertain";
}

/** Boundary schema for the declarative action metadata. Nothing is evaluated. */
const actionDefinitionSchema = z
  .object({
    actionKind: z.enum(["attack", "action", "bonus-action", "reaction"]),
    usage: z.string().max(40).optional(),
    ability: z.enum(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]).optional(),
    proficient: z.boolean().default(false),
    weaponId: z.string().max(160).optional(),
    damageDice: z.string().regex(/^\d{1,2}d\d{1,3}$/).optional(),
    damageType: z.string().max(40).optional(),
    range: z.string().max(40).optional(),
  })
  .passthrough();

/** Boundary schema for a declarative spellcasting rule. Nothing is evaluated. */
const spellcastingDeclarationSchema = z
  .object({
    classId: z.string().max(160),
    ability: z.enum(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]),
    attackProficient: z.boolean().default(false),
    saveDcBase: z.number().int().min(0).max(30).optional(),
    slotResourceIds: z.array(z.string().max(160)).default([]),
  })
  .passthrough();

/** Loose boundary read of stored spell mechanics; absent fields stay absent. */
const spellMechanicsDisplaySchema = z
  .object({
    level: z.number().int().min(0).max(9),
    school: z.string().max(40).optional(),
    castingTime: z.object({ amount: z.number(), unit: z.string().max(20) }).passthrough().optional(),
    duration: z
      .object({ type: z.string().max(20), amount: z.number().optional(), unit: z.string().max(20).optional(), concentration: z.boolean() })
      .passthrough()
      .optional(),
    range: z
      .object({ type: z.string().max(20), distance: z.number().optional(), unit: z.string().max(20).optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const capitalize = (value: string) => (value ? `${value[0].toUpperCase()}${value.slice(1)}` : value);

const known = (value: number, contributors: Contributor[]): DerivedValue => ({ value, contributors });
const unknown = (recovery: RecoveryAction, contributors: Contributor[] = []): DerivedValue => ({
  value: null,
  contributors,
  recovery,
});

/** Deterministic fingerprint over the content and ruleset a sheet was resolved against. */
export function computeContentFingerprint(entries: readonly ContentEntry[], rulesetId: ID): string {
  const parts = entries
    .map(item => `${item.id}@${item.version}#${item.revision}`)
    .sort((left, right) => left.localeCompare(right));
  let hash = 0x811c9dc5;
  for (const character of `${rulesetId}|${parts.join("|")}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fp1:${entries.length}:${hash.toString(16).padStart(8, "0")}`;
}

/** Projects durable M2.1 state onto the legacy shape the pure rules engine consumes. */
export function toRuleCharacter(record: CharacterRecord, abilities: Record<Ability, number>): Character {
  return {
    id: record.id,
    name: record.name,
    level: record.level,
    advancement: "milestone",
    classLevels: record.classLevels.map(item => ({ ...item })),
    ...(record.speciesId ? { speciesId: record.speciesId } : {}),
    ...(record.backgroundId ? { backgroundId: record.backgroundId } : {}),
    rulesetProfileId: record.rulesetProfileId,
    abilities,
    baseHitPoints: 0,
    currentHitPoints: 0,
    temporaryHitPoints: 0,
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0 },
    selections: [],
    biography: {},
    tags: [...record.tags],
    status: record.status === "archived" ? "archived" : "active",
    kind: "player-character",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function applyOverride(
  base: DerivedValue,
  targetPath: string,
  overrides: readonly CharacterOverrideRecord[],
  staleIds?: Set<ID>,
): DerivedValue {
  const override = overrides.find(item => item.targetPath === targetPath);
  if (!override) return base;
  // Defence in depth: a stored path is re-checked against the allow-list before use.
  if (!isAllowedTargetPath(override.targetPath)) return base;
  // A target that can no longer be calculated marks the override stale for review
  // rather than executing it blindly (D-04).
  if (base.value === null) {
    staleIds?.add(override.id);
    return { ...base, override: { operation: override.operation, value: override.value, automaticBaseline: override.automaticBaseline, stale: true } };
  }
  const applied = override.operation === "replace" ? override.value : base.value + override.value;
  const stale = override.automaticBaseline !== null && override.automaticBaseline !== base.value;
  // Stale is reported from one source of truth: a recalculated baseline that
  // moved counts even when the stored record still says "active".
  if (stale) staleIds?.add(override.id);
  return {
    value: applied,
    contributors: [
      ...base.contributors,
      {
        kind: "override",
        label: override.operation === "replace" ? "Manual override (replaces automatic value)" : "Manual override",
        amount: override.operation === "add" ? override.value : undefined,
      },
    ],
    override: { operation: override.operation, value: override.value, automaticBaseline: override.automaticBaseline, stale },
  };
}

export interface ResolveInput {
  character: CharacterRecord;
  runtime?: CharacterRuntimeStateRecord;
  overrides?: readonly CharacterOverrideRecord[];
  entries: readonly ContentEntry[];
  ruleset?: RulesetProfile;
}

export function resolveDerivedCharacter(input: ResolveInput): DerivedCharacterSheet {
  const { character, runtime } = input;
  const overrides = input.overrides ?? [];
  // A character resolves against its own ruleset's active sources, so content
  // installed for another ruleset cannot alter this sheet.
  const entries = scopeEntriesToRuleset(input.entries, input.ruleset);
  const byId = new Map(entries.map(item => [item.id, item]));
  const issues: SanitizedIssue[] = [];
  const missingDependencyIds = new Set<ID>();
  /** Overrides whose recalculated baseline no longer matches the stored one. */
  const detectedStaleOverrideIds = new Set<ID>();
  const label = (id: ID | undefined): string | null => (id ? byId.get(id)?.name ?? null : null);

  const classSelection = character.classLevels[0];
  const classEntry = classSelection ? byId.get(classSelection.classId) : undefined;
  if (classSelection && !classEntry) {
    missingDependencyIds.add(classSelection.classId);
    issues.push({ code: "CLASS_SOURCE_MISSING", severity: "error", recordId: classSelection.classId });
  }
  if (classSelection?.subclassId && !byId.get(classSelection.subclassId)) {
    missingDependencyIds.add(classSelection.subclassId);
    issues.push({ code: "SUBCLASS_SOURCE_MISSING", severity: "error", recordId: classSelection.subclassId });
  }
  if (character.speciesId && !byId.get(character.speciesId)) {
    missingDependencyIds.add(character.speciesId);
    issues.push({ code: "SPECIES_SOURCE_MISSING", severity: "error", recordId: character.speciesId });
  }
  if (character.backgroundId && !byId.get(character.backgroundId)) {
    missingDependencyIds.add(character.backgroundId);
    issues.push({ code: "BACKGROUND_SOURCE_MISSING", severity: "error", recordId: character.backgroundId });
  }

  // A character with no class opens only as a Manual character sheet (D-03).
  const mode: "automatic" | "manual" = classSelection && classEntry ? "automatic" : "manual";
  const manual = character.manualValues;

  // ---- abilities -----------------------------------------------------------
  const abilityScores: Partial<Record<Ability, number>> = {};
  const abilities = {} as Record<Ability, { score: DerivedValue; modifier: DerivedValue }>;
  for (const ability of ABILITIES) {
    const manualScore = manual[`abilityScore.${ability}`];
    const automatic = character.abilityScores[ability];
    const raw = typeof automatic === "number" ? automatic : typeof manualScore === "number" ? manualScore : undefined;
    if (raw === undefined) {
      const recovery: RecoveryAction = { code: "ABILITY_SCORE_MISSING", fieldPath: `abilityScore.${ability}`, action: "Set ability score" };
      abilities[ability] = { score: unknown(recovery), modifier: unknown(recovery) };
      issues.push({ code: "ABILITY_SCORE_MISSING", severity: "error", fieldPath: `abilityScore.${ability}` });
      continue;
    }
    abilityScores[ability] = raw;
    const scoreValue = applyOverride(
      known(raw, [
        typeof automatic === "number"
          ? { kind: "base", label: character.abilityMethod === "standard-array" ? "Standard array and origin increases" : "Entered score" }
          : { kind: "manual", label: "Manual value" },
      ]),
      `abilityScore.${ability}`,
      overrides,
      detectedStaleOverrideIds,
    );
    const effectiveScore = scoreValue.value ?? raw;
    abilityScores[ability] = effectiveScore;
    const modifierValue = applyOverride(
      known(abilityModifier(effectiveScore), [{ kind: "base", label: `Score ${effectiveScore}`, amount: abilityModifier(effectiveScore) }]),
      `abilityModifier.${ability}`,
      overrides,
      detectedStaleOverrideIds,
    );
    abilities[ability] = { score: scoreValue, modifier: modifierValue };
  }
  const allAbilitiesKnown = ABILITIES.every(ability => abilities[ability].modifier.value !== null);
  const modifierOf = (ability: Ability): number | null => abilities[ability].modifier.value;

  // ---- pure rules evaluation ----------------------------------------------
  let state: DerivedCharacterState | undefined;
  if (mode === "automatic" && allAbilitiesKnown) {
    state = deriveCharacterState({
      character: toRuleCharacter(character, abilityScores as Record<Ability, number>),
      entries,
      choiceSelections: character.choiceSelections,
      equipmentSelections: character.equipmentSelections,
    });
    for (const issue of state.issues)
      issues.push({ code: issue.code, severity: issue.severity === "error" ? "error" : "warning", recordId: issue.recordId });
  }

  const contextValues = state?.ruleResult.context.values ?? {};
  const proficiencies = state?.ruleResult.context.proficiencies ?? new Set<string>();

  /**
   * In automatic mode every engine-derived value depends on the rules evaluation
   * having run. When incomplete abilities blocked it, the recovery must name that
   * blocker rather than blaming the value's own inputs.
   */
  const engineBlocked = (fieldPath: string, fallback: RecoveryAction): RecoveryAction =>
    mode === "automatic" && !state && !allAbilitiesKnown
      ? { code: "ABILITY_SCORE_MISSING", fieldPath, action: "Complete the ability scores" }
      : fallback;

  // ---- proficiency bonus ---------------------------------------------------
  const proficiencyBonusValue = applyOverride(
    known(proficiencyBonus(character.level), [{ kind: "base", label: `Level ${character.level}`, amount: proficiencyBonus(character.level) }]),
    "proficiencyBonus",
    overrides,
    detectedStaleOverrideIds,
  );
  const bonus = proficiencyBonusValue.value ?? 0;

  // ---- hit points ----------------------------------------------------------
  let maximumHitPoints: DerivedValue;
  if (mode === "automatic") {
    const classBase = contextValues["hitPoints.classBase"];
    const constitution = modifierOf("constitution");
    /*
     * `hitPoints.classBase` is one scalar path, so two classes writing it
     * overwrite one another. Nothing in this repository's schemas or decisions
     * says how a multiclass base should be composed, so the case is named rather
     * than answered with whichever class happened to write last.
     */
    if (character.classLevels.length > 1)
      issues.push({ code: "HIT_POINTS_MULTICLASS_UNRESOLVED", severity: "warning", fieldPath: "hitPoints.maximum" });
    const calculated = maximumHitPointsFor({
      classBase: typeof classBase === "number" ? classBase : null,
      constitutionModifier: constitution,
      level: character.level,
    });
    if (calculated.value === null) {
      maximumHitPoints = unknown({
        code: constitution === null ? "ABILITY_SCORE_MISSING" : "CLASS_MISSING",
        fieldPath: "hitPoints.maximum",
        action: constitution === null ? "Set Constitution" : "Restore the class source",
      });
    } else {
      // A maximum of zero or less is reported, never quietly raised to a floor
      // this project has never decided on.
      if (calculated.notPositive)
        issues.push({ code: "HIT_POINTS_MAXIMUM_NOT_POSITIVE", severity: "warning", fieldPath: "hitPoints.maximum" });
      maximumHitPoints = known(calculated.value, [
        { kind: "base", label: `${classEntry?.name ?? "Class"} level ${character.level}`, amount: classBase as number, entryId: classEntry?.id, sourceId: classEntry?.sourceId },
        {
          kind: "ability",
          // The Constitution modifier applies once per level, so the explanation
          // names the per-level modifier and the total it contributes.
          label:
            calculated.levelsApplied === 1
              ? "Constitution modifier"
              : `Constitution modifier across ${calculated.levelsApplied} levels`,
          amount: calculated.constitutionTotal,
        },
      ]);
    }
  } else {
    const entered = manual["hitPoints.maximum"];
    maximumHitPoints =
      typeof entered === "number"
        ? known(entered, [{ kind: "manual", label: "Manual value" }])
        : unknown({ code: "MANUAL_VALUE_MISSING", fieldPath: "hitPoints.maximum", action: "Enter maximum hit points" });
  }
  maximumHitPoints = applyOverride(maximumHitPoints, "hitPoints.maximum", overrides, detectedStaleOverrideIds);

  const currentFromRuntime = runtime?.currentHitPoints;
  const currentManual = manual["hitPoints.current"];
  const currentHitPoints: DerivedValue =
    typeof currentFromRuntime === "number"
      ? known(currentFromRuntime, [{ kind: "base", label: "Current play state" }])
      : typeof currentManual === "number"
        ? known(currentManual, [{ kind: "manual", label: "Manual value" }])
        : maximumHitPoints.value !== null
          ? known(maximumHitPoints.value, [{ kind: "base", label: "Starts at maximum" }])
          : unknown({ code: "MANUAL_VALUE_MISSING", fieldPath: "hitPoints.current", action: "Enter current hit points" });

  // ---- hit dice ------------------------------------------------------------
  const hitDie = hitDieForClass(classEntry);
  const hitDice: DerivedValue<string> =
    mode === "automatic" && classEntry && hitDie !== undefined
      ? {
          value: `${character.level}d${hitDie}`,
          contributors: [{ kind: "base", label: `${classEntry.name} hit die`, entryId: classEntry.id, sourceId: classEntry.sourceId }],
        }
      : { value: null, contributors: [], recovery: { code: "CLASS_MISSING", fieldPath: "hitDice.total", action: "Choose a class" } };

  // ---- armour class --------------------------------------------------------
  /*
   * The worn armour comes from the shared resolver the rules evaluation used, so
   * the number on the sheet, the contribution shown against each item, and the
   * conditions the engine evaluated all read one resolution of one equipment
   * list. Nothing here inspects an item's name or ID.
   */
  const armour = state?.armor ?? NO_ARMOR_RESOLUTION;
  const wornArmourByItemId = new Map([...armour.body, ...armour.shields].map(piece => [piece.itemId, piece]));
  const equipmentItems = state?.equipment.items ?? [];
  const equipment: DerivedEquipmentItem[] = equipmentItems.map(item => {
    const definition = byId.get(item.itemId);
    if (!definition) missingDependencyIds.add(item.itemId);
    const worn = wornArmourByItemId.get(item.itemId);
    return {
      itemId: item.itemId,
      label: definition?.name ?? item.itemId,
      quantity: item.quantity,
      status: item.status,
      ...(worn ? { armorContribution: worn.baseArmorClass } : {}),
    };
  });

  let armorClass: DerivedValue;
  if (mode === "automatic") {
    // Two worn body armours is a state the equipment model cannot decide
    // between, so neither is picked. Choosing by array order would be a guess.
    if (armour.context.ambiguous)
      issues.push({ code: "ARMOUR_SELECTION_AMBIGUOUS", severity: "warning", fieldPath: "armorClass" });
    const body = armour.body.length === 1 ? armour.body[0] : undefined;
    const dexterity = modifierOf("dexterity");
    if (!body || dexterity === null) {
      armorClass = unknown({
        code: dexterity === null ? "ABILITY_SCORE_MISSING" : "ARMOUR_UNRESOLVED",
        fieldPath: "armorClass",
        action:
          dexterity === null
            ? "Set Dexterity"
            : armour.context.ambiguous
              ? "Wear one body armour, or enter a manual value"
              : "Equip armour or enter a manual value",
      });
    } else {
      const dexterityApplied = body.dexterity === "none" ? 0 : body.dexterity === "max-2" ? Math.min(dexterity, 2) : dexterity;
      const contributors: Contributor[] = [
        { kind: "equipment", label: body.label, amount: body.baseArmorClass, entryId: body.itemId, sourceId: body.sourceId },
        {
          kind: "ability",
          label: body.dexterity === "max-2" ? "Dexterity modifier (capped at +2)" : "Dexterity modifier",
          amount: dexterityApplied,
        },
      ];
      let total = body.baseArmorClass + dexterityApplied;
      for (const shield of armour.shields) {
        total += shield.baseArmorClass;
        contributors.push({ kind: "equipment", label: shield.label, amount: shield.baseArmorClass, entryId: shield.itemId, sourceId: shield.sourceId });
      }
      // Declarative armour-class effects contributed by features or styles.
      const effectBonus = contextValues.armorClass;
      if (typeof effectBonus === "number" && effectBonus !== 0) {
        total += effectBonus;
        contributors.push({ kind: "feature", label: "Feature bonus", amount: effectBonus });
      }
      armorClass = known(total, contributors);
    }
  } else {
    const entered = manual.armorClass;
    armorClass =
      typeof entered === "number"
        ? known(entered, [{ kind: "manual", label: "Manual value" }])
        : unknown({ code: "MANUAL_VALUE_MISSING", fieldPath: "armorClass", action: "Enter armour class" });
  }
  armorClass = applyOverride(armorClass, "armorClass", overrides, detectedStaleOverrideIds);

  // ---- initiative and speed -----------------------------------------------
  const dexterityModifier = modifierOf("dexterity");
  let initiative: DerivedValue;
  if (mode === "automatic") {
    initiative =
      dexterityModifier === null
        ? unknown({ code: "ABILITY_SCORE_MISSING", fieldPath: "initiative", action: "Set Dexterity" })
        : known(typeof contextValues.initiative === "number" ? contextValues.initiative : dexterityModifier, [
            { kind: "ability", label: "Dexterity modifier", amount: dexterityModifier },
          ]);
  } else {
    const entered = manual.initiative;
    initiative =
      typeof entered === "number"
        ? known(entered, [{ kind: "manual", label: "Manual value" }])
        : unknown({ code: "MANUAL_VALUE_MISSING", fieldPath: "initiative", action: "Enter initiative" });
  }
  initiative = applyOverride(initiative, "initiative", overrides, detectedStaleOverrideIds);

  const speciesEntry = character.speciesId ? byId.get(character.speciesId) : undefined;
  let speed: DerivedValue;
  if (mode === "automatic") {
    speed =
      typeof contextValues.speed === "number"
        ? known(contextValues.speed, [{ kind: "species", label: speciesEntry?.name ?? "Species", amount: contextValues.speed, entryId: speciesEntry?.id, sourceId: speciesEntry?.sourceId }])
        : unknown(engineBlocked("speed", { code: "SPECIES_MISSING", fieldPath: "speed", action: "Choose an origin species" }));
  } else {
    const entered = manual.speed;
    speed =
      typeof entered === "number"
        ? known(entered, [{ kind: "manual", label: "Manual value" }])
        : unknown({ code: "MANUAL_VALUE_MISSING", fieldPath: "speed", action: "Enter speed" });
  }
  speed = applyOverride(speed, "speed", overrides, detectedStaleOverrideIds);

  // ---- saves and checks ----------------------------------------------------
  const catalog = proficiencyCatalog(entries);
  const proficiencyEntry = (
    definition: { id: ID; ability: Ability; label: string },
    prefix: "savingThrow" | "check",
  ): DerivedProficiencyEntry => {
    const ability = definition.ability;
    const modifier = modifierOf(ability);
    const proficient = proficiencies.has(definition.id);
    const path = `${prefix}.${definition.id}`;
    const base =
      modifier === null
        ? unknown({ code: "ABILITY_SCORE_MISSING", fieldPath: path, action: "Set ability score" })
        : known(modifier + (proficient ? bonus : 0), [
            { kind: "ability", label: `${ability[0].toUpperCase()}${ability.slice(1)} modifier`, amount: modifier },
            ...(proficient ? [{ kind: "proficiency" as const, label: "Proficiency bonus", amount: bonus }] : []),
          ]);
    return { id: definition.id, label: definition.label, ability, proficient, total: applyOverride(base, path, overrides, detectedStaleOverrideIds) };
  };
  const saves = mode === "automatic" ? catalog.saves.map(item => proficiencyEntry(item, "savingThrow")) : [];
  const checks = mode === "automatic" ? catalog.skills.map(item => proficiencyEntry(item, "check")) : [];

  // ---- actions -------------------------------------------------------------
  const actions: DerivedAction[] = [];
  const masteryRelations = masteryWeaponRelations(entries);
  for (const grant of state?.ruleResult.actionGrants ?? []) {
    const definition = byId.get(grant.definitionId);
    if (!definition) {
      missingDependencyIds.add(grant.definitionId);
      issues.push({ code: "ACTION_DEFINITION_MISSING", severity: "error", recordId: grant.definitionId });
      continue;
    }
    const parsed = actionDefinitionSchema.safeParse((definition.mechanics as { data?: unknown }).data);
    if (!parsed.success) {
      issues.push({ code: "ACTION_DEFINITION_INVALID", severity: "error", recordId: definition.id });
      continue;
    }
    const meta = parsed.data;
    const ability = meta.ability as Ability | undefined;
    const modifier = ability ? modifierOf(ability) : null;
    const matches = (selector: Record<string, string>) =>
      Object.entries(selector).every(([key, expected]) => (meta as Record<string, unknown>)[key] === expected);
    const attackContributors: Contributor[] = [];
    let attackTotal: number | null = null;
    if (modifier !== null) {
      attackTotal = modifier;
      attackContributors.push({ kind: "ability", label: `${ability?.[0].toUpperCase()}${ability?.slice(1)} modifier`, amount: modifier });
      if (meta.proficient) {
        attackTotal += bonus;
        attackContributors.push({ kind: "proficiency", label: "Proficiency bonus", amount: bonus });
      }
      for (const modifierEffect of state?.ruleResult.attackModifiers ?? []) {
        if (!matches(modifierEffect.selector) || modifierEffect.operation !== "add") continue;
        attackTotal += modifierEffect.value;
        attackContributors.push({ kind: "feature", label: "Feature bonus", amount: modifierEffect.value });
      }
    }
    const damageContributors: Contributor[] = [];
    let damageTotal = 0;
    if (modifier !== null) {
      damageTotal += modifier;
      damageContributors.push({ kind: "ability", label: `${ability?.[0].toUpperCase()}${ability?.slice(1)} modifier`, amount: modifier });
    }
    for (const modifierEffect of state?.ruleResult.damageModifiers ?? []) {
      if (!matches(modifierEffect.selector) || modifierEffect.operation !== "add") continue;
      damageTotal += modifierEffect.value;
      const sourceEntry = entries.find(item => item.effects.some(effect => effect.id === modifierEffect.effectId));
      damageContributors.push({
        kind: "feature",
        label: sourceEntry?.name ?? "Feature bonus",
        amount: modifierEffect.value,
        entryId: sourceEntry?.id,
        sourceId: sourceEntry?.sourceId,
      });
    }
    const signed = (amount: number) => (amount >= 0 ? `+ ${amount}` : `- ${Math.abs(amount)}`);
    const attackBonus = applyOverride(
      attackTotal === null
        ? unknown({ code: "ABILITY_SCORE_MISSING", fieldPath: `attack.${definition.id}.attackBonus`, action: "Set ability score" }, attackContributors)
        : known(attackTotal, attackContributors),
      `attack.${definition.id}.attackBonus`,
      overrides,
      detectedStaleOverrideIds,
    );
    actions.push({
      id: definition.id,
      label: definition.name,
      kind: grant.kind,
      attackBonus,
      attackExpression: attackBonus.value === null ? null : `1d20 ${signed(attackBonus.value)}`,
      damageExpression: meta.damageDice ? `${meta.damageDice} ${signed(damageTotal)}`.trim() : null,
      damageContributors,
      ...(meta.range ? { range: meta.range } : {}),
      // A granted mastery attaches when its declared weapon matches the action's.
      ...(() => {
        const granted = [...(state?.ruleResult.optionGrants.weaponMasteries ?? [])]
          .sort()
          .find(masteryId => meta.weaponId !== undefined && masteryRelations.get(masteryId) === meta.weaponId);
        return granted ? { masteryId: granted } : {};
      })(),
    });
  }
  for (const manualAction of character.manualActions)
    actions.push({
      id: manualAction.id,
      label: manualAction.label,
      kind: "action",
      attackBonus: { value: null, contributors: [{ kind: "manual", label: "Manual action" }] },
      attackExpression: null,
      damageExpression: manualAction.expression ?? null,
      damageContributors: [{ kind: "manual", label: "Manual value" }],
    });
  actions.sort((left, right) => left.id.localeCompare(right.id));

  // ---- resources -----------------------------------------------------------
  /*
   * Which entry declares a resource, proven from content rather than assumed.
   *
   * `addResource` carries no provenance through the engine, so this block used
   * to name the class for every resource — both in the contributor and in the
   * recovery action. That is simply wrong for a species trait, a feat or an
   * item, and a Goliath's ancestry resource read "Restore the class source".
   * Attribution is therefore claimed only when exactly one entry in scope
   * declares the resource; anything else stays source-neutral rather than
   * inventing a source the resolver cannot prove.
   */
  const resourceGrantors = new Map<ID, ContentEntry>();
  const ambiguousResourceIds = new Set<ID>();
  for (const item of entries)
    for (const effect of item.effects)
      if (effect.type === "addResource") {
        if (resourceGrantors.has(effect.resource.id)) ambiguousResourceIds.add(effect.resource.id);
        else resourceGrantors.set(effect.resource.id, item);
      }
  const grantorOf = (resourceId: ID): ContentEntry | undefined =>
    ambiguousResourceIds.has(resourceId) ? undefined : resourceGrantors.get(resourceId);

  const resources: DerivedResource[] = [];
  for (const resourceId of state?.ruleResult.resources ?? []) {
    const definition = state?.ruleResult.resourceDefinitions.get(resourceId);
    const contentEntry = byId.get(resourceId);
    const grantor = grantorOf(resourceId);
    const maximumSource = definition?.maximum;
    const resolvedMaximum =
      maximumSource?.kind === "literal" && typeof maximumSource.value === "number"
        ? maximumSource.value
        : maximumSource?.kind === "path"
          ? contextValues[maximumSource.path]
          : undefined;
    /*
     * The recovery names the concept, never a source type. Nothing the user can
     * do in Edit character resolves a maximum the content never defines, so the
     * label points at the content that grants it instead of demanding a fix the
     * user cannot perform.
     */
    const recoveryAction = grantor ? `Check ${grantor.name}` : "Check the granting content";
    const maximum =
      typeof resolvedMaximum === "number"
        ? applyOverride(
            known(resolvedMaximum, [
              grantor
                ? { kind: "feature", label: grantor.name, amount: resolvedMaximum, entryId: grantor.id, sourceId: grantor.sourceId }
                : { kind: "feature", label: definition?.name ?? contentEntry?.name ?? "Granting content", amount: resolvedMaximum },
            ]),
            `resource.${resourceId}.maximum`,
            overrides,
            detectedStaleOverrideIds,
          )
        : unknown({ code: "RESOURCE_MAXIMUM_UNKNOWN", fieldPath: `resource.${resourceId}.maximum`, action: recoveryAction });
    const currentUses = runtime?.resourceUses[resourceId];
    resources.push({
      id: resourceId,
      label: definition?.name ?? contentEntry?.name ?? resourceId,
      maximum,
      current:
        typeof currentUses === "number"
          ? known(currentUses, [{ kind: "base", label: "Current play state" }])
          : maximum.value !== null
            ? known(maximum.value, [{ kind: "base", label: "Starts full" }])
            : unknown({ code: "RESOURCE_MAXIMUM_UNKNOWN", fieldPath: `resource.${resourceId}.current`, action: recoveryAction }),
      recharge: definition?.recharge ?? "manual",
    });
  }
  resources.sort((left, right) => left.id.localeCompare(right.id));

  // ---- features, traits and feats ------------------------------------------
  const features: DerivedFeature[] = [];
  if (state) {
    const pushFeature = (id: ID, group: DerivedFeature["group"]) => {
      const definition = byId.get(id);
      if (!definition) return;
      features.push({ id, label: definition.name, ...(definition.summary ? { summary: definition.summary } : {}), group });
    };
    for (const id of state.classFeatureIds) pushFeature(id, "class");
    // Chosen options with their own entry (a fighting style, a mastery) are
    // part of the class's build and read best alongside its features.
    for (const id of state.activeEntryIds) {
      const definition = byId.get(id);
      if (definition && (definition.category === "fighting-style" || definition.category === "weapon-mastery"))
        pushFeature(id, "class");
    }
    for (const id of state.identityTraitIds) pushFeature(id, "species");
    for (const id of state.activeEntryIds) {
      const definition = byId.get(id);
      if (definition && definition.category === "feat" && !state.identityTraitIds.has(id)) pushFeature(id, "background");
    }
  }
  features.sort((left, right) => left.group.localeCompare(right.group) || left.label.localeCompare(right.label));

  // ---- armour, weapon, tool and language proficiencies ----------------------
  const otherProficiencies: DerivedOtherProficiency[] = [];
  for (const id of proficiencies) {
    const definition = byId.get(id);
    if (!definition || definition.category !== "proficiency") continue;
    const type = (definition.mechanics as { type?: unknown }).type;
    if (type === "armor" || type === "weapon" || type === "tool" || type === "language")
      otherProficiencies.push({ id, label: definition.name, type });
  }
  otherProficiencies.sort((left, right) => left.type.localeCompare(right.type) || left.label.localeCompare(right.label));

  // ---- spellcasting ----------------------------------------------------------
  let spellcasting: DerivedSpellcasting | undefined;
  const classIds = new Set(character.classLevels.map(item => item.classId));
  const spellcastingDeclaration = entries
    .filter(item => item.category === "rule" && (item.mechanics as { kind?: unknown }).kind === "spellcasting")
    .map(item => spellcastingDeclarationSchema.safeParse((item.mechanics as { data?: unknown }).data))
    .find(parsed => parsed.success && classIds.has(parsed.data.classId));
  if (state && spellcastingDeclaration?.success) {
    const declaration = spellcastingDeclaration.data;
    const castingModifier = modifierOf(declaration.ability);
    const abilityLabel = capitalize(declaration.ability);
    const castingContributors = (base?: Contributor): Contributor[] => [
      ...(base ? [base] : []),
      { kind: "ability" as const, label: `${abilityLabel} modifier`, amount: castingModifier ?? 0 },
      { kind: "proficiency" as const, label: "Proficiency bonus", amount: bonus },
    ];
    const spellAttack: DerivedValue | null = declaration.attackProficient
      ? castingModifier === null
        ? unknown({ code: "ABILITY_SCORE_MISSING", fieldPath: "spellcasting.attack", action: `Set ${abilityLabel}` })
        : known(castingModifier + bonus, castingContributors())
      : null;
    const saveDc: DerivedValue | null =
      declaration.saveDcBase === undefined
        ? null
        : castingModifier === null
          ? unknown({ code: "ABILITY_SCORE_MISSING", fieldPath: "spellcasting.saveDc", action: `Set ${abilityLabel}` })
          : known(
              declaration.saveDcBase + castingModifier + bonus,
              castingContributors({ kind: "base", label: "Base", amount: declaration.saveDcBase }),
            );
    const spells: DerivedSpell[] = [];
    for (const spellId of state.ruleResult.spells) {
      const definition = byId.get(spellId);
      if (!definition) {
        missingDependencyIds.add(spellId);
        continue;
      }
      const mechanics = spellMechanicsDisplaySchema.safeParse(definition.mechanics);
      if (!mechanics.success) continue;
      const meta = mechanics.data;
      const rangeText =
        meta.range === undefined
          ? undefined
          : meta.range.type === "distance" && meta.range.distance !== undefined
            ? `${meta.range.distance} ${meta.range.unit ?? "feet"}`
            : capitalize(meta.range.type);
      const durationText =
        meta.duration === undefined
          ? undefined
          : meta.duration.type === "timed" && meta.duration.amount !== undefined
            ? `${meta.duration.amount} ${meta.duration.unit ?? "round"}${meta.duration.amount === 1 ? "" : "s"}`
            : capitalize(meta.duration.type);
      spells.push({
        id: spellId,
        label: definition.name,
        ...(definition.summary ? { summary: definition.summary } : {}),
        level: meta.level,
        ...(meta.school ? { school: capitalize(meta.school) } : {}),
        ...(meta.castingTime ? { castingTime: `${meta.castingTime.amount} ${meta.castingTime.unit.replace("-", " ")}` } : {}),
        ...(rangeText ? { range: rangeText } : {}),
        ...(durationText ? { duration: durationText } : {}),
        concentration: meta.duration?.concentration ?? false,
        ritual: spellIsRitual(definition.mechanics),
      });
    }
    spells.sort((left, right) => left.level - right.level || left.label.localeCompare(right.label));
    spellcasting = {
      abilityLabel,
      spellAttack,
      saveDc,
      slotResourceIds: declaration.slotResourceIds.filter(id => resources.some(resource => resource.id === id)),
      spells,
    };
  }

  // ---- classification ------------------------------------------------------
  /*
   * Two different facts used to share one word.
   *
   * "Incomplete" means the user still owes a decision, and Edit character is
   * where they pay it. A resource maximum the installed content never defines
   * is not a decision: Review is right that nothing is outstanding, and the
   * sheet was still calling the character unfinished and sending the user to
   * an editor that cannot resolve it. A value the content cannot calculate is
   * now reported as its own condition, counted as an issue so the library stops
   * reading "0 issues", and left non-blocking for commit.
   */
  const unavailableValues: UnavailableValue[] = resources
    .filter(item => item.maximum.value === null)
    .map(item => ({ fieldPath: `resource.${item.id}.maximum`, label: item.label }));
  for (const item of unavailableValues)
    issues.push({
      code: "DERIVED_VALUE_UNAVAILABLE",
      severity: "warning",
      recordId: character.id,
      fieldPath: item.fieldPath,
    });

  const automaticMinimumMet =
    mode === "automatic" &&
    allAbilitiesKnown &&
    proficiencyBonusValue.value !== null &&
    maximumHitPoints.value !== null &&
    currentHitPoints.value !== null &&
    armorClass.value !== null &&
    initiative.value !== null &&
    speed.value !== null &&
    saves.every(item => item.total.value !== null) &&
    checks.every(item => item.total.value !== null) &&
    actions.length > 0;

  const manualMinimumMet =
    mode === "manual" &&
    allAbilitiesKnown &&
    typeof manual["hitPoints.maximum"] === "number" &&
    typeof manual["hitPoints.current"] === "number" &&
    typeof manual.armorClass === "number" &&
    typeof manual.initiative === "number" &&
    actions.length > 0;

  const blockingIssue = issues.some(issue => issue.severity === "error");

  const guidedComplete = automaticMinimumMet && !blockingIssue && (state?.pendingChoiceIds.size ?? 0) === 0;
  const completeness: CompletenessClass = automaticMinimumMet
    ? guidedComplete
      ? "guided-complete"
      : "renderable-automatic"
    : manualMinimumMet
      ? "renderable-manual"
      : "incomplete";

  const staleOverrideIds = [
    ...new Set([...overrides.filter(item => item.status === "stale").map(item => item.id), ...detectedStaleOverrideIds]),
  ].sort((left, right) => left.localeCompare(right));

  const activeSourceIds = [...new Set(entries.map(item => item.sourceId))].sort((left, right) => left.localeCompare(right));

  /**
   * One issue per (code, record, path).
   *
   * The pure engine and this resolver can both notice the same unresolved
   * choice, and an unresolved choice used to arrive twice from the engine
   * itself. Collapsing on identity means the sheet reports each fact once, no
   * matter how many layers observed it.
   */
  const uniqueIssues: SanitizedIssue[] = [];
  const seenIssues = new Set<string>();
  for (const issue of issues) {
    const key = `${issue.code}|${issue.recordId ?? ""}|${issue.fieldPath ?? ""}`;
    if (seenIssues.has(key)) continue;
    seenIssues.add(key);
    uniqueIssues.push(issue);
  }

  return {
    characterId: character.id,
    characterRevision: character.revision,
    runtimeRevision: runtime?.revision ?? null,
    name: character.name.trim() || "Unnamed character",
    ...(character.nickname ? { nickname: character.nickname } : {}),
    level: character.level,
    classLabel: label(classSelection?.classId),
    subclassLabel: label(classSelection?.subclassId),
    speciesLabel: label(character.speciesId),
    backgroundLabel: label(character.backgroundId),
    mode,
    completeness,
    renderable: automaticMinimumMet || manualMinimumMet,
    abilities,
    proficiencyBonus: proficiencyBonusValue,
    hitPoints: { maximum: maximumHitPoints, current: currentHitPoints, temporary: runtime?.temporaryHitPoints ?? 0 },
    hitDice,
    armorClass,
    initiative,
    speed,
    saves,
    checks,
    actions,
    resources,
    equipment,
    features,
    otherProficiencies,
    ...(spellcasting ? { spellcasting } : {}),
    conditions: (runtime?.conditions ?? []).map(item => {
      const definition = byId.get(item.conditionId);
      return {
        conditionId: item.conditionId,
        label: definition?.name ?? item.conditionId,
        ...(definition?.summary ? { summary: definition.summary } : {}),
      };
    }),
    availableConditions: entries
      .filter(item => item.category === "condition")
      .map(item => ({ id: item.id, label: item.name, ...(item.summary ? { summary: item.summary } : {}) }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    hitDiceRemaining: runtime?.hitDiceRemaining ?? null,
    exhaustion: runtime?.exhaustion ?? 0,
    deathSaves: runtime?.deathSaves ?? { successes: 0, failures: 0 },
    inspiration: runtime?.inspiration ?? false,
    activeRulesetId: character.rulesetProfileId,
    activeRulesetLabel: input.ruleset?.name ?? null,
    activeSourceIds,
    issues: uniqueIssues,
    unavailableValues,
    missingDependencyIds: [...missingDependencyIds].sort((left, right) => left.localeCompare(right)),
    staleOverrideIds,
    contentFingerprint: computeContentFingerprint(entries, character.rulesetProfileId),
    confidence: missingDependencyIds.size ? "uncertain" : "calculated",
  };
}
