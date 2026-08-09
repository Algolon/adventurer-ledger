/**
 * Where a change to a character is made: the Sheet, or Edit character.
 *
 * The rule the product needs is simple to state and easy to erode: **the Sheet
 * owns state that changes during play and can be changed back; Edit character
 * owns decisions that define the build.** A player must never be sent through
 * the creation flow to spend a resource, and must never be able to change their
 * class from a row on a sheet.
 *
 * It was previously stated only in prose, in two component comments and a
 * couple of quiet notes on screen. Prose does not fail when it stops being
 * true. This module states it as data instead:
 *
 *  - `SHEET_MANAGED_OPERATIONS` classifies every runtime operation the service
 *    accepts. It is keyed by `RuntimeOperation["kind"]`, so adding a runtime
 *    operation without deciding where it belongs is a type error rather than a
 *    silent inheritance of whatever the last one did.
 *  - `BUILD_MANAGED_DECISIONS` names the decisions that stay behind Edit
 *    character and Level up. It is presentation-facing: the sheet uses it to
 *    say what Edit character is *for*, in one place, rather than repeating a
 *    slightly different sentence under every section.
 *
 * Nothing here is a permission check. The runtime service already refuses to
 * write durable character state and the draft services already own the build;
 * this is the UI's copy of the same boundary, so what the screen says and what
 * the services do cannot drift apart unnoticed.
 */
import type { DerivedSpell } from "@/src/services/derived-resolver";
import type { RuntimeOperation } from "@/src/services/runtime-service";

export type SheetManagedConcept =
  | "hit-points"
  | "temporary-hit-points"
  | "hit-dice"
  | "death-saves"
  | "conditions"
  | "exhaustion"
  | "inspiration"
  | "resources"
  | "rest";

/**
 * Every runtime operation, and the play concept it belongs to.
 *
 * The record is total over the operation union: `Record<RuntimeOperation["kind"], …>`
 * means a new operation kind will not compile until it is placed here.
 */
export const SHEET_MANAGED_OPERATIONS: Readonly<Record<RuntimeOperation["kind"], SheetManagedConcept>> = {
  damage: "hit-points",
  heal: "hit-points",
  "temporary-hit-points": "temporary-hit-points",
  "hit-dice-spend": "hit-dice",
  "hit-dice-recover": "hit-dice",
  "death-save": "death-saves",
  "death-saves-clear": "death-saves",
  "condition-add": "conditions",
  "condition-remove": "conditions",
  "exhaustion-set": "exhaustion",
  "inspiration-set": "inspiration",
  "resource-spend": "resources",
  "resource-recover": "resources",
  "short-rest": "rest",
  "long-rest": "rest",
};

/**
 * What the Sheet manages, in the words the screen uses.
 *
 * Ordered as a player would list them, not as the union is declared.
 */
export const SHEET_MANAGED_LABELS: readonly string[] = [
  "hit points",
  "temporary hit points",
  "hit dice",
  "death saves",
  "conditions",
  "exhaustion",
  "inspiration",
  "limited-use resources",
  "spell slots",
  "rests",
];

/**
 * What Edit character and Level up own.
 *
 * These are permanent: undoing one is a restore, not a decrement. None of them
 * has, or should have, an inline control on the sheet.
 */
export const BUILD_MANAGED_DECISIONS: readonly string[] = [
  "class and subclass",
  "species",
  "background",
  "ability scores",
  "feats",
  "proficiencies and languages",
  "equipment",
  "level",
];

/** "class and subclass, species and background" — for one sentence, not a list. */
export function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The one sentence the sheet uses to explain the boundary.
 *
 * Stated once, so the Character workspace can carry it and no other surface has
 * to repeat a near-miss version of it under its own heading.
 */
export const BUILD_BOUNDARY_SENTENCE =
  "Edit character changes the build itself. What you spend and recover during play stays on this sheet.";

/**
 * The one state fact worth putting on a spell row.
 *
 * The caster spell-selection slice projects four — granted, always prepared,
 * known, prepared — and a row that printed all of them would be four badges wide
 * on a phone for a distinction the player usually is not making. So the row
 * states the strongest one and the drawer states all of them.
 *
 * `alwaysPrepared` implies both `granted` and `prepared`, so it absorbs them.
 * Below that, "Prepared" only ever appears when the content declares a
 * prepared-model selection, which is exactly when the distinction is real.
 *
 * "Granted" is suppressed unless this character also chose spells. A class that
 * grants its whole repertoire would otherwise badge every row identically, which
 * distinguishes nothing; the rule is the presence of a player selection and
 * nothing else, so no class, list or spell is named by it.
 *
 * Nothing here implies the absence of a badge means "unprepared". Under a known
 * model no spell is prepared at all, and saying so on every row would be a claim
 * the projection does not make.
 */
export function spellStateBadge(spell: DerivedSpell, distinguishGranted: boolean): string | null {
  if (spell.alwaysPrepared) return "Always prepared";
  if (spell.prepared) return "Prepared";
  if (spell.granted && distinguishGranted) return "Granted";
  return null;
}
