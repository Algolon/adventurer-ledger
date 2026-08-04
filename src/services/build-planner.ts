/**
 * Pure creation planning for the M2.1 builder.
 *
 * Nothing here touches Dexie or React. It turns a draft build plus content into
 * the exact nine-step plan from AC-03, the sanitized issue list, and the guided
 * recommendations from AC-04. Recommendations are ranked and explained but never
 * auto-selected, and presentation mode changes guidance only: the same plan runs
 * for guided and flexible drafts, so switching modes cannot clear a selection.
 */
import { classMechanicsSchema } from "@/src/domain/content-pack";
import type { CharacterDraftBuild, CharacterPresentationMode } from "@/src/domain/character-record";
import { ABILITIES } from "@/src/domain/character-record";
import type { Ability, Category, ChoiceDefinition, ContentEntry, ID } from "@/src/domain/model";
import {
  activatedEntriesFor,
  automaticallyGrantedProficiencyIds,
  dueChoicesFor,
  maximumLevelFor,
  proficiencyProvenance,
  subclassLevelFor,
  subclassOptionsFor,
  type ActivatedEntry,
  type ActivationVia,
} from "@/src/services/activation";
import {
  abilityGenerationMethods,
  equipmentChoicesFor,
  grantingEntriesFor,
  standardArrayFor,
} from "@/src/services/content-scope";
import { evaluateCondition, type RuleContext } from "@/src/rules/engine";
import type { ServiceIssue } from "@/src/services/contracts";

export type BuilderStepId =
  | "start"
  | "class"
  | "origin"
  | "abilities"
  | "class-choices"
  | "spells-resources"
  | "equipment"
  | "identity"
  | "review";

/** The step list is exactly this, in this order (AC-03). */
export const BUILDER_STEPS: readonly { id: BuilderStepId; label: string }[] = [
  { id: "start", label: "Start / ruleset" },
  { id: "class", label: "Class" },
  { id: "origin", label: "Origin" },
  { id: "abilities", label: "Abilities" },
  { id: "class-choices", label: "Class choices" },
  { id: "spells-resources", label: "Spells & resources" },
  { id: "equipment", label: "Equipment" },
  { id: "identity", label: "Identity" },
  { id: "review", label: "Review" },
];

/** The values a manual character sheet must supply explicitly (D-03). */
const MANUAL_MINIMUM: readonly [string, BuilderStepId][] = [
  ["hitPoints.maximum", "class-choices"],
  ["hitPoints.current", "class-choices"],
  ["armorClass", "class-choices"],
  ["initiative", "class-choices"],
];

/**
 * A step is either resolved or not.
 *
 * There is deliberately no "not-needed" state: a step with nothing to decide is
 * omitted from the sequence instead of being shown as an empty screen the user
 * must still walk through. What does not apply is reported once, on the review,
 * via `SystemSummary`.
 */
export type StepStatus = "complete" | "incomplete";

export interface PlannedStep {
  id: BuilderStepId;
  label: string;
  status: StepStatus;
  issues: readonly ServiceIssue[];
  /** True when this step is optional for a flexible save. */
  optional: boolean;
}

export interface Recommendation {
  optionId: ID;
  label: string;
  /** The "Why this?" copy. Never auto-applied. */
  why: string;
  rank: number;
}

/** Why an option cannot be taken, and what would make it available. */
export interface OptionIncompatibility {
  optionId: ID;
  entryId: ID;
  /** The unmet requirement's own label, from content. */
  requirement: string;
  /** Hard requirements block; soft ones are warnings the user may accept. */
  enforcement: "hard" | "soft" | "informational";
  /** The repair that would make the option compatible. */
  repair: string;
}

/** Where a required choice came from, so the UI can group and explain it. */
export interface ChoiceSource {
  entryId: ID;
  entryName: string;
  category: Category;
  via: ActivationVia;
}

export interface RequiredChoice {
  choiceId: ID;
  label: string;
  min: number;
  max: number;
  stepId: BuilderStepId;
  /** The character level at which this choice becomes due. */
  level: number;
  source: ChoiceSource;
  options: readonly {
    id: ID;
    label: string;
    entryId?: ID;
    /** True when the build already holds this automatically from another source. */
    alreadyGranted?: boolean;
    /** The entry that already granted it, for the explanation. */
    grantedBy?: string;
  }[];
  selected: readonly ID[];
  resolved: boolean;
  /** Options whose prerequisites the current build does not satisfy. */
  incompatibleOptions: readonly OptionIncompatibility[];
}

/**
 * A rules system reported on the review whether or not it applies.
 *
 * A system that contributes no choices is omitted from the step sequence, so
 * the review is where its absence is stated. Saying "None at this level" is
 * what stops an omitted step from reading as a forgotten one.
 */
export interface SystemSummary {
  id: string;
  label: string;
  value: string;
  applicable: boolean;
}

export interface BuildPlan {
  /** Only the steps that apply to this build, in canonical order. */
  steps: readonly PlannedStep[];
  requiredChoices: readonly RequiredChoice[];
  issues: readonly ServiceIssue[];
  issueCount: number;
  /** The next step the user should resolve, or `review` when nothing is open. */
  nextUnresolvedStepId: BuilderStepId;
  /** Every required ruleset choice resolved with no blocking issue. */
  guidedComplete: boolean;
  /** Non-applicable systems, stated on the review instead of as empty steps. */
  systemSummaries: readonly SystemSummary[];
}

/**
 * A minimal evaluation context built from the draft, used only to test option
 * prerequisites declaratively. It runs no effects and derives no values.
 */
function draftContext(build: CharacterDraftBuild): RuleContext {
  const abilities = Object.fromEntries(
    ABILITIES.map(ability => [ability, build.abilityScores[ability] ?? 0]),
  ) as RuleContext["abilities"];
  return {
    totalLevel: build.level,
    classLevels: build.classId ? { [build.classId]: build.level } : {},
    abilities,
    tags: new Set<string>(),
    features: new Set<string>(),
    proficiencies: new Set<string>(),
    armor: { worn: false },
    flags: {},
    values: {},
  };
}

/** Options the current build cannot satisfy, with the repair that would help. */
export function incompatibleOptionsFor(
  choice: ChoiceDefinition,
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
): OptionIncompatibility[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const context = draftContext(build);
  const blocked: OptionIncompatibility[] = [];
  for (const option of choice.options) {
    const entry = option.entryId ? byId.get(option.entryId) : undefined;
    if (!entry) continue;
    for (const prerequisite of entry.prerequisites) {
      if (evaluateCondition(prerequisite.condition, context)) continue;
      blocked.push({
        optionId: option.id,
        entryId: entry.id,
        requirement: prerequisite.label,
        enforcement: prerequisite.enforcement,
        repair: `Meet ${prerequisite.label}, or choose another option for ${choice.label}.`,
      });
    }
  }
  return blocked;
}

/** Collects the choice definitions the ruleset requires at the draft's level. */
/** Which builder step presents a choice, decided by where it came from. */
function stepForActivation(activated: ActivatedEntry): BuilderStepId {
  switch (activated.via) {
    case "species":
    case "species-trait":
    case "lineage":
    case "lineage-trait":
    case "background":
    case "background-feat":
    case "background-proficiency":
      return "origin";
    default:
      return "class-choices";
  }
}

/**
 * Every required choice the build activates, from every activated entry.
 *
 * This replaces a two-source lookup — the class's progression and the
 * background's own choices — that could not see a species trait's choice, a
 * subclass feature's choice, or a feat's nested choice, so those decisions were
 * silently skipped and a build could commit while incomplete.
 *
 * Deduplicated by choice ID: an entry reachable through two activation paths
 * contributes its choice once, keeping the first path's provenance, so nothing
 * is presented twice.
 */
export function requiredChoicesFor(build: CharacterDraftBuild, entries: readonly ContentEntry[]): RequiredChoice[] {
  const granted = automaticallyGrantedProficiencyIds(build, entries);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const required: RequiredChoice[] = [];
  const seen = new Set<ID>();

  for (const activated of activatedEntriesFor(build, entries)) {
    const stepId = stepForActivation(activated);
    for (const { choice, level } of dueChoicesFor(activated, build)) {
      if (seen.has(choice.id)) continue;
      seen.add(choice.id);
      const selected = build.choiceSelections[choice.id] ?? [];
      required.push({
        choiceId: choice.id,
        label: choice.label,
        min: choice.min,
        max: choice.max,
        stepId,
        level,
        source: {
          entryId: activated.entry.id,
          entryName: activated.entry.name,
          category: activated.entry.category,
          via: activated.via,
        },
        options: choice.options.map(option => {
          // An option the build already holds automatically is still listed, but
          // marked, so the user can see why it is not worth a pick.
          const alreadyGranted = Boolean(option.entryId && granted.has(option.entryId));
          const grantedBy = alreadyGranted
            ? proficiencyProvenance(build, entries).find(
                item => item.proficiencyId === option.entryId && item.grant === "automatic",
              )?.sourceEntryName
            : undefined;
          return {
            id: option.id,
            label: option.label,
            ...(option.entryId ? { entryId: option.entryId } : {}),
            alreadyGranted,
            ...(grantedBy ? { grantedBy } : {}),
          };
        }),
        selected,
        resolved:
          selected.length >= choice.min && selected.length <= choice.max && new Set(selected).size === selected.length,
        incompatibleOptions: incompatibleOptionsFor(choice, build, entries),
      });
    }
  }
  void byId;
  return required;
}

/** Equipment choices the build's granted bundles require. */
export function requiredEquipmentChoices(build: CharacterDraftBuild, entries: readonly ContentEntry[]) {
  const granting = grantingEntriesFor([build.classId, build.speciesId, build.backgroundId], entries);
  return equipmentChoicesFor(granting, entries);
}

/** Ability-generation methods the ruleset offers. */
export function abilityMethodsFor(entries: readonly ContentEntry[]) {
  return abilityGenerationMethods(entries);
}

/** True when the class grants no spells at the draft's level (D-02). */
export function classHasSpells(build: CharacterDraftBuild, entries: readonly ContentEntry[]): boolean {
  const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
  if (!classEntry) return false;
  return classEntry.effects.some(effect => effect.type === "addSpell" || effect.type === "addSpellList");
}

/** Resources the class grants, used by the Spells & resources step. */
export function resourceIdsFor(build: CharacterDraftBuild, entries: readonly ContentEntry[]): ID[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const classEntry = build.classId ? byId.get(build.classId) : undefined;
  if (classEntry?.category !== "class") return [];
  const mechanics = classMechanicsSchema.safeParse(classEntry.mechanics);
  if (!mechanics.success) return [];
  return [
    ...new Set(
      mechanics.data.progression
        .filter(row => row.level <= build.level)
        .flatMap(row => Object.keys(row.resourceChanges)),
    ),
  ].sort();
}

const sameMultiset = (left: readonly number[], right: readonly number[]) =>
  left.length === right.length && [...left].sort((a, b) => b - a).every((value, index) => value === [...right].sort((a, b) => b - a)[index]);

/**
 * The array slots still available after the given assignments.
 *
 * Slots, not distinct values. An array may legitimately contain the same number
 * more than once, and each occurrence is its own slot: assigning 13 once must
 * leave a second 13 assignable, and assigning it twice must exhaust both. A
 * `Set` of numbers would collapse them and silently allow one value to serve
 * two abilities.
 *
 * The returned order follows the array's own declaration order.
 */
export function remainingArraySlots(
  array: readonly number[],
  assigned: readonly (number | undefined)[],
): number[] {
  const remaining = [...array];
  for (const value of assigned) {
    if (typeof value !== "number") continue;
    const slot = remaining.indexOf(value);
    if (slot >= 0) remaining.splice(slot, 1);
  }
  return remaining;
}

/**
 * A draft stores final ability scores, so validating the standard array means
 * asking whether *some* assignment of the array plus the origin's increase
 * pattern reproduces them. Brammel's 16/15/14/12/10/8 is the array 15/14/13/12/10/8
 * with the Caravan Warden +2 on Strength and +1 on Constitution.
 */
export function standardArrayConsistent(build: CharacterDraftBuild, entries: readonly ContentEntry[]): boolean {
  const standardArray = standardArrayFor(entries);
  // A ruleset that declares no fixed array has nothing to check against.
  if (!standardArray) return true;
  const scores = ABILITIES.map(ability => build.abilityScores[ability]);
  if (scores.some(score => typeof score !== "number")) return true;
  const finals = scores as number[];

  const background = build.backgroundId ? entries.find(entry => entry.id === build.backgroundId) : undefined;
  const choices = (background?.mechanics as { abilityScoreChoices?: { abilities?: unknown; increasePattern?: unknown } } | undefined)
    ?.abilityScoreChoices;
  const allowed = Array.isArray(choices?.abilities) ? choices.abilities.filter((item): item is string => typeof item === "string") : [];
  const pattern = Array.isArray(choices?.increasePattern)
    ? choices.increasePattern.filter((item): item is number => typeof item === "number")
    : [];
  if (!allowed.length || !pattern.length) return sameMultiset(finals, standardArray);

  // Try every assignment of the increase pattern to distinct allowed abilities.
  const indexes = allowed
    .map(name => ABILITIES.indexOf(name as Ability))
    .filter(index => index >= 0);
  const assign = (remaining: readonly number[], used: ReadonlySet<number>, candidate: readonly number[]): boolean => {
    if (!remaining.length) return sameMultiset(candidate, standardArray);
    const [increase, ...rest] = remaining;
    return indexes.some(index => {
      if (used.has(index)) return false;
      const next = [...candidate];
      next[index] -= increase;
      return assign(rest, new Set([...used, index]), next);
    });
  };
  return assign(pattern, new Set(), finals);
}

function abilityIssues(build: CharacterDraftBuild, entries: readonly ContentEntry[]): ServiceIssue[] {
  const issues: ServiceIssue[] = [];
  for (const ability of ABILITIES)
    if (typeof build.abilityScores[ability] !== "number")
      issues.push({ code: "ABILITY_SCORE_MISSING", fieldPath: `abilityScore.${ability}`, severity: "error" });
  if (build.abilityMethod === "standard-array" && !issues.length && !standardArrayConsistent(build, entries))
    issues.push({ code: "STANDARD_ARRAY_MISMATCH", fieldPath: "abilityMethod", severity: "warning" });
  return issues;
}

export function planBuild(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  presentation: CharacterPresentationMode = "guided",
): BuildPlan {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const requiredChoices = build.manualSheet === true ? [] : requiredChoicesFor(build, entries);
  const hasSpells = classHasSpells(build, entries);

  const stepIssues: Record<BuilderStepId, ServiceIssue[]> = {
    start: [],
    class: [],
    origin: [],
    abilities: [],
    "class-choices": [],
    "spells-resources": [],
    equipment: [],
    identity: [],
    review: [],
  };

  const manualSheet = build.manualSheet === true;

  /**
   * Steps that actually apply to this build.
   *
   * A step with nothing to decide is omitted from the sequence rather than
   * shown as an empty "Not needed" screen the user still has to walk through.
   * Applicability is derived from content — `classHasSpells` inspects the
   * selected class's own progression — so a future spell-capable class brings
   * the step back with no change here and no reference to any class ID.
   */
  const choicesInStep = (stepId: BuilderStepId) => requiredChoices.some(choice => choice.stepId === stepId);
  // Equipment applies when the build's granted bundles actually offer a choice.
  const equipmentChoices = manualSheet ? [] : requiredEquipmentChoices(build, entries);
  /**
   * Whether the build has chosen enough for "this step is empty" to be a fact
   * rather than a not-yet.
   *
   * Omitting a step the moment it is empty makes the progress denominator grow
   * as the user selects a class and background — step 1 of 6 becoming 1 of 8 —
   * which is more disorienting than the empty screen it avoids. A step is only
   * dropped once the build is determinate enough to know it will stay empty.
   */
  const originDecided = Boolean(build.classId && build.backgroundId);
  const applicableSteps = new Set<BuilderStepId>(
    BUILDER_STEPS.filter(step => {
      switch (step.id) {
        // Spellcasting is determinate from the class alone, and a class with no
        // spells never gains any, so this is safe to drop immediately.
        case "spells-resources":
          return hasSpells;
        case "equipment":
          return !originDecided || equipmentChoices.length > 0;
        case "class-choices":
          // Manual sheets use this step for their explicit minimum, so it stays.
          return manualSheet || !originDecided || choicesInStep("class-choices");
        default:
          return true;
      }
    }).map(step => step.id),
  );

  if (manualSheet) {
    // A manual sheet needs its own explicit minimum (D-03) and no class.
    for (const [path, step] of MANUAL_MINIMUM)
      if (typeof build.manualValues[path] !== "number")
        stepIssues[step].push({ code: "MANUAL_VALUE_MISSING", fieldPath: path, severity: "error" });
    if (!build.manualActions.length)
      stepIssues["class-choices"].push({ code: "MANUAL_ACTION_MISSING", fieldPath: "manualActions", severity: "error" });
  } else {
    // The target level must be one the class's own progression describes.
    const maximumLevel = maximumLevelFor(build, entries);
    if (build.level < 1)
      stepIssues.start.push({ code: "TARGET_LEVEL_INVALID", fieldPath: "level", severity: "error" });
    else if (maximumLevel !== undefined && build.level > maximumLevel)
      stepIssues.start.push({ code: "TARGET_LEVEL_UNSUPPORTED", fieldPath: "level", severity: "error" });

    // A subclass is required once the target level has reached the class's own
    // subclass level. Below it, a stored subclass is simply not yet active.
    const subclassLevel = subclassLevelFor(build, entries);
    if (subclassLevel !== undefined && build.level >= subclassLevel) {
      const options = subclassOptionsFor(build, entries);
      if (!build.subclassId)
        stepIssues["class-choices"].push({ code: "SUBCLASS_NOT_CHOSEN", fieldPath: "subclassId", severity: "error" });
      else if (!options.some(option => option.id === build.subclassId))
        stepIssues["class-choices"].push({
          code: "SUBCLASS_INVALID_FOR_CLASS",
          recordId: build.subclassId,
          severity: "error",
        });
    }

    if (!build.classId) stepIssues.class.push({ code: "CLASS_NOT_CHOSEN", fieldPath: "classId", severity: "error" });
    else if (!byId.has(build.classId))
      stepIssues.class.push({ code: "CLASS_SOURCE_MISSING", recordId: build.classId, severity: "error" });

    if (!build.speciesId) stepIssues.origin.push({ code: "SPECIES_NOT_CHOSEN", fieldPath: "speciesId", severity: "error" });
    else if (!byId.has(build.speciesId))
      stepIssues.origin.push({ code: "SPECIES_SOURCE_MISSING", recordId: build.speciesId, severity: "error" });
    if (!build.backgroundId)
      stepIssues.origin.push({ code: "BACKGROUND_NOT_CHOSEN", fieldPath: "backgroundId", severity: "error" });
    else if (!byId.has(build.backgroundId))
      stepIssues.origin.push({ code: "BACKGROUND_SOURCE_MISSING", recordId: build.backgroundId, severity: "error" });
  }

  stepIssues.abilities.push(...abilityIssues(build, entries));

  for (const choice of requiredChoices) {
    if (!choice.resolved)
      stepIssues[choice.stepId].push({ code: "CHOICE_UNRESOLVED", recordId: choice.choiceId, severity: "error" });
    // A selected option the build cannot satisfy is reported, never replaced.
    for (const incompatible of choice.incompatibleOptions) {
      if (!choice.selected.includes(incompatible.optionId)) continue;
      stepIssues[choice.stepId].push({
        code: "CHOICE_OPTION_INCOMPATIBLE",
        recordId: incompatible.optionId,
        severity: incompatible.enforcement === "hard" ? "error" : "warning",
      });
    }
  }

  // Equipment choices come from whatever bundles the build's entries grant.
  for (const choice of equipmentChoices) {
    const selected = build.equipmentSelections[choice.choiceId] ?? [];
    const resolved =
      selected.length >= choice.min && selected.length <= choice.max && new Set(selected).size === selected.length;
    if (!resolved)
      stepIssues.equipment.push({ code: "EQUIPMENT_CHOICE_REQUIRED", recordId: choice.choiceId, severity: "error" });
  }

  // Identity never blocks the sheet; a missing name falls back safely (D-03).
  if (!build.name.trim()) stepIssues.identity.push({ code: "NAME_NOT_SET", fieldPath: "name", severity: "warning" });

  const steps: PlannedStep[] = BUILDER_STEPS.filter(step => applicableSteps.has(step.id)).map(step => {
    const issues = stepIssues[step.id];
    const blocking = issues.some(issue => issue.severity === "error");
    if (step.id === "review") {
      const outstanding = Object.entries(stepIssues).some(([id, list]) => id !== "review" && list.some(issue => issue.severity === "error"));
      return { ...step, status: outstanding ? "incomplete" : "complete", issues, optional: false };
    }
    return {
      ...step,
      status: blocking ? "incomplete" : "complete",
      issues,
      // Flexible mode may save with any step outstanding; identity never blocks.
      optional: presentation === "flexible" || step.id === "identity" || step.id === "start",
    };
  });

  // Only applicable steps can contribute issues; an omitted step has nothing to
  // resolve, so counting it would report an issue the user cannot reach.
  const allIssues = steps.flatMap(step => stepIssues[step.id]);
  const nextUnresolved = steps.find(step => step.status === "incomplete" && step.id !== "review");
  return {
    steps,
    requiredChoices,
    issues: allIssues,
    issueCount: allIssues.length,
    nextUnresolvedStepId: nextUnresolved?.id ?? "review",
    guidedComplete: !allIssues.some(issue => issue.severity === "error"),
    systemSummaries: [
      {
        id: "spellcasting",
        label: "Spellcasting",
        // Stated on the review rather than as a step, so the absence is
        // recorded without costing the user a screen.
        value: hasSpells ? "Choices made in Spells & resources" : "None at this level",
        applicable: hasSpells,
      },
    ],
  };
}

/**
 * Guided recommendations for a step. Each carries "Why this?" copy and a rank;
 * the caller renders them in rank order and never applies one automatically.
 */
export function recommendationsFor(
  stepId: BuilderStepId,
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const primaryAbility = (): Ability | undefined => {
    const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
    if (classEntry?.category !== "class") return undefined;
    const mechanics = classMechanicsSchema.safeParse(classEntry.mechanics);
    return mechanics.success ? (mechanics.data.primaryAbilities[0] as Ability) : undefined;
  };

  if (stepId === "class")
    for (const entry of entries.filter(item => item.category === "class"))
      recommendations.push({
        optionId: entry.id,
        label: entry.name,
        why: "Holds a front rank with a shield and a limited rally resource, so every core play surface is exercised at level 1.",
        rank: 1,
      });

  if (stepId === "origin") {
    for (const entry of entries.filter(item => item.category === "species"))
      recommendations.push({ optionId: entry.id, label: entry.name, why: "A 30 ft. walking speed and sure footing suit a front-rank escort.", rank: 1 });
    for (const entry of entries.filter(item => item.category === "background"))
      recommendations.push({
        optionId: entry.id,
        label: entry.name,
        why: "Its +2/+1 increase lands on Strength and Constitution, which this class uses most.",
        rank: 1,
      });
  }

  if (stepId === "abilities") {
    const ability = primaryAbility();
    recommendations.push({
      optionId: "standard-array",
      label: "Standard array",
      why: ability
        ? `Assign the highest value to ${ability[0].toUpperCase()}${ability.slice(1)}, the class's primary ability, then Constitution.`
        : "A balanced starting spread that needs no rolling.",
      rank: 1,
    });
    recommendations.push({ optionId: "manual", label: "Enter scores manually", why: "Use this when your table agreed a different generation method.", rank: 2 });
  }

  if (stepId === "class-choices") {
    for (const choice of requiredChoicesFor(build, entries).filter(choice => choice.stepId === stepId))
      for (const option of choice.options)
        recommendations.push({
          optionId: option.id,
          label: option.label,
          why: "A context-valid option for this class at this level.",
          rank: 1,
        });
  }

  if (stepId === "equipment") {
    for (const choice of requiredEquipmentChoices(build, entries))
      for (const option of choice.options)
        recommendations.push({ optionId: option.id, label: option.label, why: "Offered by the granted starting kit.", rank: 1 });
  }

  return recommendations.sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
}
