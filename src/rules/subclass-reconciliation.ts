/**
 * The one subclass-decision reconciliation rule.
 *
 * A pack may model the same subclass decision twice: once through the class's
 * typed `subclassIds` plus `subclassLevel`, and again as an ordinary choice
 * whose options resolve to those same subclass entries. Both are legitimate
 * declarations on their own. Together they produced two disconnected surfaces —
 * the typed panel wrote `subclassId`, the generic choice expected a
 * `choiceSelections` entry, neither satisfied the other, and the character could
 * not be committed.
 *
 * This module decides, structurally, when two declarations are one decision. It
 * names no class, no subclass and no choice: the whole judgement is made from
 * typed relationships between the class entry, its declared subclasses and the
 * choice's own options.
 *
 * ## When a generic choice is the same decision
 *
 * Every one of these has to hold, and each one is a way of being wrong if it
 * does not:
 *
 * - the choice is declared by the class itself;
 * - every option targets an entry, and every one of those entries is a subclass
 *   the class declares — an option that is not a subclass is a real decision
 *   that suppression would silently discard;
 * - the options cover exactly the class's declared subclasses, so answering the
 *   typed decision genuinely answers this one too;
 * - it is a single, non-repeatable pick, like the typed decision it mirrors;
 * - it becomes reachable at the level the class says its subclass is chosen, so
 *   it is the same decision *point* and not a later one;
 * - no option carries effects or nested choices of its own, because suppressing
 *   the choice would drop them.
 *
 * Anything that overlaps but fails one of those is reported as **ambiguous**.
 * Ambiguity is never resolved by guessing: the choice stays exactly as the pack
 * declared it and the caller raises an authoring diagnostic, so the build is
 * answerable rather than deadlocked and the pack author is told what to fix.
 */
import { subclassMechanicsSchema } from "@/src/domain/content-pack";
import type { ChoiceDefinition, ContentEntry, ID } from "@/src/domain/model";

export type SubclassOverlapKind =
  /** One decision declared twice. The generic copy is unified away. */
  | "duplicate"
  /** Overlapping but not equivalent. Kept, and reported for authoring. */
  | "ambiguous";

export interface SubclassChoiceOverlap {
  choiceId: ID;
  /** The class whose typed subclass decision this choice overlaps. */
  classId: ID;
  kind: SubclassOverlapKind;
}

export interface SubclassReconciliationInput {
  classEntry: ContentEntry;
  /** The class's typed subclass declaration. */
  subclassIds: readonly ID[];
  subclassLevel: number;
  byId: ReadonlyMap<ID, ContentEntry>;
  /**
   * The level at which each of the class's progression-gated choices becomes
   * reachable. A choice the progression never reaches is not a decision the
   * build has, so it is not considered.
   */
  choiceLevels: ReadonlyMap<ID, number>;
}

export interface SubclassReconciliation {
  /** Generic choices that are the typed decision written a second time. */
  duplicateChoiceIds: ReadonlySet<ID>;
  /** Every overlap found, duplicates included, for provenance and diagnostics. */
  overlaps: readonly SubclassChoiceOverlap[];
}

const EMPTY: SubclassReconciliation = Object.freeze({
  duplicateChoiceIds: new Set<ID>(),
  overlaps: Object.freeze([]) as readonly SubclassChoiceOverlap[],
});

/** Subclass IDs the class declares that actually resolve to its own subclasses. */
function declaredSubclassIds(input: SubclassReconciliationInput): Set<ID> {
  const declared = new Set<ID>();
  for (const id of input.subclassIds) {
    const entry = input.byId.get(id);
    if (!entry || entry.category !== "subclass") continue;
    const mechanics = subclassMechanicsSchema.safeParse(entry.mechanics);
    if (!mechanics.success || mechanics.data.classId !== input.classEntry.id) continue;
    declared.add(id);
  }
  return declared;
}

/** True when suppressing the choice would drop something it alone contributes. */
function optionCarriesMore(choice: ChoiceDefinition): boolean {
  if ((choice.childChoices ?? []).length > 0) return true;
  return choice.options.some(option => (option.effects ?? []).length > 0 || (option.childChoices ?? []).length > 0);
}

export function reconcileSubclassChoices(input: SubclassReconciliationInput): SubclassReconciliation {
  if (input.classEntry.category !== "class" || !input.classEntry.choices.length) return EMPTY;
  const declared = declaredSubclassIds(input);
  if (!declared.size) return EMPTY;

  const duplicateChoiceIds = new Set<ID>();
  const overlaps: SubclassChoiceOverlap[] = [];
  for (const choice of input.classEntry.choices) {
    // Only decisions the build actually reaches through the progression.
    if (!input.choiceLevels.has(choice.id)) continue;
    const targets = choice.options.map(option => option.entryId);
    const overlapping = targets.filter((id): id is ID => Boolean(id) && declared.has(id as ID));
    if (!overlapping.length) continue;

    const everyOptionIsDeclaredSubclass = targets.every(id => Boolean(id) && declared.has(id as ID));
    const coversEveryDeclaredSubclass = declared.size === new Set(overlapping).size;
    const singlePick = choice.min === 1 && choice.max === 1 && !choice.repeatable;
    const sameDecisionPoint = input.choiceLevels.get(choice.id) === input.subclassLevel;
    const kind: SubclassOverlapKind =
      everyOptionIsDeclaredSubclass && coversEveryDeclaredSubclass && singlePick && sameDecisionPoint && !optionCarriesMore(choice)
        ? "duplicate"
        : "ambiguous";
    if (kind === "duplicate") duplicateChoiceIds.add(choice.id);
    overlaps.push({ choiceId: choice.id, classId: input.classEntry.id, kind });
  }
  return { duplicateChoiceIds, overlaps };
}
