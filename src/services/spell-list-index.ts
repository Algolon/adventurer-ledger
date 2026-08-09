/**
 * The membership relation between spell lists and spells, resolved once.
 *
 * Content declares this relation from both sides, and both are legal: a
 * `spell-list` names its `spellIds`, and every `spell` names the `spellListIds`
 * it belongs to. Reading one side only silently loses whatever the other side
 * declares, and the loss is invisible — the spell is simply never offered.
 *
 * It lives in its own module, behind a factory, for the same reason
 * `planning-context` does: "built once per pass" is then a contract a test can
 * hold rather than a property of where the code happens to sit. The eventual
 * catalogue is a few hundred spells across a dozen lists, and an expansion that
 * re-scans every entry per list stays correct while turning one planning pass
 * into `lists × entries`.
 */
import type { ContentEntry, ID } from "@/src/domain/model";

/**
 * The display facts a reachable spell carries. Read once, at index time.
 *
 * `school` and `summary` are here rather than looked up per row because a picker
 * offering hundreds of spells would otherwise resolve the same entry again for
 * every render. The index already visits each spell entry exactly once, so
 * carrying two more fields costs nothing and keeps "read once" a property of the
 * index rather than a discipline every caller has to remember.
 */
export interface SpellRecord {
  id: ID;
  label: string;
  level: number;
  ritual: boolean;
  /** Declared school, when the record carries a usable one. */
  school?: string;
  /** The entry's own short summary. Never full rules text. */
  summary?: string;
}

export interface SpellListIndex {
  /** Spell IDs on a list, sorted. Empty for a list the content does not define. */
  membersOf(listId: ID): readonly ID[];
  /** Lists a spell belongs to, sorted. */
  listsFor(spellId: ID): readonly ID[];
  /** The spell record behind an ID, when the content installs one. */
  spellRecord(spellId: ID): SpellRecord | undefined;
  /** Every list the content mentions, from either direction, sorted. */
  readonly listIds: readonly ID[];
}

/**
 * True when a spell's stored mechanics declare it castable as a ritual.
 *
 * A boundary read: stored mechanics are `unknown` as far as this module is
 * concerned, and a record written before the field existed simply does not carry
 * it. Absent means "not a ritual", which is the schema's own default, so the two
 * agree without either having to know about the other.
 */
export function spellIsRitual(mechanics: unknown): boolean {
  return (mechanics as { ritual?: unknown } | undefined)?.ritual === true;
}

/** The level a spell declares, when it declares a usable one. */
function spellLevel(mechanics: unknown): number | undefined {
  const level = (mechanics as { level?: unknown } | undefined)?.level;
  return typeof level === "number" && Number.isInteger(level) && level >= 0 ? level : undefined;
}

/** The school a spell declares, when it declares a usable one. */
function spellSchool(mechanics: unknown): string | undefined {
  const school = (mechanics as { school?: unknown } | undefined)?.school;
  return typeof school === "string" && school.length > 0 ? school : undefined;
}

/** List IDs a spell claims membership of. */
function declaredListIds(mechanics: unknown): ID[] {
  const ids = (mechanics as { spellListIds?: unknown } | undefined)?.spellListIds;
  return Array.isArray(ids) ? ids.filter((id): id is ID => typeof id === "string") : [];
}

/** Spell IDs a list claims to contain. */
function declaredSpellIds(mechanics: unknown): ID[] {
  const ids = (mechanics as { spellIds?: unknown } | undefined)?.spellIds;
  return Array.isArray(ids) ? ids.filter((id): id is ID => typeof id === "string") : [];
}

const sortedOf = (values: ReadonlySet<ID> | undefined): readonly ID[] => (values ? [...values].sort() : []);

/**
 * The membership relation the given entries declare.
 *
 * One pass over the entries. Both declaration directions feed the same pair of
 * maps, so a membership stated twice is stored once and a membership stated on
 * one side only is still found.
 */
export function buildSpellListIndex(entries: readonly ContentEntry[]): SpellListIndex {
  const members = new Map<ID, Set<ID>>();
  const lists = new Map<ID, Set<ID>>();
  const records = new Map<ID, SpellRecord>();

  const relate = (listId: ID, spellId: ID) => {
    const forList = members.get(listId) ?? new Set<ID>();
    forList.add(spellId);
    members.set(listId, forList);
    const forSpell = lists.get(spellId) ?? new Set<ID>();
    forSpell.add(listId);
    lists.set(spellId, forSpell);
  };

  for (const entry of entries) {
    if (entry.category === "spell") {
      const level = spellLevel(entry.mechanics);
      // A record whose mechanics do not read as a spell is not offerable. It is
      // left out rather than shown with an invented level.
      if (level !== undefined)
        records.set(entry.id, {
          id: entry.id,
          label: entry.name,
          level,
          ritual: spellIsRitual(entry.mechanics),
          ...(spellSchool(entry.mechanics) ? { school: spellSchool(entry.mechanics) as string } : {}),
          ...(entry.summary ? { summary: entry.summary } : {}),
        });
      for (const listId of declaredListIds(entry.mechanics)) relate(listId, entry.id);
      continue;
    }
    if (entry.category !== "spell-list") continue;
    // An empty list is still a list: it exists and reaches nothing.
    if (!members.has(entry.id)) members.set(entry.id, new Set<ID>());
    for (const spellId of declaredSpellIds(entry.mechanics)) relate(entry.id, spellId);
  }

  const listIds = [...members.keys()].sort();
  return {
    membersOf: listId => sortedOf(members.get(listId)),
    listsFor: spellId => sortedOf(lists.get(spellId)),
    spellRecord: spellId => records.get(spellId),
    listIds,
  };
}
