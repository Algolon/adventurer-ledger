/**
 * Which spells a build can reach, and on what basis.
 *
 * Content can already say `class → addSpellList → spell-list → spellIds`, and
 * the rules engine already collects the granted list IDs. Nothing read the last
 * hop, so the only way to make a spell offerable was one `addSpell` effect per
 * spell — roughly a thousand redundant grants for a real catalogue, and a pack
 * that has to be rewritten every time a list changes.
 *
 * This module closes that hop, and it keeps three facts apart while doing it:
 *
 *  - **access** to a list, which an effect grants;
 *  - **membership** of a spell in a list, which the content declares;
 *  - **knowing** a spell, which only an `addSpell` grant, or a later selection,
 *    establishes.
 *
 * Expanding the first two must never produce the third. `addSpellList` says what
 * a character *may* learn, not what it has learned, and a surface that confused
 * the two would hand a first-level caster its class's entire spell list as
 * always-prepared. Every row here therefore takes `known` and `alwaysPrepared`
 * from the grant side alone; list membership cannot set either.
 *
 * Nothing here casts, prepares, scales or resolves a spell. It answers one
 * question — what is reachable — and leaves the rest to later work.
 */
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry, Effect, ID } from "@/src/domain/model";
import { applyEffects } from "@/src/rules/engine";
import { draftContext, type ActivationPlan } from "@/src/services/choice-planner";
import { buildSpellListIndex, type SpellListIndex } from "@/src/services/spell-list-index";

export { buildSpellListIndex, spellIsRitual } from "@/src/services/spell-list-index";
export type { SpellListIndex, SpellRecord } from "@/src/services/spell-list-index";

/**
 * What a build's activated effects established about spells.
 *
 * Structurally satisfied by the rules engine's own `RuleResult`, so the engine
 * stays the single place that decides whether a level-gated or conditional
 * effect applied. This module never re-implements that judgement; it reads the
 * answer.
 */
export interface SpellAccess {
  /** Lists an `addSpellList` effect granted access to. */
  readonly spellLists: ReadonlySet<ID>;
  /** Spells an `addSpell` effect granted outright. */
  readonly spells: ReadonlySet<ID>;
  /** The subset of those the grant marked always prepared. */
  readonly alwaysPreparedSpells: ReadonlySet<ID>;
}

export interface AvailableSpell {
  id: ID;
  label: string;
  level: number;
  ritual: boolean;
  /**
   * The reachable lists this spell is on, sorted.
   *
   * Only lists the build actually reaches. A spell that is also on a list nobody
   * granted is still one spell with one row; the unreachable membership is not a
   * second way to have it.
   */
  viaListIds: readonly ID[];
  /**
   * True only when an effect granted this spell outright. Membership of a
   * reachable list never sets it: being allowed to learn a spell is not knowing
   * it.
   */
  known: boolean;
  /** True only for a granted spell whose grant marked it always prepared. */
  alwaysPrepared: boolean;
}

export interface SpellAvailability {
  /** Lists the build reaches, sorted. */
  listIds: readonly ID[];
  /** Every spell the build can reach, one row each, by level then name then ID. */
  spells: readonly AvailableSpell[];
  /**
   * IDs a reachable list or an outright grant names that the ruleset does not
   * define. Reported rather than dropped, so a pack that references a spell it
   * does not ship is visible as a content defect instead of a short list.
   */
  missingSpellIds: readonly ID[];
}

export const EMPTY_SPELL_AVAILABILITY: SpellAvailability = {
  listIds: [],
  spells: [],
  missingSpellIds: [],
};

/**
 * The spells an access set reaches, expanded through the index.
 *
 * Pure and total: an unknown list contributes nothing, a spell reached twice
 * appears once, and the order is fixed, so two passes over the same content
 * produce the same value.
 */
export function spellAvailabilityFor(access: SpellAccess, index: SpellListIndex): SpellAvailability {
  const listIds = [...access.spellLists].sort();
  /** Reachable memberships, keyed by spell so a shared spell stays one record. */
  const viaLists = new Map<ID, ID[]>();
  for (const listId of listIds)
    for (const spellId of index.membersOf(listId)) {
      const seen = viaLists.get(spellId) ?? [];
      seen.push(listId);
      viaLists.set(spellId, seen);
    }

  const missing = new Set<ID>();
  const spells: AvailableSpell[] = [];
  // Grants join the same collection: a granted spell that is on no reachable
  // list is still reachable, and one that is on a reachable list must not appear
  // twice.
  for (const spellId of [...new Set([...viaLists.keys(), ...access.spells])].sort()) {
    const record = index.spellRecord(spellId);
    if (!record) {
      missing.add(spellId);
      continue;
    }
    spells.push({
      ...record,
      viaListIds: (viaLists.get(spellId) ?? []).sort(),
      known: access.spells.has(spellId),
      alwaysPrepared: access.alwaysPreparedSpells.has(spellId),
    });
  }
  spells.sort(
    (left, right) =>
      left.level - right.level || left.label.localeCompare(right.label) || left.id.localeCompare(right.id),
  );
  return { listIds, spells, missingSpellIds: [...missing].sort() };
}

/**
 * Whether an effect could possibly bear on spells, wrappers included.
 *
 * A structural question, not a semantic one: it asks whether the evaluation
 * below is worth running at all, and deliberately answers yes for a level-gated
 * grant the build has not reached yet. The engine then applies the real rule.
 * Being generous here costs one evaluation; being clever here would mean
 * deciding level and condition semantics twice, in two places, from two
 * readings.
 */
const mentionsSpells = (effect: Effect): boolean =>
  effect.type === "addSpell" ||
  effect.type === "addSpellList" ||
  (effect.type === "unlockAtLevel" && mentionsSpells(effect.effect));

/**
 * The availability one builder planning pass should offer.
 *
 * The activation pass has already decided which entries the draft activates and
 * what armour it is wearing; the rules engine then decides which of their
 * effects actually apply at this level, under these conditions. Both are reused
 * rather than re-derived, so a level-gated spell list is judged here exactly as
 * the derived sheet will judge it after commit.
 *
 * Content with no spell-shaped effect anywhere in the activated set pays for one
 * scan of those effects and nothing else: no evaluation, no index, no
 * allocation. That is what keeps a martial build's planning cost where it was.
 */
export function planSpellAvailability(
  activation: ActivationPlan,
  entries: readonly ContentEntry[],
  build: CharacterDraftBuild,
): SpellAvailability {
  const effects = activation.entries.flatMap(activated => activated.entry.effects);
  if (!effects.some(mentionsSpells)) return EMPTY_SPELL_AVAILABILITY;
  return spellAvailabilityFor(
    applyEffects(draftContext(build, activation.armor), effects),
    buildSpellListIndex(entries),
  );
}
