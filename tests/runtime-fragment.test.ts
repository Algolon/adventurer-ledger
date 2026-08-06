/**
 * Pure contract for the runtime undo fragment.
 *
 * The service-level behaviour is covered in the Dexie integration suite; this
 * file pins the representation itself, because the defect it fixes was a
 * representation gap rather than a control-flow mistake: the fragment could not
 * express "this key was absent", so undo could not restore absence.
 */
import { describe, expect, it } from "vitest";
import {
  applyRuntimeFragment,
  fragmentRestoresExactly,
  runtimeFragmentDiff,
} from "@/src/services/runtime-service";
import type { CharacterRuntimeStateRecord, RuntimeFragment } from "@/src/domain/character-record";

const RESOURCE = "resource:rallying-breath";
const OTHER = "resource:second-wind-synthetic";

const state = (over: Partial<CharacterRuntimeStateRecord> = {}): CharacterRuntimeStateRecord => ({
  characterId: "character:probe",
  revision: 1,
  currentHitPoints: 10,
  maximumHitPointsAtLastSync: 10,
  temporaryHitPoints: 0,
  resourceUses: {},
  resourceMaximaAtLastSync: {},
  conditions: [],
  hitDiceRemaining: 1,
  exhaustion: 0,
  deathSaves: { successes: 0, failures: 0 },
  createdAt: "2026-08-03T08:00:00.000Z",
  updatedAt: "2026-08-03T08:00:00.000Z",
  ...over,
});

/** Applies the recorded `before` fragment to the after-state. */
const roundTrip = (previous: CharacterRuntimeStateRecord, next: CharacterRuntimeStateRecord) =>
  applyRuntimeFragment(next, runtimeFragmentDiff(previous, next).before);

describe("the fragment distinguishes all four resource key states", () => {
  it("a key that existed with a numeric value is recorded as a value", () => {
    const previous = state({ resourceUses: { [RESOURCE]: 3 } });
    const next = state({ resourceUses: { [RESOURCE]: 2 } });
    const { before } = runtimeFragmentDiff(previous, next);
    expect(before.resourceUses).toEqual({ [RESOURCE]: 3 });
    expect(before.resourceUsesRemoved).toBeUndefined();
  });

  it("a key that did not exist before is recorded as a removal, not as a value", () => {
    const previous = state({ resourceUses: {} });
    const next = state({ resourceUses: { [RESOURCE]: 2 } });
    const { before } = runtimeFragmentDiff(previous, next);
    expect(before.resourceUses).toEqual({});
    expect(before.resourceUsesRemoved).toEqual([RESOURCE]);
    // No sentinel number stands in for absence.
    expect(Object.values(before.resourceUses ?? {})).not.toContain(-1);
  });

  it("a key that must be removed during undo is actually deleted", () => {
    const previous = state({ resourceUses: {} });
    const next = state({ resourceUses: { [RESOURCE]: 2 } });
    const restored = roundTrip(previous, next);
    expect(RESOURCE in restored.resourceUses).toBe(false);
    expect(restored.resourceUses).toEqual({});
  });

  it("an unchanged key appears in neither side of the fragment", () => {
    const previous = state({ resourceUses: { [RESOURCE]: 3, [OTHER]: 1 } });
    const next = state({ resourceUses: { [RESOURCE]: 2, [OTHER]: 1 } });
    const { before, after } = runtimeFragmentDiff(previous, next);
    expect(before.resourceUses).toEqual({ [RESOURCE]: 3 });
    expect(after.resourceUses).toEqual({ [RESOURCE]: 2 });
    expect(before.resourceUsesRemoved).toBeUndefined();
    // And it survives the round trip untouched.
    expect(roundTrip(previous, next).resourceUses).toEqual(previous.resourceUses);
  });

  it("records a key that disappeared as a removal on the after side", () => {
    const previous = state({ resourceUses: { [RESOURCE]: 3 } });
    const next = state({ resourceUses: {} });
    const { before, after } = runtimeFragmentDiff(previous, next);
    expect(after.resourceUsesRemoved).toEqual([RESOURCE]);
    expect(before.resourceUses).toEqual({ [RESOURCE]: 3 });
    expect(roundTrip(previous, next).resourceUses).toEqual({ [RESOURCE]: 3 });
  });
});

describe("fragmentRestoresExactly is the source of the reversible label", () => {
  const CASES: [string, CharacterRuntimeStateRecord, CharacterRuntimeStateRecord][] = [
    ["absent key spent", state({ resourceUses: {} }), state({ resourceUses: { [RESOURCE]: 2 } })],
    ["explicit key spent", state({ resourceUses: { [RESOURCE]: 3 } }), state({ resourceUses: { [RESOURCE]: 2 } })],
    ["clamped to zero", state({ resourceUses: { [RESOURCE]: 1 } }), state({ resourceUses: { [RESOURCE]: 0 } })],
    [
      "one of two resources",
      state({ resourceUses: { [RESOURCE]: 3, [OTHER]: 1 } }),
      state({ resourceUses: { [RESOURCE]: 2, [OTHER]: 1 } }),
    ],
    ["clamped heal", state({ currentHitPoints: 9 }), state({ currentHitPoints: 10 })],
    [
      "damage absorbed by temporary hit points",
      state({ currentHitPoints: 10, temporaryHitPoints: 4 }),
      state({ currentHitPoints: 8, temporaryHitPoints: 0 }),
    ],
    [
      "condition added",
      state({ conditions: [] }),
      state({ conditions: [{ conditionId: "condition:winded", appliedAt: "2026-08-03T08:00:00.000Z" }] }),
    ],
    [
      "condition removed",
      state({ conditions: [{ conditionId: "condition:winded", appliedAt: "2026-08-03T08:00:00.000Z" }] }),
      state({ conditions: [] }),
    ],
  ];

  for (const [label, previous, next] of CASES)
    it(`round-trips ${label}`, () => {
      const { before, changed } = runtimeFragmentDiff(previous, next);
      expect(changed).toBe(true);
      expect(fragmentRestoresExactly(previous, next, before)).toBe(true);
      expect(roundTrip(previous, next).resourceUses).toEqual(previous.resourceUses);
    });

  it("rejects a fragment that cannot express an absent key", () => {
    const previous = state({ resourceUses: {} });
    const next = state({ resourceUses: { [RESOURCE]: 2 } });
    // The old merge-only shape: values without the removal list.
    const merged: RuntimeFragment = { resourceUses: {} };
    expect(fragmentRestoresExactly(previous, next, merged)).toBe(false);
    // The current shape does restore it.
    expect(fragmentRestoresExactly(previous, next, runtimeFragmentDiff(previous, next).before)).toBe(true);
  });
});

describe("action records written before this contract stay safe to apply", () => {
  /**
   * Records already stored by this unmerged draft branch carry `resourceUses`
   * and no `resourceUsesRemoved`. They must keep applying without throwing, and
   * with exactly their previous merge semantics, so no migration or database
   * version change is required.
   */
  it("applies a legacy value-only fragment with the original merge semantics", () => {
    const current = state({ resourceUses: { [RESOURCE]: 2, [OTHER]: 1 } });
    const legacy: RuntimeFragment = { resourceUses: { [RESOURCE]: 3 } };
    expect(applyRuntimeFragment(current, legacy).resourceUses).toEqual({ [RESOURCE]: 3, [OTHER]: 1 });
  });

  it("tolerates a legacy fragment with no resource information at all", () => {
    const current = state({ currentHitPoints: 7, resourceUses: { [RESOURCE]: 2 } });
    const legacy: RuntimeFragment = { currentHitPoints: 10 };
    const applied = applyRuntimeFragment(current, legacy);
    expect(applied.currentHitPoints).toBe(10);
    expect(applied.resourceUses).toEqual({ [RESOURCE]: 2 });
  });
});
