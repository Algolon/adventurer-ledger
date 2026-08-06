import { describe, expect, it } from "vitest";
import { canonicalHash, canonicalJson } from "@/src/services/canonical";
import { computeCharacterFingerprint } from "@/src/services/transfer-service";
import { brammel } from "@/tests/fixtures/brammel";
import { SYNTHETIC_CHOICES } from "@/src/content/runefolio-synthetic";
import type { CharacterRecord } from "@/src/domain/character-record";

describe("canonical serialization", () => {
  it("sorts object keys at every depth", () => {
    const left = { b: 1, a: { d: 2, c: { f: 3, e: 4 } } };
    const right = { a: { c: { e: 4, f: 3 }, d: 2 }, b: 1 };
    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(canonicalJson(left)).toBe('{"a":{"c":{"e":4,"f":3},"d":2},"b":1}');
  });

  it("does not drop nested properties the way a replacer array does", () => {
    const value = { top: 1, nested: { deep: "kept" } };
    // The historic bug: JSON.stringify(value, Object.keys(value).sort()) drops
    // `deep` because the replacer allow-list applies at every depth.
    expect(JSON.stringify(value, Object.keys(value).sort())).not.toContain("kept");
    expect(canonicalJson(value)).toContain("kept");
  });

  it("preserves array order by default", () => {
    expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
  });

  it("normalizes order only for declared set-like paths", () => {
    const options = { setPaths: ["tags", "selections.*"] };
    expect(canonicalJson({ tags: ["b", "a"] }, options)).toBe(canonicalJson({ tags: ["a", "b"] }, options));
    expect(canonicalJson({ selections: { x: ["q", "p"] } }, options)).toBe(
      canonicalJson({ selections: { x: ["p", "q"] } }, options),
    );
    // A path that was not declared keeps its order.
    expect(canonicalJson({ ordered: ["b", "a"] }, options)).not.toBe(canonicalJson({ ordered: ["a", "b"] }, options));
  });

  it("treats an explicitly undefined property as absent", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("hashes deterministically across repeated runs", () => {
    const value = { a: [1, { z: 2, y: 3 }], b: "text" };
    expect(canonicalHash(value)).toBe(canonicalHash(value));
  });
});

describe("character fingerprint", () => {
  const base = brammel();
  const fingerprint = (overrides: Partial<CharacterRecord> = {}) => computeCharacterFingerprint({ ...base, ...overrides });
  const baseline = fingerprint();

  it("uses a versioned prefix", () => {
    expect(baseline).toMatch(/^cfp2:/);
  });

  /** Every nested change that alters the character must alter the fingerprint. */
  const NESTED_CHANGES: [string, Partial<CharacterRecord>][] = [
    ["one ability score", { abilityScores: { ...base.abilityScores, strength: 17 } }],
    ["one class level", { classLevels: [{ ...base.classLevels[0], level: 2 }] }],
    ["one class ID", { classLevels: [{ ...base.classLevels[0], classId: "class:other-synthetic" }] }],
    ["one choice selection", { choiceSelections: { ...base.choiceSelections, [SYNTHETIC_CHOICES.fightingStyle]: ["option:other"] } }],
    ["one equipment selection", { equipmentSelections: { "equipment-choice:vanguard-pack": ["equipment-option:river-kit"] } }],
    ["one manual value", { manualValues: { armorClass: 12 } }],
    ["one manual action", { manualActions: [{ id: "manual-action:x", label: "Improvised swing" }] }],
    ["one tag", { tags: ["marked"] }],
    ["one ruleset ID", { rulesetProfileId: "ruleset:other-synthetic" }],
    ["the name", { name: "Renamed" }],
    ["the nickname", { nickname: "Other" }],
    ["the level", { level: 2 }],
    ["the species", { speciesId: "species:other" }],
    ["the background", { backgroundId: "background:other" }],
    ["the ability method", { abilityMethod: "manual" }],
    ["the status", { status: "archived" }],
  ];

  for (const [label, change] of NESTED_CHANGES)
    it(`changes when ${label} changes`, () => {
      expect(fingerprint(change)).not.toBe(baseline);
    });

  it("is identical for records whose object keys are ordered differently", () => {
    /** Rebuilds every object with its keys in reverse insertion order. */
    const deepReverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(deepReverseKeys);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([key, child]) => [key, deepReverseKeys(child)]),
        );
      return value;
    };
    const reordered = deepReverseKeys(base) as CharacterRecord;
    // The reordering is real, not a no-op.
    expect(Object.keys(reordered)).not.toEqual(Object.keys(base));
    expect(Object.keys(reordered.abilityScores)).not.toEqual(Object.keys(base.abilityScores));
    expect(computeCharacterFingerprint(reordered)).toBe(baseline);
  });

  it("is identical when a set-like list is ordered differently", () => {
    const swapped = fingerprint({
      choiceSelections: {
        ...base.choiceSelections,
        [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-haulage", "option:proficiency:skill-riverlore"],
      },
      tags: [],
    });
    const original = fingerprint({ tags: [] });
    expect(swapped).toBe(original);
  });

  it("changes when the override set changes, because overrides travel with the character", () => {
    const override = {
      id: "character:brammel:override:armorClass",
      characterId: "character:brammel",
      targetPath: "armorClass",
      operation: "replace" as const,
      value: 20,
      automaticBaseline: 18,
      scope: "persistent" as const,
      status: "active" as const,
      createdAt: "2026-08-03T08:00:00.000Z",
      updatedAt: "2026-08-03T08:00:00.000Z",
    };
    const withOverride = computeCharacterFingerprint(base, [override]);
    expect(withOverride).not.toBe(baseline);
    expect(computeCharacterFingerprint(base, [{ ...override, value: 21 }])).not.toBe(withOverride);
    expect(computeCharacterFingerprint(base, [{ ...override, operation: "add" }])).not.toBe(withOverride);
    expect(computeCharacterFingerprint(base, [{ ...override, scope: "until-level-up" }])).not.toBe(withOverride);

    // The private reason and the audit timestamps are not part of identity.
    expect(computeCharacterFingerprint(base, [{ ...override, reason: "private ruling" }])).toBe(withOverride);
    expect(computeCharacterFingerprint(base, [{ ...override, updatedAt: "2030-01-01T00:00:00.000Z" }])).toBe(withOverride);
  });

  it("ignores volatile bookkeeping that must not create a transfer conflict", () => {
    for (const change of [
      { revision: 99 },
      { updatedAt: "2030-01-01T00:00:00.000Z" },
      { createdAt: "2030-01-01T00:00:00.000Z" },
      { lastPlayedAt: "2030-01-01T00:00:00.000Z" },
      { contentFingerprint: "fp1:different" },
    ] satisfies Partial<CharacterRecord>[])
      expect(fingerprint(change)).toBe(baseline);
  });
});
