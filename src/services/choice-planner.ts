/**
 * Generic activation and choice discovery.
 *
 * The builder must offer every choice the activated content actually requires,
 * whatever supplies it: a class, a subclass, a species trait, a background, a
 * feat granted by a background, a feat chosen inside another choice, a typed
 * option entry such as a fighting style, or an entry granted by a progression
 * row. Nothing here names a class, a species, a choice or a proficiency: it
 * walks declarative structure only.
 *
 * Three properties matter and are tested directly:
 *
 * 1. **Deterministic.** Roots are visited in a fixed order and each entry's own
 *    declaration order is preserved, so the same draft always produces the same
 *    list in the same sequence.
 * 2. **Stable identity, presented once.** A choice is keyed by its own stable
 *    ID. Two routes to the same choice activate it once, so the builder cannot
 *    render it twice and the planner cannot report it twice.
 * 3. **Only what is reachable.** A choice is discovered only when the entry that
 *    owns it is actually active at the draft's level, so no diagnostic can name
 *    a choice the UI never offered.
 */
import { classMechanicsSchema, subclassMechanicsSchema } from "@/src/domain/content-pack";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import { ABILITIES } from "@/src/domain/character-record";
import type { Category, ChoiceDefinition, ContentEntry, ID } from "@/src/domain/model";
import { evaluateCondition, type RuleContext } from "@/src/rules/engine";
import type { BuilderStepId } from "@/src/services/builder-steps";

/** Why an entry is active. The route fixes which builder step owns its choices. */
export type ActivationRoute =
  | "class"
  | "class-progression"
  | "subclass"
  | "subclass-progression"
  | "species"
  | "species-trait"
  | "background"
  | "background-feat"
  | "selection";

const ORIGIN_ROUTES: ReadonlySet<ActivationRoute> = new Set<ActivationRoute>([
  "species",
  "species-trait",
  "background",
  "background-feat",
]);

export interface ActivatedEntry {
  entry: ContentEntry;
  route: ActivationRoute;
  /** Progression level that activated the entry, when a progression did. */
  level?: number;
  /** The choice whose selected option activated the entry, when one did. */
  viaChoiceId?: ID;
  /** Which builder step owns anything this entry contributes. */
  stepId: BuilderStepId;
}

export interface ActivatedChoice {
  choice: ChoiceDefinition;
  /** The entry that declares the choice. Provenance survives to Review. */
  sourceEntryId: ID;
  sourceLabel: string;
  sourceCategory: Category;
  /** The level at which the choice became reachable, when a progression set one. */
  level?: number;
  stepId: BuilderStepId;
}

/** The explicit subclass decision, kept typed rather than modelled as an option. */
export interface SubclassRequirement {
  classId: ID;
  classLabel: string;
  /** The level at which the class declares its subclass is chosen. */
  atLevel: number;
  /** True once the draft's level has reached `atLevel`. */
  reached: boolean;
  options: readonly { id: ID; label: string; summary?: string }[];
  selectedId?: ID;
  /** A selection that is present and one of the class's declared subclasses. */
  valid: boolean;
  /** Reached, offers at least one option, and no valid selection is stored. */
  unresolved: boolean;
}

export interface ActivationPlan {
  entries: readonly ActivatedEntry[];
  choices: readonly ActivatedChoice[];
  /** Progression rows referenced a choice the owning entry does not define. */
  missingProgressionChoiceIds: readonly ID[];
  /** Progression rows referenced a feature entry that is not installed. */
  missingFeatureIds: readonly ID[];
  subclass?: SubclassRequirement;
  /** The highest level the selected class actually defines a progression row for. */
  classProgressionMax?: number;
  /** True when the class defines a row for every level up to the draft's level. */
  levelCovered: boolean;
}

/**
 * A minimal evaluation context built from the draft, used only to test option
 * and entry prerequisites declaratively. It runs no effects and derives nothing.
 */
export function draftContext(build: CharacterDraftBuild): RuleContext {
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

/** True when a hard prerequisite of the entry is not satisfied by the draft. */
function hardBlocked(entry: ContentEntry, context: RuleContext): boolean {
  return entry.prerequisites.some(
    prerequisite => prerequisite.enforcement === "hard" && !evaluateCondition(prerequisite.condition, context),
  );
}

/** Levels 1..n the class defines a progression row for, as a contiguous run. */
export function contiguousProgressionMax(levels: readonly number[]): number {
  const present = new Set(levels);
  let covered = 0;
  while (present.has(covered + 1)) covered += 1;
  return covered;
}

/**
 * The highest starting level the installed content can honestly support.
 *
 * Derived from content: the longest run of consecutive class progression rows
 * starting at level 1. With a class selected it is that class's own coverage;
 * without one it is the best any installed class offers, so the first step can
 * present a truthful maximum before a class exists.
 */
export function maxSupportedLevel(entries: readonly ContentEntry[], classId?: ID): number {
  const classes = entries.filter(entry => entry.category === "class" && (!classId || entry.id === classId));
  let best = 0;
  for (const entry of classes) {
    const mechanics = classMechanicsSchema.safeParse(entry.mechanics);
    if (!mechanics.success) continue;
    best = Math.max(best, contiguousProgressionMax(mechanics.data.progression.map(row => row.level)));
  }
  return Math.max(1, best);
}

interface Pending {
  entry: ContentEntry;
  route: ActivationRoute;
  level?: number;
  viaChoiceId?: ID;
}

/**
 * Walks every activated source and returns the entries and choices it reaches.
 *
 * The walk is a queue seeded in a fixed root order, so activation order — and
 * therefore the presented choice order — is stable for a given draft.
 */
export function planActivation(build: CharacterDraftBuild, entries: readonly ContentEntry[]): ActivationPlan {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const context = draftContext(build);
  const activated: ActivatedEntry[] = [];
  const activatedIds = new Set<ID>();
  const choices: ActivatedChoice[] = [];
  const choiceIds = new Set<ID>();
  const missingProgressionChoiceIds: ID[] = [];
  const missingFeatureIds: ID[] = [];
  /** Class and subclass choices are gated on their progression rows. */
  const progressionChoiceIds = new Set<ID>();
  /** The level each progression-gated choice became reachable at. */
  const progressionChoiceLevels = new Map<ID, number>();
  const queue: Pending[] = [];

  const stepFor = (route: ActivationRoute, inherited?: BuilderStepId): BuilderStepId =>
    route === "selection" ? (inherited ?? "class-choices") : ORIGIN_ROUTES.has(route) ? "origin" : "class-choices";

  const enqueue = (id: ID | undefined, route: ActivationRoute, level?: number, viaChoiceId?: ID) => {
    if (!id || activatedIds.has(id)) return;
    const entry = byId.get(id);
    if (!entry) return;
    // An automatically granted entry the draft cannot satisfy is not activated,
    // so nothing it declares is ever presented or reported.
    if (route !== "selection" && hardBlocked(entry, context)) return;
    activatedIds.add(id);
    queue.push({ entry, route, ...(level === undefined ? {} : { level }), ...(viaChoiceId ? { viaChoiceId } : {}) });
  };

  const classEntry = build.classId ? byId.get(build.classId) : undefined;
  const classMechanics =
    classEntry?.category === "class" ? classMechanicsSchema.safeParse(classEntry.mechanics) : undefined;

  let classProgressionMax: number | undefined;
  let subclass: SubclassRequirement | undefined;
  /** Progression-granted feature IDs, in level order, per progression owner. */
  const classFeatureIds: { id: ID; level: number }[] = [];
  const subclassFeatureIds: { id: ID; level: number }[] = [];

  /** Reads one progression, collecting features and gating its choice IDs. */
  const readProgression = (
    owner: ContentEntry,
    rows: readonly { level: number; featureIds: readonly ID[]; choiceIds: readonly ID[] }[],
    into: { id: ID; level: number }[],
  ) => {
    const known = new Set(owner.choices.map(choice => choice.id));
    // Rows are read in declared level order so activation is level-ordered.
    for (const row of [...rows].sort((left, right) => left.level - right.level)) {
      if (row.level > build.level) continue;
      for (const featureId of row.featureIds) {
        if (!byId.has(featureId)) missingFeatureIds.push(featureId);
        else into.push({ id: featureId, level: row.level });
      }
      for (const choiceId of row.choiceIds) {
        if (!known.has(choiceId)) {
          missingProgressionChoiceIds.push(choiceId);
          continue;
        }
        progressionChoiceIds.add(choiceId);
        if (!progressionChoiceLevels.has(choiceId)) progressionChoiceLevels.set(choiceId, row.level);
      }
    }
  };

  if (classEntry && classMechanics?.success) {
    const mechanics = classMechanics.data;
    classProgressionMax = contiguousProgressionMax(mechanics.progression.map(row => row.level));
    readProgression(classEntry, mechanics.progression, classFeatureIds);

    // ---- explicit subclass identity ---------------------------------------
    const options = mechanics.subclassIds
      .map(id => byId.get(id))
      .filter((entry): entry is ContentEntry => entry?.category === "subclass")
      .map(entry => ({ id: entry.id, label: entry.name, ...(entry.summary ? { summary: entry.summary } : {}) }));
    const reached = build.level >= mechanics.subclassLevel;
    const selected = build.subclassId;
    const valid = Boolean(
      selected && mechanics.subclassIds.includes(selected) && byId.get(selected)?.category === "subclass",
    );
    subclass = {
      classId: classEntry.id,
      classLabel: classEntry.name,
      atLevel: mechanics.subclassLevel,
      reached,
      options,
      ...(selected ? { selectedId: selected } : {}),
      valid,
      unresolved: reached && options.length > 0 && !valid,
    };

    if (reached && valid && selected) {
      const subclassEntry = byId.get(selected);
      const subclassMechanics = subclassEntry ? subclassMechanicsSchema.safeParse(subclassEntry.mechanics) : undefined;
      if (subclassEntry && subclassMechanics?.success)
        readProgression(subclassEntry, subclassMechanics.data.progression, subclassFeatureIds);
    }
  }

  // Fixed root order: class, its subclass, the features each progression grants
  // in level order, then species and its traits, then background and its feat.
  enqueue(build.classId, "class");
  if (subclass?.valid) enqueue(subclass.selectedId, "subclass");
  for (const feature of classFeatureIds) enqueue(feature.id, "class-progression", feature.level);
  for (const feature of subclassFeatureIds) enqueue(feature.id, "subclass-progression", feature.level);
  enqueue(build.speciesId, "species");
  const speciesEntry = build.speciesId ? byId.get(build.speciesId) : undefined;
  const traitIds = (speciesEntry?.mechanics as { traitIds?: unknown } | undefined)?.traitIds;
  if (Array.isArray(traitIds)) for (const id of traitIds) if (typeof id === "string") enqueue(id, "species-trait");
  enqueue(build.backgroundId, "background");
  const backgroundEntry = build.backgroundId ? byId.get(build.backgroundId) : undefined;
  const featId = (backgroundEntry?.mechanics as { featId?: unknown } | undefined)?.featId;
  if (typeof featId === "string") enqueue(featId, "background-feat");

  /** Records a reachable choice once, keyed by its own stable ID. */
  const recordChoice = (choice: ChoiceDefinition, owner: ActivatedEntry, level?: number) => {
    if (choiceIds.has(choice.id)) return;
    choiceIds.add(choice.id);
    choices.push({
      choice,
      sourceEntryId: owner.entry.id,
      sourceLabel: owner.entry.name,
      sourceCategory: owner.entry.category,
      ...(level === undefined ? {} : { level }),
      stepId: owner.stepId,
    });
  };

  /**
   * Walks one choice tree. A nested choice under a selected option is reachable
   * exactly when that option is selected, which is what stops the planner
   * demanding a decision the builder never rendered.
   */
  const walkChoice = (choice: ChoiceDefinition, owner: ActivatedEntry, level: number | undefined) => {
    recordChoice(choice, owner, level);
    const selected = new Set(build.choiceSelections[choice.id] ?? []);
    for (const option of choice.options) {
      if (!selected.has(option.id)) continue;
      // A selected option's entry joins the activation set, so a chosen feat can
      // contribute its own nested choices.
      enqueue(option.entryId, "selection", level, choice.id);
      for (const child of option.childChoices ?? []) walkChoice(child, owner, level);
    }
    for (const child of choice.childChoices ?? []) walkChoice(child, owner, level);
  };

  // Fixed-point walk. `enqueue` inside `walkChoice` appends, so a selection made
  // inside a choice is processed in the same pass without re-ordering earlier work.
  for (let index = 0; index < queue.length; index++) {
    const pending = queue[index];
    const inherited = pending.route === "selection" ? stepForSelection(pending, activated) : undefined;
    const activation: ActivatedEntry = {
      entry: pending.entry,
      route: pending.route,
      ...(pending.level === undefined ? {} : { level: pending.level }),
      ...(pending.viaChoiceId ? { viaChoiceId: pending.viaChoiceId } : {}),
      stepId: stepFor(pending.route, inherited),
    };
    activated.push(activation);

    const gated = pending.entry.category === "class" || pending.entry.category === "subclass";
    for (const choice of pending.entry.choices) {
      if (gated && !progressionChoiceIds.has(choice.id)) continue;
      walkChoice(choice, activation, gated ? progressionChoiceLevels.get(choice.id) : pending.level);
    }
  }

  return {
    entries: activated,
    choices,
    missingProgressionChoiceIds: [...new Set(missingProgressionChoiceIds)].sort(),
    missingFeatureIds: [...new Set(missingFeatureIds)].sort(),
    ...(subclass ? { subclass } : {}),
    ...(classProgressionMax === undefined ? {} : { classProgressionMax }),
    levelCovered: classProgressionMax === undefined || classProgressionMax >= build.level,
  };
}

/**
 * The step a selection-activated entry belongs to.
 *
 * An entry chosen inside an origin choice stays an origin decision, so its own
 * nested choices are not exiled to a different step from the one that produced
 * them.
 */
function stepForSelection(pending: Pending, activated: readonly ActivatedEntry[]): BuilderStepId | undefined {
  if (!pending.viaChoiceId) return undefined;
  for (const item of activated)
    if (item.entry.choices.some(choice => containsChoice(choice, pending.viaChoiceId as ID))) return item.stepId;
  return undefined;
}

function containsChoice(choice: ChoiceDefinition, choiceId: ID): boolean {
  if (choice.id === choiceId) return true;
  if ((choice.childChoices ?? []).some(child => containsChoice(child, choiceId))) return true;
  return choice.options.some(option => (option.childChoices ?? []).some(child => containsChoice(child, choiceId)));
}
