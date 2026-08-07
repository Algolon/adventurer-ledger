/**
 * Pure creation planning for the M2.1 builder.
 *
 * Nothing here touches Dexie or React. It turns a draft plus content into the
 * step plan from AC-03, the sanitized issue list, and the guided recommendations
 * from AC-04. Recommendations are ranked and explained but never auto-selected,
 * and presentation mode changes guidance only: the same plan runs for guided and
 * flexible drafts, so switching modes cannot clear a selection.
 *
 * The planner composes three generic layers rather than hard-coding what a build
 * needs: `choice-planner` discovers activated entries and their choices,
 * `proficiency-planner` traces where each proficiency comes from, and
 * `content-scope` reads equipment grants out of bundle declarations. That is why
 * a subclass, a feat's nested choice or a background's kit appear with no
 * planner change and no reference to any particular entry.
 */
import {
  backgroundMechanicsSchema,
  classMechanicsSchema,
  raceMechanicsSchema,
  speciesMechanicsSchema,
} from "@/src/domain/content-pack";
import type { CharacterDraftBuild, CharacterPresentationMode } from "@/src/domain/character-record";
import { ABILITIES } from "@/src/domain/character-record";
import type { Ability, Category, ChoiceDefinition, ContentEntry, ID } from "@/src/domain/model";
import {
  abilityGenerationMethods,
  equipmentChoicesFor,
  equipmentGrantsFor,
  grantingEntriesFor,
  standardArrayFor,
  type EquipmentGrantView,
} from "@/src/services/content-scope";
import { evaluateCondition, type RuleContext } from "@/src/rules/engine";
import {
  draftContext,
  maxSupportedLevel,
  planActivation,
  SPECIES_CATEGORIES,
  type ActivationPlan,
  type LevelCoverage,
  type SubclassRequirement,
} from "@/src/services/choice-planner";
import {
  originIncreasePatternFor,
  reconcileAbilityAllocation,
  type AbilityAllocation,
} from "@/src/services/ability-allocation";
import {
  planProficiencies,
  redundantOptionKey,
  type ProficiencyPlan,
  type ProficiencySource,
} from "@/src/services/proficiency-planner";
import { createPlanningIndex, type PlanningIndex } from "@/src/services/planning-context";
import { BUILDER_STEPS, type BuilderStepId } from "@/src/services/builder-steps";
import type { ServiceIssue } from "@/src/services/contracts";

export { BUILDER_STEPS };
export type { BuilderStepId };
export type { SubclassRequirement, LevelCoverage } from "@/src/services/choice-planner";
export { maxSupportedLevel } from "@/src/services/choice-planner";

/**
 * Issues a commit may never proceed past, in any presentation mode, and which
 * an acknowledgement cannot buy off.
 *
 * Flexible mode exists so a half-finished build can be saved with its gaps
 * recorded. That is a statement about *missing* decisions. It is not a licence
 * to write a record the content cannot describe: a level the class has no
 * progression row for produces hit dice for one level and a maximum for
 * another, and no amount of acknowledging makes that sheet coherent. Unresolved
 * choices, absent origins and unset scores stay outside this set, because those
 * are exactly the incompleteness flexible mode is for.
 */
export const STRUCTURAL_COMMIT_BLOCKERS: ReadonlySet<string> = new Set(["LEVEL_NOT_COVERED_BY_CLASS"]);

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

export interface RequiredChoiceOption {
  id: ID;
  label: string;
  entryId?: ID;
  /**
   * Set when everything the option grants is already granted automatically.
   * Taking it would spend a decision for nothing, so the builder offers the
   * remaining options instead of letting the selection silently disappear.
   */
  alreadyGrantedBy?: ProficiencySource;
}

export interface RequiredChoice {
  choiceId: ID;
  label: string;
  min: number;
  max: number;
  stepId: BuilderStepId;
  options: readonly RequiredChoiceOption[];
  selected: readonly ID[];
  resolved: boolean;
  /** Options whose prerequisites the current build does not satisfy. */
  incompatibleOptions: readonly OptionIncompatibility[];
  /** Provenance: the entry that declares this choice. */
  sourceEntryId: ID;
  sourceLabel: string;
  sourceCategory: Category;
  /** The level at which the choice became reachable, when a progression set one. */
  level?: number;
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
  /** The explicit subclass decision, when the selected class declares one. */
  subclass?: SubclassRequirement;
  /** Where every proficiency comes from, and any duplicate selection. */
  proficiencies: ProficiencyPlan;
  /** Granted equipment, attributed to the entry that grants it. */
  equipmentGrants: readonly EquipmentGrantView[];
  /** Highest starting level the installed content honestly supports. */
  maxLevel: number;
  /** False when the class defines no progression row for the draft's level. */
  levelCovered: boolean;
  /** The full coverage verdict, which distinguishes "no class" from "covered". */
  levelCoverage: LevelCoverage;
  /** Highest level the selected class defines a contiguous progression for. */
  classProgressionMax?: number;
  /**
   * Base scores, the increases the active origin still authorises, and the
   * finals recomputed from the two. Review and the commit read these rather than
   * the raw stored finals, so an increase whose origin has been replaced cannot
   * keep contributing to a score.
   */
  abilities: AbilityAllocation;
}

/**
 * Options the current build cannot satisfy, with the repair that would help.
 *
 * The entry index and the evaluation context are accepted as arguments so one
 * planning pass builds them once. Rebuilding them per choice makes the cost of
 * planning scale with the number of choices times the size of the ruleset,
 * which is invisible on a small fixture and quadratic on a real one.
 */
export function incompatibleOptionsFor(
  choice: ChoiceDefinition,
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  index?: PlanningIndex,
): OptionIncompatibility[] {
  const byId = index?.byId ?? new Map(entries.map(entry => [entry.id, entry]));
  const context = index?.context ?? draftContext(build);
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

/**
 * Every choice the activated content requires at the draft's level.
 *
 * Discovery is generic (see `planActivation`): a choice reaches this list
 * because the entry that declares it is active, never because the planner knows
 * the entry. Identity is the choice's own stable ID, so the same choice reached
 * through two routes is presented once.
 */
export function requiredChoicesFor(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  activation: ActivationPlan = planActivation(build, entries),
  proficiencies: ProficiencyPlan = planProficiencies(activation, entries, build.choiceSelections),
): RequiredChoice[] {
  // Built once for the whole pass, not once per choice, and against the armour
  // the activation pass already resolved.
  const index = createPlanningIndex(build, entries, activation.armor);
  return activation.choices.map(activated => {
    const choice = activated.choice;
    const selected = build.choiceSelections[choice.id] ?? [];
    return {
      choiceId: choice.id,
      label: choice.label,
      min: choice.min,
      max: choice.max,
      stepId: activated.stepId,
      options: choice.options.map(option => {
        const redundant = proficiencies.redundantOptions.get(redundantOptionKey(choice.id, option.id));
        return {
          id: option.id,
          label: option.label,
          ...(option.entryId ? { entryId: option.entryId } : {}),
          ...(redundant ? { alreadyGrantedBy: redundant } : {}),
        };
      }),
      selected,
      /*
       * Resolved means the selection can actually be satisfied, not merely that
       * the right number of IDs are stored.
       *
       * Counting alone let a saved option the content had stopped offering read
       * as a finished step: no issue was raised, Review accepted it, and the
       * commit wrote a selection nothing could resolve. Requiring each selected
       * ID to still be one of this choice's options turns that into an ordinary
       * unresolved choice, reported against the step that owns it — and the
       * stored ID is left alone, so reinstalling the content resolves it again
       * without the user re-choosing anything.
       */
      resolved:
        selected.length >= choice.min &&
        selected.length <= choice.max &&
        new Set(selected).size === selected.length &&
        selected.every(optionId => choice.options.some(option => option.id === optionId)),
      incompatibleOptions: incompatibleOptionsFor(choice, build, entries, index),
      sourceEntryId: activated.sourceEntryId,
      sourceLabel: activated.sourceLabel,
      sourceCategory: activated.sourceCategory,
      ...(activated.level === undefined ? {} : { level: activated.level }),
    };
  });
}

/** Equipment choices the build's granted bundles require. */
export function requiredEquipmentChoices(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  activation: ActivationPlan = planActivation(build, entries),
) {
  return equipmentChoicesFor(grantingEntriesOf(build, entries, activation), entries);
}

/** Everything the build's granted bundles contain, with its provenance. */
export function equipmentGrantsForBuild(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  activation: ActivationPlan = planActivation(build, entries),
): EquipmentGrantView[] {
  return equipmentGrantsFor(grantingEntriesOf(build, entries, activation), entries);
}

/**
 * Entries that may grant equipment.
 *
 * Every activated entry qualifies — a subclass or a chosen feat grants a kit as
 * legitimately as a class does — with the class, species and background included
 * explicitly so a build that has not activated anything else still sees its
 * starting gear.
 */
function grantingEntriesOf(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  activation: ActivationPlan,
): ContentEntry[] {
  const seeds = grantingEntriesFor([build.classId, build.speciesId, build.backgroundId], entries);
  const seen = new Set(seeds.map(entry => entry.id));
  const combined = [...seeds];
  for (const activated of activation.entries) {
    if (seen.has(activated.entry.id)) continue;
    seen.add(activated.entry.id);
    combined.push(activated.entry);
  }
  return combined;
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
 * Whether the draft's scores are a legitimate standard-array assignment.
 *
 * A draft that recorded its base scores is checked directly: the base scores
 * must be exactly the array. A legacy draft that only stored final scores is
 * checked the way it always was, by asking whether *some* assignment of the
 * array plus the origin's increase pattern reproduces them, so an older saved
 * build keeps validating without being rewritten.
 */
export function standardArrayConsistent(build: CharacterDraftBuild, entries: readonly ContentEntry[]): boolean {
  const standardArray = standardArrayFor(entries);
  // A ruleset that declares no fixed array has nothing to check against.
  if (!standardArray) return true;

  const base = ABILITIES.map(ability => build.abilityBaseScores[ability]);
  if (base.every((score): score is number => typeof score === "number")) return sameMultiset(base, standardArray);

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

function abilityIssues(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  allocation: AbilityAllocation,
): ServiceIssue[] {
  const issues: ServiceIssue[] = [];
  for (const ability of ABILITIES)
    if (typeof allocation.final[ability] !== "number")
      issues.push({ code: "ABILITY_SCORE_MISSING", fieldPath: `abilityScore.${ability}`, severity: "error" });
  /*
   * An increase the active origin does not offer blocks rather than warns.
   *
   * It cannot be applied — the finals here are recomputed without it — so
   * leaving it recorded and merely noted would show the user an allocation the
   * sheet is not using. Naming the ability is enough to repair it, and it names
   * no value the user did not enter themselves.
   */
  for (const invalid of allocation.invalid)
    issues.push({
      code: "ORIGIN_INCREASE_NOT_AVAILABLE",
      fieldPath: `abilityIncrease.${invalid.ability}`,
      severity: "error",
    });
  if (build.abilityMethod === "standard-array" && !issues.length && !standardArrayConsistent(build, entries))
    issues.push({ code: "STANDARD_ARRAY_MISMATCH", fieldPath: "abilityMethod", severity: "warning" });
  return issues;
}

/** One issue per (code, record, path). The same fact is never reported twice. */
function dedupeIssues(issues: readonly ServiceIssue[]): ServiceIssue[] {
  const seen = new Set<string>();
  const unique: ServiceIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}|${issue.recordId ?? ""}|${issue.fieldPath ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(issue);
  }
  return unique;
}

export function planBuild(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  presentation: CharacterPresentationMode = "guided",
): BuildPlan {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const manualSheet = build.manualSheet === true;
  const allocation = reconcileAbilityAllocation(build, entries);
  const activation = planActivation(build, entries);
  const proficiencies = planProficiencies(activation, entries, build.choiceSelections);
  const requiredChoices = manualSheet ? [] : requiredChoicesFor(build, entries, activation, proficiencies);
  const equipmentGrants = manualSheet ? [] : equipmentGrantsForBuild(build, entries, activation);
  const equipmentChoices = manualSheet ? [] : requiredEquipmentChoices(build, entries, activation);
  const hasSpells = classHasSpells(build, entries);

  const stepIssues: Record<BuilderStepId, ServiceIssue[]> = {
    start: [],
    class: [],
    origin: [],
    background: [],
    abilities: [],
    "class-choices": [],
    "spells-resources": [],
    equipment: [],
    identity: [],
    review: [],
  };

  /**
   * Steps that actually apply to this build.
   *
   * A step with nothing to decide is omitted from the sequence rather than
   * shown as an empty "Not needed" screen the user still has to walk through.
   * Applicability is derived from content — `classHasSpells` inspects the
   * selected class's own progression, and Equipment appears whenever something
   * is granted or chosen — so no step is hidden by a rule about a named entry.
   */
  const equipmentApplies =
    manualSheet ||
    // Before a class exists there is nothing to conclude from, so the step
    // stays. It is dropped only once the build genuinely grants and offers
    // nothing — which is the difference between "no equipment" and "not yet".
    !build.classId ||
    equipmentGrants.length > 0 ||
    equipmentChoices.length > 0;
  const applicableSteps = new Set<BuilderStepId>(
    BUILDER_STEPS.filter(
      step =>
        (step.id !== "spells-resources" || hasSpells) && (step.id !== "equipment" || equipmentApplies),
    ).map(step => step.id),
  );

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
    /*
     * The background is judged on its own step, next to the only control that
     * can repair it. Reporting it against Species would mark a step incomplete
     * for a decision that step does not present.
     */
    if (!build.backgroundId)
      stepIssues.background.push({ code: "BACKGROUND_NOT_CHOSEN", fieldPath: "backgroundId", severity: "error" });
    else if (!byId.has(build.backgroundId))
      stepIssues.background.push({ code: "BACKGROUND_SOURCE_MISSING", recordId: build.backgroundId, severity: "error" });

    /*
     * The level is judged where it is chosen, which is the class step.
     *
     * Coverage is a property of the selected class's own progression, so it
     * cannot be evaluated before a class exists. Reporting it against the first
     * step — where the level used to be picked — marked Basics incomplete for a
     * decision taken two steps later, and pointed the repair at a screen that
     * had no control capable of making it. The class step owns both the level
     * selector and this issue, so the report and the repair are in one place.
     *
     * Only a class that genuinely stops short is reported. With no class
     * selected there is nothing to check the level against, and
     * `CLASS_NOT_CHOSEN` above already says so — reporting both would name the
     * same gap twice.
     */
    if (activation.levelCoverage === "not-covered")
      stepIssues.class.push({ code: "LEVEL_NOT_COVERED_BY_CLASS", fieldPath: "level", severity: "error" });

    // A progression that names a choice or feature the pack does not define is a
    // content defect, not a user decision. It is reported against the missing
    // record so a repair is possible without guessing.
    for (const choiceId of activation.missingProgressionChoiceIds)
      stepIssues["class-choices"].push({ code: "PROGRESSION_CHOICE_MISSING", recordId: choiceId, severity: "error" });
    for (const featureId of activation.missingFeatureIds)
      stepIssues["class-choices"].push({ code: "PROGRESSION_FEATURE_MISSING", recordId: featureId, severity: "error" });

    // ---- explicit subclass identity ---------------------------------------
    const subclass = activation.subclass;
    if (subclass?.unresolved)
      stepIssues["class-choices"].push({ code: "SUBCLASS_NOT_CHOSEN", recordId: subclass.classId, severity: "error" });
    if (subclass && build.subclassId && !subclass.valid)
      stepIssues["class-choices"].push({ code: "SUBCLASS_INVALID", recordId: build.subclassId, severity: "error" });

    /*
     * A choice that partly overlaps the class's subclass declaration is an
     * authoring problem, not a user one. It is reported as a warning against the
     * choice so the pack can be repaired, and it does not block: the choice is
     * still presented, so the build stays answerable rather than deadlocked.
     */
    for (const overlap of activation.subclassOverlaps)
      if (overlap.kind === "ambiguous")
        stepIssues["class-choices"].push({
          code: "SUBCLASS_CHOICE_OVERLAP_AMBIGUOUS",
          recordId: overlap.choiceId,
          severity: "warning",
        });
  }

  stepIssues.abilities.push(...abilityIssues(build, entries, allocation));

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

  // A selection that duplicates an automatic grant produces one fewer
  // proficiency than the rules promise. Blocking with a named repair is the
  // minimum honest response; the option list also offers the alternatives.
  for (const duplicate of proficiencies.duplicates) {
    const step = requiredChoices.find(choice => choice.choiceId === duplicate.choiceId)?.stepId ?? "class-choices";
    stepIssues[step].push({ code: "PROFICIENCY_DUPLICATE_SELECTION", recordId: duplicate.optionId, severity: "error" });
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
  if (!build.name.trim()) stepIssues.start.push({ code: "NAME_NOT_SET", fieldPath: "name", severity: "warning" });

  for (const key of Object.keys(stepIssues) as BuilderStepId[])
    stepIssues[key] = dedupeIssues(stepIssues[key]);

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
      optional: presentation === "flexible" || step.id === "identity",
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
    ...(activation.subclass ? { subclass: activation.subclass } : {}),
    proficiencies,
    equipmentGrants,
    maxLevel: maxSupportedLevel(entries, build.classId),
    levelCovered: activation.levelCovered,
    levelCoverage: activation.levelCoverage,
    ...(activation.classProgressionMax === undefined ? {} : { classProgressionMax: activation.classProgressionMax }),
    abilities: allocation,
  };
}

/**
 * Guided recommendations for a step. Each carries "Why this?" copy and a rank;
 * the caller renders them in rank order and never applies one automatically.
 *
 * `plan` is the plan already computed for this draft. Recommendations describe
 * decisions the plan has discovered, so producing them must not re-walk the
 * activation graph — the builder re-renders this on every keystroke, and a
 * traversal per render is a traversal per option in everything but name.
 */
export function recommendationsFor(
  stepId: BuilderStepId,
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  plan?: Pick<BuildPlan, "requiredChoices" | "equipmentGrants">,
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

  /*
   * Origin recommendations follow the two steps that replaced the single origin
   * screen. The copy is derived from typed mechanics rather than asserted: an
   * earlier version stated a speed and an ability pair outright, which was true
   * of the fixture it was written against and a fabrication against any other
   * content. Where the mechanics do not parse, the option is still offered — it
   * simply carries the generic reason instead of an invented specific one.
   */
  if (stepId === "origin")
    for (const entry of entries.filter(item => SPECIES_CATEGORIES.has(item.category))) {
      const mechanics =
        entry.category === "species" ? speciesMechanicsSchema.safeParse(entry.mechanics) : raceMechanicsSchema.safeParse(entry.mechanics);
      recommendations.push({
        optionId: entry.id,
        label: entry.name,
        why: mechanics.success
          ? `Its traits apply from level 1 and it moves at ${mechanics.data.speed} ft.`
          : "Its traits apply from level 1.",
        rank: 1,
      });
    }

  if (stepId === "background")
    for (const entry of entries.filter(item => item.category === "background")) {
      const mechanics = backgroundMechanicsSchema.safeParse(entry.mechanics);
      recommendations.push({
        optionId: entry.id,
        label: entry.name,
        why: mechanics.success
          ? `It raises ${mechanics.data.abilityScoreChoices.increasePattern.map(step => `+${step}`).join(" and ")} across abilities you pick, and grants an origin feat.`
          : "It grants an origin feat and starting proficiencies.",
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
    const choices = plan?.requiredChoices ?? requiredChoicesFor(build, entries);
    for (const choice of choices.filter(choice => choice.stepId === stepId))
      for (const option of choice.options)
        recommendations.push({
          optionId: option.id,
          label: option.label,
          why: option.alreadyGrantedBy
            ? `Already granted by ${option.alreadyGrantedBy.entryLabel}; choosing it would spend this decision for nothing.`
            : "A context-valid option for this class at this level.",
          rank: option.alreadyGrantedBy ? 3 : 1,
        });
  }

  if (stepId === "equipment") {
    // The plan's grants already hold every bundle choice and its options, so the
    // equipment recommendations are read off the same pass as everything else.
    const choices = plan
      ? plan.equipmentGrants.flatMap(grant => grant.choices)
      : requiredEquipmentChoices(build, entries);
    for (const choice of choices)
      for (const option of choice.options)
        recommendations.push({ optionId: option.id, label: option.label, why: "Offered by the granted starting kit.", rank: 1 });
  }

  return recommendations.sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
}
