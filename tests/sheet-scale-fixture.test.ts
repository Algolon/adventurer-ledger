import { describe, expect, it } from "vitest";
import { validateContentPackJson } from "@/src/import/validate-pack";
import {
  CASTER_MAX_LEVEL,
  MARTIAL_MAX_LEVEL,
  SCALE_ALWAYS_PREPARED_SPELL,
  SCALE_ENTRIES,
  SCALE_IDS,
  SCALE_SLOTS,
  SCALE_SPELL_COUNT,
  scalePackJson,
  scaleSpellsKnownAt,
} from "@/tests/fixtures/sheet-scale-ruleset";

/**
 * The scale fixture is evidence, so it has to be true before it is used as any.
 *
 * A screenshot of a sheet built from a pack that quietly dropped half its
 * content proves nothing about the sheet. These assertions are the ones a reader
 * would otherwise have to take on trust: the pack is valid against the shipped
 * schema, the classes really do cover the levels the specs build at, the caster
 * really does carry five slot pools and thirty spells, and the always-prepared
 * grant is a grant rather than list membership.
 */
describe("the Wardenreach scale fixture", () => {
  it("is a valid pack against the shipped schema", () => {
    const outcome = validateContentPackJson(scalePackJson());
    expect(outcome.errors).toEqual([]);
    expect(outcome.success).toBe(true);
  });

  it("covers twelve martial levels and nine caster levels", () => {
    const martial = SCALE_ENTRIES.find(item => item.id === SCALE_IDS.martial);
    const caster = SCALE_ENTRIES.find(item => item.id === SCALE_IDS.caster);
    const progression = (entry: typeof martial) =>
      ((entry?.mechanics as { progression?: readonly { level: number }[] }).progression ?? []).map(row => row.level);

    expect(progression(martial)).toEqual(Array.from({ length: MARTIAL_MAX_LEVEL }, (_, index) => index + 1));
    expect(progression(caster)).toEqual(Array.from({ length: CASTER_MAX_LEVEL }, (_, index) => index + 1));
  });

  it("declares one slot pool per spell level the caster reaches", () => {
    const rule = SCALE_ENTRIES.find(item => item.id === SCALE_IDS.spellcastingRule);
    const data = (rule?.mechanics as { data?: { slotResourceIds?: readonly string[] } }).data;
    expect(data?.slotResourceIds).toEqual([SCALE_SLOTS[1], SCALE_SLOTS[2], SCALE_SLOTS[3], SCALE_SLOTS[4], SCALE_SLOTS[5]]);
  });

  it("ships a repertoire large enough to need navigating", () => {
    const spells = SCALE_ENTRIES.filter(item => item.category === "spell");
    expect(spells).toHaveLength(SCALE_SPELL_COUNT);
    expect(SCALE_SPELL_COUNT).toBeGreaterThanOrEqual(24);
    // Six spell levels, so grouping by level is a real structure and not a label.
    const levels = new Set(spells.map(item => (item.mechanics as { level: number }).level));
    expect([...levels].sort((left, right) => left - right)).toEqual([0, 1, 2, 3, 4, 5]);
    // Ritual and concentration both occur, and neither is universal.
    const ritual = spells.filter(item => (item.mechanics as { ritual?: boolean }).ritual === true);
    expect(ritual.length).toBeGreaterThan(0);
    expect(ritual.length).toBeLessThan(spells.length);
  });

  it("grants its whole repertoire by level, with exactly one always prepared", () => {
    const caster = SCALE_ENTRIES.find(item => item.id === SCALE_IDS.caster);
    const unwrap = (effect: { type: string; effect?: unknown }): { type: string; alwaysPrepared?: boolean } =>
      effect.type === "unlockAtLevel" ? unwrap(effect.effect as { type: string; effect?: unknown }) : effect;
    const grants = (caster?.effects ?? []).map(unwrap).filter(effect => effect.type === "addSpell");
    expect(grants).toHaveLength(SCALE_SPELL_COUNT);
    expect(grants.filter(effect => effect.alwaysPrepared === true)).toHaveLength(1);
    expect(SCALE_ALWAYS_PREPARED_SPELL).toBe("Chalkmark");

    // The repertoire is what makes a high-level Spells workspace large: a level
    // 1 caster's is a handful, a level 9 caster's is the whole table.
    expect(scaleSpellsKnownAt(1)).toBeLessThan(SCALE_SPELL_COUNT / 2);
    expect(scaleSpellsKnownAt(CASTER_MAX_LEVEL)).toBe(SCALE_SPELL_COUNT);
  });

  it("carries no private, restricted or non-original material", () => {
    for (const item of SCALE_ENTRIES) {
      expect(item.private, `${item.id} is marked private`).toBe(false);
      expect(item.exportRestricted, `${item.id} is export-restricted`).toBe(false);
      expect(item.licenseType, `${item.id} is not original`).toBe("original");
      expect(item.fullText, `${item.id} carries full text`).toBeUndefined();
    }
  });
});
