import {
  backgroundMechanicsSchema,
  classMechanicsSchema,
  lineageMechanicsSchema,
  raceMechanicsSchema,
  speciesMechanicsSchema,
  subclassMechanicsSchema,
} from "@/src/domain/content-pack";
import type { Character, ChoiceDefinition, ContentEntry, Effect, EquipmentBundleDefinition, ID } from "@/src/domain/model";
import { resolveChoices, type ChoiceSelections } from "@/src/rules/choice-resolution";
import { resolveEquipmentBundles, type EquipmentChoiceSelections, type EquipmentResolution } from "@/src/rules/equipment";
import { abilityModifier, applyEffects, evaluateCondition, type RuleContext, type RuleResult } from "@/src/rules/engine";

export interface DerivedCharacterIssue {
  code:
    | "CHARACTER_LEVEL_MISMATCH" | "DUPLICATE_CLASS_SELECTION" | "CLASS_MISSING" | "CLASS_MECHANICS_INVALID" | "MULTICLASS_PREREQUISITE_FAILED"
    | "MULTICLASS_COMBINATION_UNSUPPORTED" | "MULTICLASS_PACT_SLOTS_SEPARATE" | "SUBCLASS_INVALID"
    | "IDENTITY_MECHANICS_INVALID" | "LINEAGE_INVALID"
    | "FEATURE_REFERENCE_MISSING" | "ENTRY_PREREQUISITE_FAILED" | "CHOICE_UNRESOLVED" | "EQUIPMENT_UNRESOLVED" | "EFFECT_REVIEW_REQUIRED" | "EFFECT_FAILED";
  severity: "error" | "review-required";
  recordId: ID;
  message: string;
}

export interface SpellSlotState { combinedCasterLevel: number; slotsBySpellLevel: Record<number, number>; pactClassLevels: Record<ID, number> }
export interface DerivedCharacterState {
  status: "ready" | "review-required" | "invalid";
  activeEntryIds: Set<ID>;
  classFeatureIds: Set<ID>;
  /** Species, lineage and legacy-race traits activated after lineage replacement. */
  identityTraitIds: Set<ID>;
  pendingChoiceIds: Set<ID>;
  ruleResult: RuleResult;
  equipment: EquipmentResolution;
  spellSlots: SpellSlotState;
  issues: DerivedCharacterIssue[];
}

const MULTICLASS_SLOTS: readonly (readonly number[])[] = [
  [], [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1],
  [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1],
  [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

function initialContext(character: Character): RuleContext {
  return {
    totalLevel: character.level,
    classLevels: Object.fromEntries(character.classLevels.map(item => [item.classId, item.level])),
    abilities: { ...character.abilities },
    tags: new Set(character.tags), features: new Set(), proficiencies: new Set(), armor: { worn: false }, flags: {},
    values: { initiative: abilityModifier(character.abilities.dexterity), criticalRange: 20 },
  };
}

function slotsFor(classes: Array<{ id: ID; level: number; progression: "none" | "full" | "half" | "third" | "pact"; rounding: "down" | "up" }>): SpellSlotState {
  let combinedCasterLevel = 0;
  const pactClassLevels: Record<ID, number> = {};
  for (const item of classes) {
    if (item.progression === "full") combinedCasterLevel += item.level;
    else if (item.progression === "half") combinedCasterLevel += item.rounding === "up" ? Math.ceil(item.level / 2) : Math.floor(item.level / 2);
    else if (item.progression === "third") combinedCasterLevel += item.rounding === "up" ? Math.ceil(item.level / 3) : Math.floor(item.level / 3);
    else if (item.progression === "pact") pactClassLevels[item.id] = item.level;
  }
  combinedCasterLevel = Math.min(20, combinedCasterLevel);
  return {
    combinedCasterLevel,
    slotsBySpellLevel: Object.fromEntries((MULTICLASS_SLOTS[combinedCasterLevel] ?? []).map((count, index) => [index + 1, count])),
    pactClassLevels,
  };
}

export function deriveCharacterState(input: {
  character: Character;
  entries: readonly ContentEntry[];
  choiceSelections?: ChoiceSelections;
  equipmentSelections?: EquipmentChoiceSelections;
}): DerivedCharacterState {
  const { character, entries } = input;
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const context = initialContext(character), issues: DerivedCharacterIssue[] = [], activeEntryIds = new Set<ID>();
  const classFeatureIds = new Set<ID>(), progressionChoiceIds = new Set<ID>();
  const casterClasses: Array<{ id: ID; level: number; progression: "none" | "full" | "half" | "third" | "pact"; rounding: "down" | "up" }> = [];
  const totalClassLevels = character.classLevels.reduce((sum, item) => sum + item.level, 0);
  if (totalClassLevels !== character.level)
    issues.push({ code: "CHARACTER_LEVEL_MISMATCH", severity: "error", recordId: character.id, message: `Character ${character.id} has inconsistent total and class levels` });
  const duplicateClassIds = character.classLevels.map(item => item.classId).filter((id, index, ids) => ids.indexOf(id) !== index);
  for (const classId of new Set(duplicateClassIds)) issues.push({ code: "DUPLICATE_CLASS_SELECTION", severity: "error", recordId: classId, message: `Class ${classId} occurs more than once in the character progression` });

  character.classLevels.forEach((selection, index) => {
    const entry = byId.get(selection.classId);
    if (!entry || entry.category !== "class") {
      issues.push({ code: "CLASS_MISSING", severity: "error", recordId: selection.classId, message: `Class ${selection.classId} is unavailable` });
      return;
    }
    const parsed = classMechanicsSchema.safeParse(entry.mechanics);
    if (!parsed.success) {
      issues.push({ code: "CLASS_MECHANICS_INVALID", severity: "error", recordId: entry.id, message: `Class ${entry.id} has invalid runtime mechanics` });
      return;
    }
    activeEntryIds.add(entry.id);
    const mechanics = parsed.data;
    if (index === 0) for (const proficiencyId of [...mechanics.savingThrows, ...mechanics.startingProficiencyIds]) context.proficiencies.add(proficiencyId);
    if (index > 0) {
      if (!mechanics.multiclass) {
        issues.push({ code: "MULTICLASS_COMBINATION_UNSUPPORTED", severity: "error", recordId: entry.id, message: `Class ${entry.id} has no multiclass semantics` });
      } else {
        for (const prerequisite of mechanics.multiclass.prerequisites) if (!evaluateCondition(prerequisite.condition, context))
          issues.push({ code: "MULTICLASS_PREREQUISITE_FAILED", severity: prerequisite.enforcement === "hard" ? "error" : "review-required", recordId: entry.id, message: `Class ${entry.id} does not satisfy multiclass prerequisite ${prerequisite.id}` });
        for (const proficiencyId of mechanics.multiclass.grantedProficiencyIds) context.proficiencies.add(proficiencyId);
        if (character.classLevels.some(other => mechanics.multiclass?.unsupportedWithClassIds.includes(other.classId)))
          issues.push({ code: "MULTICLASS_COMBINATION_UNSUPPORTED", severity: "error", recordId: entry.id, message: `Class ${entry.id} declares this class combination unsupported` });
      }
    }
    const slotProgression = mechanics.multiclass?.spellSlotProgression ?? "none";
    casterClasses.push({ id: entry.id, level: selection.level, progression: slotProgression, rounding: mechanics.multiclass?.spellSlotRounding ?? "down" });
    for (const row of mechanics.progression.filter(row => row.level <= selection.level)) {
      for (const featureId of row.featureIds) classFeatureIds.add(featureId);
      for (const choiceId of row.choiceIds) progressionChoiceIds.add(choiceId);
      for (const [resourceId, amount] of Object.entries(row.resourceChanges)) context.values[`resource.${resourceId}`] = amount;
    }
    if (selection.subclassId) {
      const subclass = byId.get(selection.subclassId), subclassMechanics = subclass?.category === "subclass" ? subclassMechanicsSchema.safeParse(subclass.mechanics) : undefined;
      if (!subclass || !subclassMechanics?.success || subclassMechanics.data.classId !== entry.id || selection.level < mechanics.subclassLevel || !mechanics.subclassIds.includes(subclass.id)) {
        issues.push({ code: "SUBCLASS_INVALID", severity: "error", recordId: selection.subclassId, message: `Subclass ${selection.subclassId} is invalid for class ${entry.id}` });
      } else {
        activeEntryIds.add(subclass.id);
        for (const row of subclassMechanics.data.progression.filter(row => row.level <= selection.level)) {
          for (const featureId of row.featureIds) classFeatureIds.add(featureId);
          for (const choiceId of row.choiceIds) progressionChoiceIds.add(choiceId);
        }
      }
    }
  });

  const identityEntry = (id: ID | undefined, category: ContentEntry["category"]): ContentEntry | undefined => {
    if (!id) return undefined;
    const entry = byId.get(id);
    if (!entry || entry.category !== category) {
      issues.push({ code: "FEATURE_REFERENCE_MISSING", severity: "error", recordId: id, message: `Selected entry ${id} is unavailable` });
      return undefined;
    }
    activeEntryIds.add(entry.id);
    return entry;
  };
  const mechanicsInvalid = (entry: ContentEntry) =>
    issues.push({ code: "IDENTITY_MECHANICS_INVALID", severity: "error", recordId: entry.id, message: `Entry ${entry.id} has invalid runtime mechanics` });
  const inheritedTraitIds = new Set<ID>(), replacedTraitIds = new Set<ID>(), identityTraitIds = new Set<ID>();
  let baseSpeed: number | undefined;
  const species = identityEntry(character.speciesId, "species");
  if (species) {
    const parsed = speciesMechanicsSchema.safeParse(species.mechanics);
    if (!parsed.success) mechanicsInvalid(species);
    else {
      baseSpeed = parsed.data.speed;
      for (const traitId of parsed.data.traitIds) inheritedTraitIds.add(traitId);
    }
  }
  const legacyRace = identityEntry(character.legacyRaceId, "race");
  if (legacyRace) {
    const parsed = raceMechanicsSchema.safeParse(legacyRace.mechanics);
    if (!parsed.success) mechanicsInvalid(legacyRace);
    else {
      baseSpeed = baseSpeed ?? parsed.data.speed;
      for (const traitId of parsed.data.traitIds) inheritedTraitIds.add(traitId);
    }
  }
  const lineage = identityEntry(character.lineageId, "lineage");
  if (lineage) {
    const parsed = lineageMechanicsSchema.safeParse(lineage.mechanics);
    if (!parsed.success) mechanicsInvalid(lineage);
    else {
      if (species && parsed.data.parentSpeciesIds.length && !parsed.data.parentSpeciesIds.includes(species.id))
        issues.push({ code: "LINEAGE_INVALID", severity: "error", recordId: lineage.id, message: `Lineage ${lineage.id} is not available for species ${species.id}` });
      for (const traitId of parsed.data.replacesTraitIds) replacedTraitIds.add(traitId);
      for (const traitId of parsed.data.traitIds) identityTraitIds.add(traitId);
    }
  }
  for (const traitId of inheritedTraitIds) if (!replacedTraitIds.has(traitId)) identityTraitIds.add(traitId);
  const background = identityEntry(character.backgroundId, "background");
  if (background) {
    const parsed = backgroundMechanicsSchema.safeParse(background.mechanics);
    if (!parsed.success) mechanicsInvalid(background);
    else {
      for (const proficiencyId of parsed.data.proficiencyIds) context.proficiencies.add(proficiencyId);
      if (byId.has(parsed.data.featId)) activeEntryIds.add(parsed.data.featId);
      else issues.push({ code: "FEATURE_REFERENCE_MISSING", severity: "error", recordId: parsed.data.featId, message: `Background feat ${parsed.data.featId} is unavailable` });
    }
  }
  if (baseSpeed !== undefined) context.values.speed = baseSpeed;
  for (const traitId of identityTraitIds) {
    if (byId.has(traitId)) activeEntryIds.add(traitId);
    else issues.push({ code: "FEATURE_REFERENCE_MISSING", severity: "error", recordId: traitId, message: `Trait ${traitId} is unavailable` });
  }
  for (const featureId of classFeatureIds) {
    if (byId.has(featureId)) activeEntryIds.add(featureId);
    else issues.push({ code: "FEATURE_REFERENCE_MISSING", severity: "error", recordId: featureId, message: `Feature ${featureId} is unavailable` });
  }
  const activeEntries: ContentEntry[] = [];
  for (const id of activeEntryIds) {
    const entry = byId.get(id);
    if (entry) activeEntries.push(entry);
  }
  const choiceDefinitions: ChoiceDefinition[] = activeEntries.flatMap(entry =>
    entry.category === "class" || entry.category === "subclass"
      ? entry.choices.filter(choice => progressionChoiceIds.has(choice.id))
      : entry.choices
  );
  const knownChoiceIds = new Set(choiceDefinitions.map(choice => choice.id));
  for (const choiceId of progressionChoiceIds) if (!knownChoiceIds.has(choiceId))
    issues.push({ code: "CHOICE_UNRESOLVED", severity: "error", recordId: choiceId, message: `Progression choice ${choiceId} is unavailable` });
  const choiceResolution = resolveChoices(choiceDefinitions, input.choiceSelections ?? {});
  for (const issue of choiceResolution.issues)
    issues.push({ code: "CHOICE_UNRESOLVED", severity: "error", recordId: issue.choiceId, message: issue.message });
  const selectedEntries: ContentEntry[] = [];
  for (const entryId of choiceResolution.entryIds) {
    activeEntryIds.add(entryId);
    const selectedEntry = byId.get(entryId);
    if (selectedEntry) selectedEntries.push(selectedEntry);
    else issues.push({ code: "FEATURE_REFERENCE_MISSING", severity: "error", recordId: entryId, message: `Selected entry ${entryId} is unavailable` });
  }
  const effectiveEntries = [...activeEntries, ...selectedEntries];
  for (const activeEntry of effectiveEntries) for (const prerequisite of activeEntry.prerequisites) if (!evaluateCondition(prerequisite.condition, context))
    issues.push({ code: "ENTRY_PREREQUISITE_FAILED", severity: prerequisite.enforcement === "hard" ? "error" : "review-required", recordId: activeEntry.id, message: `Entry ${activeEntry.id} does not satisfy prerequisite ${prerequisite.id}` });
  const effects: Effect[] = [...effectiveEntries.flatMap(entry => entry.effects), ...choiceResolution.effects];
  const ruleResult = applyEffects(context, effects, { resolvedChoiceIds: choiceResolution.resolvedChoiceIds });
  for (const issue of ruleResult.issues) issues.push({
    code: issue.code === "RULE_EFFECT_FAILED" ? "EFFECT_FAILED" : issue.code === "RULE_EFFECT_REVIEW_REQUIRED" ? "EFFECT_REVIEW_REQUIRED" : "CHOICE_UNRESOLVED",
    severity: issue.severity === "error" ? "error" : "review-required",
    recordId: issue.affectedRule ?? character.id,
    message: issue.message,
  });
  const bundleDefinitions: EquipmentBundleDefinition[] = entries.flatMap(entry => entry.equipmentBundles ?? []);
  const backgroundBundles = effectiveEntries.filter(entry => entry.category === "background").flatMap(entry => {
    const ids = (entry.mechanics as { equipmentBundleIds?: unknown }).equipmentBundleIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  });
  const equipment = resolveEquipmentBundles([...ruleResult.equipmentBundleIds, ...backgroundBundles], bundleDefinitions, input.equipmentSelections ?? {}, new Set(entries.filter(entry => ["item", "weapon", "armor", "tool"].includes(entry.category)).map(entry => entry.id)));
  for (const issue of equipment.issues) issues.push({ code: "EQUIPMENT_UNRESOLVED", severity: "error", recordId: issue.bundleId, message: issue.message });
  const spellSlots = slotsFor(casterClasses);
  if (Object.keys(spellSlots.pactClassLevels).length && casterClasses.some(item => item.progression !== "none" && item.progression !== "pact"))
    issues.push({ code: "MULTICLASS_PACT_SLOTS_SEPARATE", severity: "review-required", recordId: character.id, message: `Character ${character.id} requires separate pact-slot tracking` });
  const status = issues.some(issue => issue.severity === "error") ? "invalid" : issues.length ? "review-required" : "ready";
  return { status, activeEntryIds, classFeatureIds, identityTraitIds, pendingChoiceIds: new Set([...choiceResolution.unresolvedChoiceIds, ...ruleResult.pendingChoices]), ruleResult, equipment, spellSlots, issues };
}
