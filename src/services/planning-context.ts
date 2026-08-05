/**
 * The state one planning pass shares across every choice it evaluates.
 *
 * Two things are needed to decide whether an option is available: a lookup from
 * entry ID to entry, and an evaluation context describing the draft. Both are a
 * function of the pass, not of the choice — the entries do not change between
 * one choice and the next, and neither does the build.
 *
 * They live here, behind a factory, so that "built once per pass" is a contract
 * a test can hold rather than a property of where the code happens to sit. A
 * planner that rebuilds this per choice stays correct and turns linear work
 * quadratic: with forty options across five choices the acceptance slice hides
 * it completely, and a real mastery list does not. The factory is pure and takes
 * everything it needs, so counting how often a pass calls it is a direct measure
 * of that mistake.
 */
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry, ID } from "@/src/domain/model";
import type { ArmorContext } from "@/src/rules/armor-context";
import { NO_ARMOR_CONTEXT } from "@/src/rules/armor-context";
import type { RuleContext } from "@/src/rules/engine";
import { draftContext } from "@/src/services/choice-planner";

export interface PlanningIndex {
  /** Entry lookup for the whole pass. */
  byId: ReadonlyMap<ID, ContentEntry>;
  /** The draft's evaluation context, for testing option prerequisites. */
  context: RuleContext;
}

/**
 * Builds the per-pass index and evaluation context together, once.
 *
 * The armour context comes from the activation pass that has already resolved
 * it, so option prerequisites are judged against what the draft actually wears
 * rather than against a hard-coded "no armour".
 */
export function createPlanningIndex(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  armor: ArmorContext = NO_ARMOR_CONTEXT,
): PlanningIndex {
  return { byId: new Map(entries.map(entry => [entry.id, entry])), context: draftContext(build, armor) };
}
