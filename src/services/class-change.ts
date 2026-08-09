/**
 * Changing the class, and clearing the spell selections the old one owned.
 *
 * The same principle `background-change` states: *hiding is not removing*. The
 * planner stops reporting a selection whose declaration is no longer reachable,
 * because it plans only from the class the draft currently holds — but the stored
 * answer is still there, still committed, and still waiting to reappear if the
 * user changes back through a third class that happened to reuse an ID.
 *
 * Ownership is typed, not nominal. A selection belongs to a class because that
 * class's own spellcasting declaration defines it, which is the same route
 * `planSpellSelections` uses to offer it. Nothing is matched by name.
 *
 * Two properties are load-bearing and both are tested directly:
 *
 * - **Deterministic.** The same draft and the same content always produce the
 *   same patch, with no dependence on object key order.
 * - **Idempotent.** Applying the result twice changes nothing the second time, so
 *   a re-render that reissues the same patch cannot cascade.
 *
 * **What it deliberately does not touch.** Generic `choiceSelections` are left
 * alone. A class's generic choices are gated on its progression rows, so the
 * planner already declines to offer them under a different class, and pruning
 * them here would be a behaviour change to decisions this slice does not own —
 * the design note records it as a separate gap rather than smuggling it in.
 * Species, background, abilities, equipment and identity are untouched for the
 * same reason: no class owns them.
 */
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry, ID } from "@/src/domain/model";
import { spellSelectionsOwnedBy } from "@/src/services/spell-selection";

/** What a class change removed, for a caller that has to explain itself. */
export interface ClassPruneNote {
  kind: "spell-selection";
  /** A stable selection ID. Never a stored spell or private text. */
  recordId: ID;
}

export interface ClassChangeResult {
  build: CharacterDraftBuild;
  removed: readonly ClassPruneNote[];
}

/**
 * The draft patch for changing the class.
 *
 * A selection ID owned by both the outgoing and the incoming class is left alone:
 * the answer is still authorised, and clearing it would discard work for no
 * reason. The subclass travels with the class, because a subclass whose class is
 * gone is a subclass of nothing.
 */
export function changeClass(
  build: CharacterDraftBuild,
  nextClassId: ID | undefined,
  entries: readonly ContentEntry[],
): ClassChangeResult {
  const removed: ClassPruneNote[] = [];
  const outgoing = spellSelectionsOwnedBy(build.classId, entries);
  const incoming = spellSelectionsOwnedBy(nextClassId, entries);

  const spellSelections: Record<ID, readonly ID[]> = {};
  for (const key of Object.keys(build.spellSelections ?? {}).sort()) {
    const selected = build.spellSelections?.[key] ?? [];
    if (!selected.length) continue;
    if (outgoing.has(key) && !incoming.has(key)) {
      removed.push({ kind: "spell-selection", recordId: key });
      continue;
    }
    spellSelections[key] = [...selected];
  }

  return {
    build: {
      ...build,
      classId: nextClassId,
      // A subclass belongs to the class that declares it. Changing the class
      // therefore ends the subclass, whether or not the new class has one.
      subclassId: build.classId === nextClassId ? build.subclassId : undefined,
      spellSelections,
    },
    removed,
  };
}
