/**
 * Generic activation traversal.
 *
 * Choice discovery used to read two places: the selected class's progression and
 * the background's own choices. Everything else a character actually activates —
 * species traits, class and subclass features, the background feat, a feat's own
 * nested choices, anything granted by an option the user already picked — was
 * invisible to the builder, so those choices could never be presented and a
 * "complete" build could be missing required decisions.
 *
 * This module walks the public typed activation contract instead: the category
 * mechanics schemas in `content-pack.ts`, `ContentLink.level`, and
 * `ChoiceOption.entryId`. It names no content ID and inspects no entry name, so
 * a ruleset the repository has never seen activates by the same rules as the
 * synthetic fixtures.
 *
 * Traversal is breadth-first from a fixed seed order and deduplicates by entry
 * ID, so the result is deterministic for a given build and entry list.
 */
import {
  backgroundMechanicsSchema,
  classMechanicsSchema,
  lineageMechanicsSchema,
  speciesMechanicsSchema,
  subclassMechanicsSchema,
} from "@/src/domain/content-pack";
import type { Category, ChoiceDefinition, ContentEntry, ID } from "@/src/domain/model";

/** How an entry came to be active. Provenance, not behaviour. */
export type ActivationVia =
  | "species"
  | "species-trait"
  | "lineage"
  | "lineage-trait"
  | "background"
  | "background-feat"
  | "background-proficiency"
  | "class"
  | "class-starting-proficiency"
  | "class-feature"
  | "subclass"
  | "subclass-feature"
  | "selected-option"
  | "link";

export interface ActivatedEntry {
  entry: ContentEntry;
  via: ActivationVia;
  /** The entry that activated this one, when there was one. */
  parentId?: ID;
  /** The character level at which this becomes active. */
  level: number;
}

/** The build fields activation depends on. Keeps this callable from a draft or a committed record. */
export interface ActivationBuild {
  readonly classId?: ID;
  readonly subclassId?: ID;
  readonly speciesId?: ID;
  readonly backgroundId?: ID;
  /** Target level for a draft; current level for a committed character. */
  readonly level: number;
  readonly choiceSelections: Readonly<Record<ID, readonly ID[]>>;
}

/** The level at which a class grants its subclass, when the class declares one. */
export function subclassLevelFor(build: ActivationBuild, entries: readonly ContentEntry[]): number | undefined {
  const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
  if (classEntry?.category !== "class") return undefined;
  const mechanics = classMechanicsSchema.safeParse(classEntry.mechanics);
  return mechanics.success ? mechanics.data.subclassLevel : undefined;
}

/** The subclasses a class declares, for the builder's subclass step. */
export function subclassOptionsFor(
  build: ActivationBuild,
  entries: readonly ContentEntry[],
): readonly { id: ID; label: string }[] {
  const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
  if (classEntry?.category !== "class") return [];
  const mechanics = classMechanicsSchema.safeParse(classEntry.mechanics);
  if (!mechanics.success) return [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return mechanics.data.subclassIds
    .map(id => byId.get(id))
    .filter((entry): entry is ContentEntry => Boolean(entry))
    .map(entry => ({ id: entry.id, label: entry.name }));
}

/** The highest level the class's own progression describes. */
export function maximumLevelFor(build: ActivationBuild, entries: readonly ContentEntry[]): number | undefined {
  const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
  if (classEntry?.category !== "class") return undefined;
  const mechanics = classMechanicsSchema.safeParse(classEntry.mechanics);
  if (!mechanics.success) return undefined;
  return mechanics.data.progression.reduce((highest, row) => Math.max(highest, row.level), 0) || undefined;
}

/**
 * Every entry the build activates at or below its level.
 *
 * Breadth-first from a fixed seed order (species, lineage, background, class,
 * subclass), deduplicated by entry ID so an entry reachable through two paths is
 * activated once and keeps the provenance of the path that found it first.
 */
export function activatedEntriesFor(
  build: ActivationBuild,
  entries: readonly ContentEntry[],
): ActivatedEntry[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const activated = new Map<ID, ActivatedEntry>();
  const queue: ActivatedEntry[] = [];

  const enqueue = (id: ID | undefined, via: ActivationVia, level: number, parentId?: ID) => {
    if (!id || level > build.level) return;
    const entry = byId.get(id);
    // A reference the active ruleset does not supply is not an activation; the
    // planner reports the missing reference separately.
    if (!entry || activated.has(id)) return;
    const record: ActivatedEntry = { entry, via, level, ...(parentId ? { parentId } : {}) };
    activated.set(id, record);
    queue.push(record);
  };

  enqueue(build.speciesId, "species", 1);
  enqueue(build.backgroundId, "background", 1);
  enqueue(build.classId, "class", 1);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    expand(current, build, byId, enqueue);
  }

  return [...activated.values()];
}

/** Category-specific expansion, driven entirely by the published mechanics schemas. */
function expand(
  current: ActivatedEntry,
  build: ActivationBuild,
  byId: ReadonlyMap<ID, ContentEntry>,
  enqueue: (id: ID | undefined, via: ActivationVia, level: number, parentId?: ID) => void,
) {
  const { entry } = current;

  if (entry.category === "species") {
    const mechanics = speciesMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success) {
      for (const traitId of mechanics.data.traitIds) enqueue(traitId, "species-trait", 1, entry.id);
      // A lineage is only active when the build selected it through a choice, so
      // it is reached through the selected-option path rather than seeded here.
    }
  }

  if (entry.category === "lineage") {
    const mechanics = lineageMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success) {
      const replaced = new Set(mechanics.data.replacesTraitIds);
      for (const traitId of mechanics.data.traitIds)
        if (!replaced.has(traitId)) enqueue(traitId, "lineage-trait", 1, entry.id);
    }
  }

  if (entry.category === "background") {
    const mechanics = backgroundMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success) {
      enqueue(mechanics.data.featId, "background-feat", 1, entry.id);
      for (const proficiencyId of mechanics.data.proficiencyIds)
        enqueue(proficiencyId, "background-proficiency", 1, entry.id);
    }
  }

  if (entry.category === "class") {
    const mechanics = classMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success) {
      for (const proficiencyId of mechanics.data.startingProficiencyIds)
        enqueue(proficiencyId, "class-starting-proficiency", 1, entry.id);
      // Features arrive at the level their progression row declares.
      for (const row of mechanics.data.progression)
        for (const featureId of row.featureIds) enqueue(featureId, "class-feature", row.level, entry.id);
      // Only the selected subclass activates, and only from its own level.
      if (build.subclassId && mechanics.data.subclassIds.includes(build.subclassId))
        enqueue(build.subclassId, "subclass", mechanics.data.subclassLevel, entry.id);
    }
  }

  if (entry.category === "subclass") {
    const mechanics = subclassMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success)
      for (const row of mechanics.data.progression)
        for (const featureId of row.featureIds) enqueue(featureId, "subclass-feature", row.level, entry.id);
  }

  // Typed links carry their own level gate. This is how a progression-granted
  // entry of any category joins the traversal without a category special case.
  for (const link of entry.links)
    if (link.required || link.level !== undefined) enqueue(link.targetId, "link", link.level ?? current.level, entry.id);

  // Anything the user already selected activates what that option names. This is
  // the path a feat, a fighting style or a lineage arrives through, and it is
  // what makes a nested choice reachable.
  for (const choice of allChoices(entry.choices)) {
    const selected = new Set(build.choiceSelections[choice.id] ?? []);
    for (const option of choice.options)
      if (selected.has(option.id)) enqueue(option.entryId, "selected-option", current.level, entry.id);
  }
  void byId;
}

/** A choice definition and every child choice beneath it, depth-first. */
export function allChoices(choices: readonly ChoiceDefinition[]): ChoiceDefinition[] {
  const flat: ChoiceDefinition[] = [];
  const walk = (list: readonly ChoiceDefinition[]) => {
    for (const choice of list) {
      flat.push(choice);
      if (choice.childChoices?.length) walk(choice.childChoices);
      for (const option of choice.options) if (option.childChoices?.length) walk(option.childChoices);
    }
  };
  walk(choices);
  return flat;
}

/**
 * The choices an activated entry contributes, with the level each becomes due.
 *
 * A class or subclass gates its choices through its progression rows, so a
 * level-4 choice is not presented to a level-2 build. Every other category's
 * choices are due as soon as the entry itself is active. A child choice is only
 * due once its parent option has actually been selected, which is what stops a
 * feat's nested choice appearing before the feat is chosen.
 */
export function dueChoicesFor(
  activated: ActivatedEntry,
  build: ActivationBuild,
): { choice: ChoiceDefinition; level: number }[] {
  const { entry } = activated;
  const due: { choice: ChoiceDefinition; level: number }[] = [];

  const progressionLevels = new Map<ID, number>();
  if (entry.category === "class") {
    const mechanics = classMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success)
      for (const row of mechanics.data.progression)
        for (const choiceId of row.choiceIds)
          progressionLevels.set(choiceId, Math.min(progressionLevels.get(choiceId) ?? row.level, row.level));
  }
  if (entry.category === "subclass") {
    const mechanics = subclassMechanicsSchema.safeParse(entry.mechanics);
    if (mechanics.success)
      for (const row of mechanics.data.progression)
        for (const choiceId of row.choiceIds)
          progressionLevels.set(choiceId, Math.min(progressionLevels.get(choiceId) ?? row.level, row.level));
  }
  const gated = entry.category === "class" || entry.category === "subclass";

  const consider = (choice: ChoiceDefinition, level: number) => {
    if (level > build.level) return;
    due.push({ choice, level });
    // Child choices become due only once the option carrying them is selected.
    const selected = new Set(build.choiceSelections[choice.id] ?? []);
    for (const option of choice.options)
      if (selected.has(option.id)) for (const child of option.childChoices ?? []) consider(child, level);
    for (const child of choice.childChoices ?? []) consider(child, level);
  };

  for (const choice of entry.choices) {
    if (gated) {
      const level = progressionLevels.get(choice.id);
      // A gated entry only presents choices its progression actually schedules.
      if (level === undefined) continue;
      consider(choice, level);
    } else {
      consider(choice, activated.level);
    }
  }
  return due;
}

/* -------------------------------------------------------------------------- */
/* Proficiency provenance                                                      */
/* -------------------------------------------------------------------------- */

export type ProficiencyGrant = "automatic" | "selected";

export interface ProficiencyProvenance {
  proficiencyId: ID;
  label: string;
  /** `skill`, `save`, `tool`, `language`, … from the proficiency entry's own mechanics. */
  type: string;
  grant: ProficiencyGrant;
  sourceEntryId: ID;
  sourceEntryName: string;
  sourceCategory: Category;
  via: ActivationVia;
  /** Present when the user chose it, naming the group it came from. */
  choiceId?: ID;
}

/**
 * Every proficiency the build holds, and why.
 *
 * A displayed proficiency has to distinguish "your background gave you this" from
 * "you spent a class pick on it", because that is exactly the information a user
 * needs when a class list offers something they already have.
 */
export function proficiencyProvenance(
  build: ActivationBuild,
  entries: readonly ContentEntry[],
): ProficiencyProvenance[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const activated = activatedEntriesFor(build, entries);
  const found: ProficiencyProvenance[] = [];
  const seen = new Set<string>();

  const record = (
    proficiencyId: ID,
    grant: ProficiencyGrant,
    source: ActivatedEntry,
    choiceId?: ID,
  ) => {
    const proficiency = byId.get(proficiencyId);
    if (proficiency?.category !== "proficiency") return;
    // One row per (proficiency, source, grant): a duplicate grant from two
    // different sources is real information, a repeat from one source is not.
    const key = `${proficiencyId}|${source.entry.id}|${grant}|${choiceId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    const type = typeof (proficiency.mechanics as { type?: unknown }).type === "string"
      ? String((proficiency.mechanics as { type?: unknown }).type)
      : "other";
    found.push({
      proficiencyId,
      label: proficiency.name,
      type,
      grant,
      sourceEntryId: source.entry.id,
      sourceEntryName: source.entry.name,
      sourceCategory: source.entry.category,
      via: source.via,
      ...(choiceId ? { choiceId } : {}),
    });
  };

  for (const activatedEntry of activated) {
    const { entry } = activatedEntry;

    // Automatic grants declared by the category's own mechanics.
    if (entry.category === "background") {
      const mechanics = backgroundMechanicsSchema.safeParse(entry.mechanics);
      if (mechanics.success)
        for (const id of mechanics.data.proficiencyIds) record(id, "automatic", activatedEntry);
    }
    if (entry.category === "class") {
      const mechanics = classMechanicsSchema.safeParse(entry.mechanics);
      if (mechanics.success)
        for (const id of mechanics.data.startingProficiencyIds) record(id, "automatic", activatedEntry);
    }
    // Automatic grants declared as effects, whatever the category.
    for (const effect of entry.effects)
      if (effect.type === "grantProficiency") record(effect.proficiencyId, "automatic", activatedEntry);

    // Anything the user selected that resolves to a proficiency entry.
    for (const choice of allChoices(entry.choices)) {
      const selected = new Set(build.choiceSelections[choice.id] ?? []);
      for (const option of choice.options)
        if (selected.has(option.id) && option.entryId) record(option.entryId, "selected", activatedEntry, choice.id);
    }
  }
  return found;
}

/** Proficiency IDs the build already holds automatically, for marking option lists. */
export function automaticallyGrantedProficiencyIds(
  build: ActivationBuild,
  entries: readonly ContentEntry[],
): Set<ID> {
  return new Set(
    proficiencyProvenance(build, entries)
      .filter(item => item.grant === "automatic")
      .map(item => item.proficiencyId),
  );
}
