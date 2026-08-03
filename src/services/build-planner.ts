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
import type { Ability, ChoiceDefinition, ContentEntry, ID } from "@/src/domain/model";
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

export type StepStatus = "complete" | "incomplete" | "not-needed";

export interface PlannedStep {
  id: BuilderStepId;
  label: string;
  status: StepStatus;
  /** Shown instead of hiding a conditional step once it has been reached. */
  note?: string;
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

export interface RequiredChoice {
  choiceId: ID;
  label: string;
  min: number;
  max: number;
  stepId: BuilderStepId;
  options: readonly { id: ID; label: string }[];
  selected: readonly ID[];
  resolved: boolean;
  /** Options whose prerequisites the current build does not satisfy. */
  incompatibleOptions: readonly OptionIncompatibility[];
}

export interface BuildPlan {
  steps: readonly PlannedStep[];
  requiredChoices: readonly RequiredChoice[];
  issues: readonly ServiceIssue[];
  issueCount: number;
  /** The next step the user should resolve, or `review` when nothing is open. */
  nextUnresolvedStepId: BuilderStepId;
  /** Every required ruleset choice resolved with no blocking issue. */
  guidedComplete: boolean;
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
export function requiredChoicesFor(build: CharacterDraftBuild, entries: readonly ContentEntry[]): RequiredChoice[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const required: RequiredChoice[] = [];
  const push = (choice: ChoiceDefinition, stepId: BuilderStepId) => {
    const selected = build.choiceSelections[choice.id] ?? [];
    required.push({
      choiceId: choice.id,
      label: choice.label,
      min: choice.min,
      max: choice.max,
      stepId,
      options: choice.options.map(option => ({ id: option.id, label: option.label })),
      selected,
      resolved: selected.length >= choice.min && selected.length <= choice.max && new Set(selected).size === selected.length,
      incompatibleOptions: incompatibleOptionsFor(choice, build, entries),
    });
  };

  const classEntry = build.classId ? byId.get(build.classId) : undefined;
  if (classEntry?.category === "class") {
    const mechanics = classMechanicsSchema.safeParse(classEntry.mechanics);
    if (mechanics.success) {
      const activeChoiceIds = new Set(
        mechanics.data.progression.filter(row => row.level <= build.level).flatMap(row => row.choiceIds),
      );
      for (const choice of classEntry.choices) if (activeChoiceIds.has(choice.id)) push(choice, "class-choices");
    }
  }
  const backgroundEntry = build.backgroundId ? byId.get(build.backgroundId) : undefined;
  if (backgroundEntry) for (const choice of backgroundEntry.choices) push(choice, "origin");
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
  const resources = resourceIdsFor(build, entries);

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

  if (manualSheet) {
    // A manual sheet needs its own explicit minimum (D-03) and no class.
    for (const [path, step] of MANUAL_MINIMUM)
      if (typeof build.manualValues[path] !== "number")
        stepIssues[step].push({ code: "MANUAL_VALUE_MISSING", fieldPath: path, severity: "error" });
    if (!build.manualActions.length)
      stepIssues["class-choices"].push({ code: "MANUAL_ACTION_MISSING", fieldPath: "manualActions", severity: "error" });
  } else {
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
  for (const choice of manualSheet ? [] : requiredEquipmentChoices(build, entries)) {
    const selected = build.equipmentSelections[choice.choiceId] ?? [];
    const resolved =
      selected.length >= choice.min && selected.length <= choice.max && new Set(selected).size === selected.length;
    if (!resolved)
      stepIssues.equipment.push({ code: "EQUIPMENT_CHOICE_REQUIRED", recordId: choice.choiceId, severity: "error" });
  }

  // Identity never blocks the sheet; a missing name falls back safely (D-03).
  if (!build.name.trim()) stepIssues.identity.push({ code: "NAME_NOT_SET", fieldPath: "name", severity: "warning" });

  const steps: PlannedStep[] = BUILDER_STEPS.map(step => {
    const issues = stepIssues[step.id];
    const blocking = issues.some(issue => issue.severity === "error");
    if (step.id === "spells-resources" && !hasSpells) {
      return {
        ...step,
        // Visibly marked rather than disappearing after the user has seen it.
        status: "not-needed",
        note: resources.length
          ? "Not needed · This class has no spells at level 1"
          : "Not needed · This class has no spells or resources at level 1",
        issues,
        optional: true,
      };
    }
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

  const allIssues = BUILDER_STEPS.flatMap(step => stepIssues[step.id]);
  const nextUnresolved = steps.find(step => step.status === "incomplete" && step.id !== "review");
  return {
    steps,
    requiredChoices,
    issues: allIssues,
    issueCount: allIssues.length,
    nextUnresolvedStepId: nextUnresolved?.id ?? "review",
    guidedComplete: !allIssues.some(issue => issue.severity === "error"),
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
