import { describe, expect, it } from "vitest";
import {
  OVERRIDE_TARGET_KINDS,
  isAllowedTargetPath,
  parseOverrideTarget,
  type OverrideTargetKind,
} from "@/src/domain/character-record";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import { baselineFor } from "@/src/services/character-services";
import { SYNTHETIC_ENTRIES, SYNTHETIC_IDS, SYNTHETIC_RULESET, PROFICIENCY_IDS } from "@/src/content/runefolio-synthetic";
import { brammel, brammelRuntime } from "@/tests/fixtures/brammel";
import type { CharacterOverrideRecord } from "@/src/domain/character-record";

const sheetWith = (overrides: CharacterOverrideRecord[] = []) =>
  resolveDerivedCharacter({
    character: brammel(),
    runtime: brammelRuntime(),
    overrides,
    entries: SYNTHETIC_ENTRIES,
    ruleset: SYNTHETIC_RULESET,
  });

const override = (targetPath: string, value: number, extra: Partial<CharacterOverrideRecord> = {}): CharacterOverrideRecord => ({
  id: `override:${targetPath}`,
  characterId: "character:brammel",
  targetPath,
  operation: "replace",
  value,
  automaticBaseline: null,
  scope: "persistent",
  status: "active",
  createdAt: "2026-08-03T08:00:00.000Z",
  updatedAt: "2026-08-03T08:00:00.000Z",
  ...extra,
});

/** One representative path per supported target kind, with how to read it back. */
const SUPPORTED: readonly { kind: OverrideTargetKind; path: string; read: (sheet: ReturnType<typeof sheetWith>) => number | null }[] = [
  { kind: "proficiencyBonus", path: "proficiencyBonus", read: sheet => sheet.proficiencyBonus.value },
  { kind: "hitPointsMaximum", path: "hitPoints.maximum", read: sheet => sheet.hitPoints.maximum.value },
  { kind: "armorClass", path: "armorClass", read: sheet => sheet.armorClass.value },
  { kind: "initiative", path: "initiative", read: sheet => sheet.initiative.value },
  { kind: "speed", path: "speed", read: sheet => sheet.speed.value },
  { kind: "abilityScore", path: "abilityScore.strength", read: sheet => sheet.abilities.strength.score.value },
  { kind: "abilityModifier", path: "abilityModifier.dexterity", read: sheet => sheet.abilities.dexterity.modifier.value },
  {
    kind: "savingThrow",
    path: `savingThrow.${PROFICIENCY_IDS.saveStrength}`,
    read: sheet => sheet.saves.find(item => item.id === PROFICIENCY_IDS.saveStrength)?.total.value ?? null,
  },
  {
    kind: "check",
    path: `check.${PROFICIENCY_IDS.skillHaulage}`,
    read: sheet => sheet.checks.find(item => item.id === PROFICIENCY_IDS.skillHaulage)?.total.value ?? null,
  },
  {
    kind: "resourceMaximum",
    path: `resource.${SYNTHETIC_IDS.resource}.maximum`,
    read: sheet => sheet.resources.find(item => item.id === SYNTHETIC_IDS.resource)?.maximum.value ?? null,
  },
  {
    kind: "attackBonus",
    path: `attack.${SYNTHETIC_IDS.attack}.attackBonus`,
    read: sheet => sheet.actions.find(item => item.id === SYNTHETIC_IDS.attack)?.attackBonus.value ?? null,
  },
];

describe("every supported override target is real", () => {
  it("covers every registered target kind", () => {
    expect([...new Set(SUPPORTED.map(item => item.kind))].sort()).toEqual([...OVERRIDE_TARGET_KINDS].sort());
  });

  for (const { kind, path, read } of SUPPORTED) {
    it(`${kind}: validates, resolves a baseline, applies, and is not a no-op`, () => {
      // 1. Validation accepts it.
      expect(isAllowedTargetPath(path)).toBe(true);
      expect(parseOverrideTarget(path)?.kind).toBe(kind);

      // 2. Baseline lookup resolves it from the automatic sheet.
      const automatic = sheetWith();
      const baseline = baselineFor(automatic, path);
      expect(baseline).not.toBeNull();
      expect(baseline).toBe(read(automatic));

      // 3. Applying a replace actually changes the mechanical result.
      const replaced = sheetWith([override(path, (baseline as number) + 7)]);
      expect(read(replaced)).toBe((baseline as number) + 7);

      // 4. And so does a numeric add.
      const added = sheetWith([override(path, 3, { operation: "add" })]);
      expect(read(added)).toBe((baseline as number) + 3);
    });
  }
});

describe("unsupported targets are rejected rather than stored inert", () => {
  const REJECTED = [
    // Runtime state the runtime service owns; a durable override would fight
    // every damage and heal.
    "hitPoints.current",
    // Rendered as an expression such as `2d8`; a numeric override cannot express it.
    "hitDice.total",
    // Prefix matches that used to be accepted and then did nothing.
    `resource.${SYNTHETIC_IDS.resource}`,
    `resource.${SYNTHETIC_IDS.resource}.bogus`,
    `resource.${SYNTHETIC_IDS.resource}.minimum`,
    `attack.${SYNTHETIC_IDS.attack}`,
    `attack.${SYNTHETIC_IDS.attack}.bogus`,
    `attack.${SYNTHETIC_IDS.attack}.damageBonus`,
    `savingThrow.${PROFICIENCY_IDS.saveStrength}.bonus`,
    `check.${PROFICIENCY_IDS.skillHaulage}.extra`,
    // Never targets at all.
    "abilityScore.luck",
    "abilityModifier.luck",
    "biography.backstory",
    "__proto__",
    "constructor.prototype",
    "",
  ];

  for (const path of REJECTED)
    it(`rejects ${path || "(empty)"}`, () => {
      expect(isAllowedTargetPath(path)).toBe(false);
      expect(parseOverrideTarget(path)).toBeUndefined();
      expect(baselineFor(sheetWith(), path)).toBeNull();
    });

  it("leaves the sheet unchanged if such a record somehow exists", () => {
    const baseline = JSON.stringify(sheetWith());
    for (const path of REJECTED.filter(Boolean)) expect(JSON.stringify(sheetWith([override(path, 99)]))).toBe(baseline);
  });
});

describe("stale reporting has one source of truth", () => {
  it("reports a moved baseline even when the stored status still says active", () => {
    // Stored baseline of 15 no longer matches the automatic 18.
    const sheet = sheetWith([override("armorClass", 20, { automaticBaseline: 15, status: "active" })]);
    expect(sheet.armorClass.override?.stale).toBe(true);
    expect(sheet.staleOverrideIds).toContain("override:armorClass");
  });

  it("reports an override whose target can no longer be calculated", () => {
    const character = brammel();
    const sheet = resolveDerivedCharacter({
      character: { ...character, abilityScores: { ...character.abilityScores, dexterity: undefined } },
      overrides: [override("armorClass", 20, { automaticBaseline: 18 })],
      entries: SYNTHETIC_ENTRIES,
      ruleset: SYNTHETIC_RULESET,
    });
    expect(sheet.armorClass.value).toBeNull();
    expect(sheet.staleOverrideIds).toContain("override:armorClass");
  });

  it("does not report an override whose baseline still matches", () => {
    const sheet = sheetWith([override("armorClass", 20, { automaticBaseline: 18 })]);
    expect(sheet.armorClass.override?.stale).toBe(false);
    expect(sheet.staleOverrideIds).toEqual([]);
  });
});
