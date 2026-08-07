/**
 * Origin ability increases, validated against the pattern currently in force.
 *
 * A draft stores three things: the base scores, the origin increases the user
 * placed, and the finals. The finals are the only value the sheet reads, so an
 * increase that is no longer authorised is not a cosmetic problem — it keeps
 * being added to a score after the content that granted it has been replaced.
 * Changing the ruleset, the origin or the background can all remove the pattern
 * an allocation was made under.
 *
 * The rule here is deliberately blunt: an increase survives only while the
 * active origin still offers that ability and that amount. Anything else is
 * reported as invalid and excluded from the finals, so an unauthorised increase
 * is never quietly applied. Nothing in this module names a background, an
 * ability set or a pattern; all of it is read from the origin's own declared
 * `abilityScoreChoices`.
 */
import { backgroundMechanicsSchema } from "@/src/domain/content-pack";
import { ABILITIES } from "@/src/domain/character-record";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { Ability, ContentEntry, ID } from "@/src/domain/model";

/** The increases one origin offers, and to which abilities. */
export interface OriginIncreasePattern {
  /** Abilities the origin allows an increase to be placed on. */
  abilities: readonly Ability[];
  /**
   * The default distribution. The amounts are one slot each: `[2, 1]` is two
   * slots, not "up to 2". Kept as its own field because content that declares no
   * alternative declares only this, and because it is what every reader written
   * before alternatives existed still reads.
   */
  increasePattern: readonly number[];
  /**
   * Every distribution this origin allows, `increasePattern` first.
   *
   * A background may legitimately offer a choice between shapes — two abilities
   * at +2 and +1, or three at +1 each. They are alternatives, not a menu of
   * amounts: taking +2 from one and +1 from another is one decision about how to
   * spend the whole allowance, so they are validated as whole patterns rather
   * than slot by slot.
   */
  patterns: readonly (readonly number[])[];
  sourceEntryId: ID;
  sourceLabel: string;
}

export type InvalidIncreaseReason =
  | "no-active-pattern"
  | "ability-not-offered"
  | "amount-not-offered"
  | "slot-already-used";

export interface InvalidAbilityIncrease {
  ability: Ability;
  amount: number;
  reason: InvalidIncreaseReason;
}

export interface AbilityAllocation {
  /** The scores before any origin increase. */
  base: Readonly<Partial<Record<Ability, number>>>;
  /** Only the increases the active pattern still authorises. */
  increases: Readonly<Partial<Record<Ability, number>>>;
  /** Base plus the valid increases. This is what may be committed. */
  final: Readonly<Partial<Record<Ability, number>>>;
  /** Stored increases the active pattern does not authorise. */
  invalid: readonly InvalidAbilityIncrease[];
  /** True when every slot the pattern offers has been placed. */
  patternSatisfied: boolean;
  /**
   * Which of the origin's distributions the stored allocation best fits, as an
   * index into `OriginIncreasePattern.patterns`. Absent when no pattern applies.
   */
  activePatternIndex?: number;
  /** Slots of the active distribution that are still unplaced. */
  remainingSlots: readonly number[];
}

/**
 * The increase pattern the build's background currently declares.
 *
 * Read from the background because that is where this schema puts it. A ruleset
 * whose origin declares none simply has no pattern, which is a real answer: it
 * means no increase can be authorised, not that any increase is acceptable.
 */
export function originIncreasePatternFor(
  build: Pick<CharacterDraftBuild, "backgroundId">,
  entries: readonly ContentEntry[],
): OriginIncreasePattern | undefined {
  if (!build.backgroundId) return undefined;
  const background = entries.find(entry => entry.id === build.backgroundId);
  if (background?.category !== "background") return undefined;
  const mechanics = backgroundMechanicsSchema.safeParse(background.mechanics);
  if (!mechanics.success) return undefined;
  const abilities = mechanics.data.abilityScoreChoices.abilities.filter((name): name is Ability =>
    (ABILITIES as readonly string[]).includes(name),
  );
  const { increasePattern, increasePatterns } = mechanics.data.abilityScoreChoices;
  if (!abilities.length || !increasePattern.length) return undefined;
  /*
   * `increasePatterns` is authoritative when present, and the declared default
   * is folded in rather than assumed to be one of them: content that lists
   * alternatives without repeating its default would otherwise silently stop
   * offering the distribution every existing draft was allocated under.
   * Duplicates are collapsed so a pack that does repeat it offers it once.
   */
  const declared = increasePatterns?.length ? [increasePattern, ...increasePatterns] : [increasePattern];
  const seen = new Set<string>();
  const patterns: number[][] = [];
  for (const candidate of declared) {
    if (!candidate.length) continue;
    const key = [...candidate].sort((a, b) => a - b).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    patterns.push([...candidate]);
  }
  return { abilities, increasePattern, patterns, sourceEntryId: background.id, sourceLabel: background.name };
}

/** How one stored allocation scores against one candidate distribution. */
interface PatternFit {
  index: number;
  increases: Partial<Record<Ability, number>>;
  invalid: InvalidAbilityIncrease[];
  /** Slots the pattern still has spare. */
  remaining: number[];
}

/**
 * Validates the stored increases against exactly one distribution.
 *
 * Iteration follows the canonical ability order and each ability holds at most
 * one increase by construction, so a pattern with two identical amounts still
 * cannot be spent three times and the same draft always produces the same
 * verdict.
 */
function fitPattern(
  amounts: readonly number[],
  index: number,
  stored: Readonly<Partial<Record<Ability, number>>>,
  offered: ReadonlySet<Ability>,
): PatternFit {
  const increases: Partial<Record<Ability, number>> = {};
  const invalid: InvalidAbilityIncrease[] = [];
  const remaining = [...amounts];

  for (const ability of ABILITIES) {
    const amount = stored[ability];
    if (typeof amount !== "number") continue;
    if (!offered.has(ability)) {
      invalid.push({ ability, amount, reason: "ability-not-offered" });
      continue;
    }
    if (!amounts.includes(amount)) {
      invalid.push({ ability, amount, reason: "amount-not-offered" });
      continue;
    }
    const slot = remaining.indexOf(amount);
    if (slot < 0) {
      invalid.push({ ability, amount, reason: "slot-already-used" });
      continue;
    }
    remaining.splice(slot, 1);
    increases[ability] = amount;
  }
  return { index, increases, invalid, remaining };
}

/**
 * The base score for one ability.
 *
 * A draft that recorded its base scores is authoritative. An older draft that
 * only stored finals is reconstructed by subtracting whatever increase it stored
 * alongside them, which is the exact inverse of how the finals were produced and
 * therefore leaves a draft with no increases completely untouched.
 */
function baseScoreFor(build: CharacterDraftBuild, ability: Ability): number | undefined {
  const recorded = build.abilityBaseScores[ability];
  if (typeof recorded === "number") return recorded;
  const final = build.abilityScores[ability];
  if (typeof final !== "number") return undefined;
  return final - (build.abilityIncreases[ability] ?? 0);
}

/**
 * Validates the stored allocation and recomputes the finals from it.
 *
 * Slots are consumed in the pattern's declared order and each ability may hold
 * at most one increase, so a pattern with two identical amounts still cannot be
 * spent three times. Iteration follows the canonical ability order, so the same
 * draft always produces the same verdict.
 */
export function reconcileAbilityAllocation(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
): AbilityAllocation {
  const pattern = originIncreasePatternFor(build, entries);
  const base: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const score = baseScoreFor(build, ability);
    if (typeof score === "number") base[ability] = score;
  }

  let increases: Partial<Record<Ability, number>> = {};
  let invalid: InvalidAbilityIncrease[] = [];
  let remainingSlots: number[] = [];
  let activePatternIndex: number | undefined;

  if (!pattern) {
    // No pattern in force authorises nothing. That is a real answer, and a
    // different one from "any increase is acceptable".
    for (const ability of ABILITIES) {
      const amount = build.abilityIncreases[ability];
      if (typeof amount === "number") invalid.push({ ability, amount, reason: "no-active-pattern" });
    }
  } else {
    /*
     * Which distribution the user is working in is not stored, so it is
     * inferred: the one that accounts for the most of what they have already
     * placed. A half-finished allocation is ambiguous by nature — a single +1
     * fits both +2/+1 and +1/+1/+1 — and the tie is broken by declaration
     * order, so the same draft always resolves the same way and re-running this
     * never moves it.
     */
    const offered = new Set(pattern.abilities);
    const fits = pattern.patterns.map((amounts, index) => fitPattern(amounts, index, build.abilityIncreases, offered));
    const best = fits.reduce((chosen, candidate) => {
      const chosenValid = Object.keys(chosen.increases).length;
      const candidateValid = Object.keys(candidate.increases).length;
      if (candidateValid !== chosenValid) return candidateValid > chosenValid ? candidate : chosen;
      // Among equally valid fits prefer the one closest to being finished, so a
      // complete +1/+1/+1 is not reported against an unfinished +2/+1.
      if (candidate.remaining.length !== chosen.remaining.length)
        return candidate.remaining.length < chosen.remaining.length ? candidate : chosen;
      return chosen;
    });
    increases = best.increases;
    invalid = best.invalid;
    remainingSlots = best.remaining;
    activePatternIndex = best.index;
  }

  const final: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const score = base[ability];
    if (typeof score === "number") final[ability] = score + (increases[ability] ?? 0);
  }

  return {
    base,
    increases,
    final,
    invalid,
    // A satisfied allocation has every slot of its distribution placed and
    // nothing left over that the distribution does not authorise.
    patternSatisfied: Boolean(pattern) && remainingSlots.length === 0 && invalid.length === 0,
    ...(activePatternIndex === undefined ? {} : { activePatternIndex }),
    remainingSlots,
  };
}

/**
 * Splits committed final scores back into base scores and origin increases.
 *
 * A committed character stores only the finals, because the finals are the only
 * thing the sheet reads. The builder needs both halves — the Abilities step
 * shows the array assignment and the placed increases separately — so reopening
 * a character has to recover the split rather than pretend no increase was ever
 * placed. Pretending would be visible and wrong twice over: the origin's slots
 * would look unspent, and re-committing would add them a second time.
 *
 * The recovery is the exact inverse of how the finals were produced. Every
 * assignment of the origin's declared slots to distinct offered abilities is
 * tried, and one is accepted only when the base scores it implies are a
 * legitimate starting assignment — the declared standard array, when the
 * character was built with it. Nothing here names an ability set, a pattern or a
 * background; all of it is read from the origin's own declaration.
 *
 * `recovered` is false when no assignment fits. The finals are then kept as the
 * base with no increases, which preserves every committed score exactly and
 * leaves the planner to report the mismatch against the step that owns it. That
 * is deliberately not silent: a build whose origin changed under it should be
 * repaired by the user on the Abilities step, not guessed at here.
 *
 * A tie between two assignments cannot change a committed score — both produce
 * the same finals — so the first in canonical ability order is taken.
 */
export function recoverAbilityAllocation(input: {
  readonly finals: Readonly<Partial<Record<Ability, number>>>;
  readonly pattern: OriginIncreasePattern | undefined;
  readonly standardArray: readonly number[] | undefined;
  readonly abilityMethod: "standard-array" | "manual";
}): { base: Partial<Record<Ability, number>>; increases: Partial<Record<Ability, number>>; recovered: boolean } {
  const finals: Partial<Record<Ability, number>> = { ...input.finals };
  const asBase = () => ({ base: { ...finals }, increases: {}, recovered: false });

  const { pattern } = input;
  if (!pattern || !pattern.increasePattern.length) return { ...asBase(), recovered: true };
  // Recovery compares a candidate base against the declared starting assignment.
  // Without one there is nothing to test a candidate against, so no split can be
  // claimed and the finals stand as the base.
  if (input.abilityMethod !== "standard-array" || !input.standardArray?.length) return asBase();
  if (ABILITIES.some(ability => typeof finals[ability] !== "number")) return asBase();

  const offered = pattern.abilities.filter(ability => ABILITIES.includes(ability));
  const target = input.standardArray;

  const search = (
    remaining: readonly number[],
    used: ReadonlySet<Ability>,
    placed: Partial<Record<Ability, number>>,
  ): Partial<Record<Ability, number>> | undefined => {
    if (!remaining.length) {
      const base = ABILITIES.map(ability => (finals[ability] as number) - (placed[ability] ?? 0));
      return sameMultiset(base, target) ? { ...placed } : undefined;
    }
    const [amount, ...rest] = remaining;
    for (const ability of ABILITIES) {
      if (!offered.includes(ability) || used.has(ability)) continue;
      const found = search(rest, new Set([...used, ability]), { ...placed, [ability]: amount });
      if (found) return found;
    }
    return undefined;
  };

  /*
   * Every distribution the origin offers is a candidate, tried in declaration
   * order. A character committed under +1/+1/+1 must recover as that, not fail
   * to recover because the default happens to be +2/+1.
   */
  let increases: Partial<Record<Ability, number>> | undefined;
  for (const amounts of pattern.patterns) {
    increases = search(amounts, new Set(), {});
    if (increases) break;
  }
  if (!increases) return asBase();

  const base: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) base[ability] = (finals[ability] as number) - (increases[ability] ?? 0);
  return { base, increases, recovered: true };
}

/** Order-insensitive numeric equality. */
function sameMultiset(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort((a, b) => a - b);
  const sortedRight = [...right].sort((a, b) => a - b);
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/** The allocation fields of a draft patch, for a service that has to repair one. */
export function allocationPatch(allocation: AbilityAllocation): Pick<
  CharacterDraftBuild,
  "abilityBaseScores" | "abilityIncreases" | "abilityScores"
> {
  return {
    abilityBaseScores: { ...allocation.base },
    abilityIncreases: { ...allocation.increases },
    abilityScores: { ...allocation.final },
  };
}
