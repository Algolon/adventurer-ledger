/**
 * The one maximum-hit-point calculation.
 *
 * Every consumer — creation planning, the derived sheet, the level-up preview
 * and the level-up commit — calls this. There is deliberately no creation-only
 * or level-up-only variant: two implementations is how direct creation at level
 * N and a sequential climb to level N came to disagree.
 *
 * ## The contract
 *
 * ```
 * maximum = classBase(level) + constitutionModifier x level
 * ```
 *
 * `classBase` is whatever the content declares for the character's level. In
 * this repository that is a **cumulative** figure written to the
 * `hitPoints.classBase` path by an ordinary level-keyed effect, so the class
 * decides its own per-level gain and this module never invents one.
 *
 * The Constitution modifier applies **once per character level**. Level 1 keeps
 * the calculation it always had (`classBase(1) + modifier`); every level above
 * it adds the modifier again. The defect this replaces added the modifier once
 * for the whole character, so a level `N` character was short by
 * `(N - 1) x modifier`.
 *
 * ## What is deliberately not decided here
 *
 * No schema, decision record or content mechanism in this repository declares a
 * **minimum hit-point gain per level**. A negative modifier is therefore applied
 * as written rather than floored at some invented value. The only thing this
 * module adds is a truthful flag when the arithmetic produces a maximum that
 * describes no character at all; the caller reports it instead of clamping it.
 *
 * A **multiclass** hit-point base is not representable: `hitPoints.classBase` is
 * a single scalar, so two classes writing it overwrite each other. That is
 * reported by the caller as an unresolved case rather than guessed at.
 */

export interface MaximumHitPointInput {
  /**
   * The content-declared class hit-point base for this character's level,
   * excluding every ability contribution. `null` when it cannot be read.
   */
  classBase: number | null;
  /** The active Constitution modifier, or `null` when it is unknown. */
  constitutionModifier: number | null;
  /** Character level. Values below 1 are treated as level 1. */
  level: number;
}

export interface MaximumHitPoints {
  /** `null` when a required input is unknown. Never a guess and never zero. */
  value: number | null;
  /** The Constitution contribution across every level, for the explanation trace. */
  constitutionTotal: number;
  /** Levels the modifier was applied to. Equal to the character level. */
  levelsApplied: number;
  /**
   * True when the arithmetic produced a maximum of zero or less. No floor is
   * applied; the caller names the case rather than inventing a rule.
   */
  notPositive: boolean;
}

export function maximumHitPointsFor(input: MaximumHitPointInput): MaximumHitPoints {
  const levelsApplied = Math.max(1, Math.trunc(input.level));
  if (input.classBase === null || input.constitutionModifier === null)
    return { value: null, constitutionTotal: 0, levelsApplied, notPositive: false };
  const constitutionTotal = input.constitutionModifier * levelsApplied;
  const value = input.classBase + constitutionTotal;
  return { value, constitutionTotal, levelsApplied, notPositive: value <= 0 };
}
