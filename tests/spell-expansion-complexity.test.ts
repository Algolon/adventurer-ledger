/**
 * Spell-list expansion costs one pass, whatever the catalogue holds.
 *
 * The eventual real catalogue is a few hundred spells across a dozen lists. An
 * expansion that scans every entry per list, or rebuilds the membership index
 * per spell, stays correct and turns a planning pass into `lists × entries`. The
 * synthetic slice has one list and four spells and would hide that completely.
 *
 * So the contract is counted, not timed: one index build and one effect
 * evaluation per planning pass, and both counts identical whether the ruleset
 * ships four spells or four hundred. A wall-clock budget on a shared runner is
 * either loose enough to prove nothing or tight enough to fail for unrelated
 * reasons.
 *
 * The second contract is that content with no spells pays nothing at all, which
 * is what keeps every existing martial build's planning cost where it was.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentEntry } from "@/src/domain/model";

const counters = vi.hoisted(() => ({ index: 0, evaluate: 0 }));

/**
 * The index is counted at its own factory, so nothing in `src/` knows it is
 * being measured — the same arrangement `planning-complexity` uses for the
 * per-pass planning index.
 */
vi.mock("@/src/services/spell-list-index", async importOriginal => {
  const actual = await importOriginal<typeof import("@/src/services/spell-list-index")>();
  return {
    ...actual,
    buildSpellListIndex: (...args: Parameters<typeof actual.buildSpellListIndex>) => {
      counters.index += 1;
      return actual.buildSpellListIndex(...args);
    },
  };
});

vi.mock("@/src/rules/engine", async importOriginal => {
  const actual = await importOriginal<typeof import("@/src/rules/engine")>();
  return {
    ...actual,
    applyEffects: (...args: Parameters<typeof actual.applyEffects>) => {
      counters.evaluate += 1;
      return actual.applyEffects(...args);
    },
  };
});

const { planBuild } = await import("@/src/services/build-planner");
const { SPELL_LIST_IDS, SPELL_V1_ENTRIES, spellPackV2StoredEntries } = await import(
  "@/tests/fixtures/spell-foundation-pack"
);
const { tidecallerDraft } = await import("@/tests/fixtures/spell-foundation-character");
const { CASTER_IDS, CASTER_LIST_IDS, casterStoredEntries } = await import("@/tests/fixtures/caster-selection-pack");
const { EMPTY_DRAFT_BUILD } = await import("@/src/domain/character-record");

const ENTRIES = spellPackV2StoredEntries();

/**
 * The same ruleset with a hundred more spells on the granted list.
 *
 * Cloned from a real fixture spell so every clone is a legitimate record, and
 * each one declares its membership from the spell side — the direction that
 * would cost a scan per lookup if the index were not built once.
 */
function inflated(count: number): ContentEntry[] {
  const template = ENTRIES.find(entry => entry.category === "spell");
  if (!template) throw new Error("The spell fixture ships no spell to clone");
  const clones = Array.from({ length: count }, (_unused, position) => ({
    ...template,
    id: `spell:tc-bulk-${position}`,
    slug: `tc-bulk-${position}`,
    name: `Bulk rune ${position}`,
    mechanics: { ...(template.mechanics as object), spellListIds: [SPELL_LIST_IDS.litany] },
  })) as ContentEntry[];
  return [...ENTRIES, ...clones];
}

beforeEach(() => {
  counters.index = 0;
  counters.evaluate = 0;
});

describe("one planning pass expands spell lists once", () => {
  it("has enough content for the contract to mean something", () => {
    const plan = planBuild(tidecallerDraft(), inflated(400), "guided");
    expect(plan.spellAvailability.spells.length).toBeGreaterThan(400);
  });

  it("builds the membership index exactly once", () => {
    planBuild(tidecallerDraft(), ENTRIES, "guided");
    expect(counters.index).toBe(1);
  });

  it("evaluates the activated effects exactly once", () => {
    planBuild(tidecallerDraft(), ENTRIES, "guided");
    expect(counters.evaluate).toBe(1);
  });

  it("does not scale either count with the size of the catalogue", () => {
    planBuild(tidecallerDraft(), ENTRIES, "guided");
    const small = { ...counters };

    counters.index = 0;
    counters.evaluate = 0;
    planBuild(tidecallerDraft(), inflated(400), "guided");

    // Four hundred spells cost exactly what four cost.
    expect({ ...counters }).toEqual(small);
  });
});

/**
 * Selection planning rides the expansion the pass already paid for.
 *
 * Owing a decision must not cost a second index or a second evaluation. The risk
 * is specific and easy to introduce: a selection needs to know which spells are
 * eligible, and the obvious way to answer that is to expand the lists again per
 * selection — which is invisible on a fixture with two selections and four spells
 * and is `selections × catalogue` on a real one.
 */
describe("owing spell selections costs no extra expansion", () => {
  /** The caster pack's list, inflated so the contract has something to measure. */
  function inflatedCaster(count: number): ContentEntry[] {
    const entries = casterStoredEntries();
    const template = entries.find(entry => entry.category === "spell");
    if (!template) throw new Error("The caster fixture ships no spell to clone");
    const clones = Array.from({ length: count }, (_unused, position) => ({
      ...template,
      id: `spell:cs-bulk-${position}`,
      slug: `cs-bulk-${position}`,
      name: `Bulk glyph ${position}`,
      // Level 1 and on the Runescribe's list, so they land inside the declared
      // band of a selection rather than being filtered out before it counts.
      mechanics: { ...(template.mechanics as object), level: 1, spellListIds: [CASTER_LIST_IDS.glyphs] },
    })) as ContentEntry[];
    return [...entries, ...clones];
  }

  const casterDraft = () => ({
    ...EMPTY_DRAFT_BUILD,
    name: "Complexity caster",
    level: 5,
    classId: CASTER_IDS.runescribe,
    speciesId: CASTER_IDS.species,
    backgroundId: CASTER_IDS.background,
    abilityScores: { strength: 8, dexterity: 13, constitution: 12, intelligence: 15, wisdom: 14, charisma: 10 },
  });

  it("has enough content for the contract to mean something", () => {
    const plan = planBuild(casterDraft(), inflatedCaster(400), "guided");
    const known = plan.spellSelections.find(selection => selection.model === "known" && selection.minSpellLevel > 0);
    // The offered set really does grow with the catalogue.
    expect(known?.options.length ?? 0).toBeGreaterThan(400);
  });

  it("still builds the membership index exactly once", () => {
    planBuild(casterDraft(), inflatedCaster(400), "guided");
    expect(counters.index).toBe(1);
  });

  it("still evaluates the activated effects exactly once", () => {
    planBuild(casterDraft(), inflatedCaster(400), "guided");
    expect(counters.evaluate).toBe(1);
  });

  it("does not scale either count with the catalogue or the number of selections", () => {
    const small = casterStoredEntries();
    planBuild(casterDraft(), small, "guided");
    const baseline = { ...counters };

    counters.index = 0;
    counters.evaluate = 0;
    const large = inflatedCaster(400);
    planBuild(casterDraft(), large, "guided");

    expect({ ...counters }).toEqual(baseline);
  });
});

describe("content with no spells pays nothing", () => {
  it("builds no index and runs no evaluation for a ruleset without spell effects", () => {
    planBuild(tidecallerDraft(), SPELL_V1_ENTRIES(), "guided");
    expect(counters).toEqual({ index: 0, evaluate: 0 });
  });

  it("still pays nothing when the ruleset defines spells the build cannot reach", () => {
    // The lists and the spells are installed; the class is the version that
    // reaches none of them. Nothing about the catalogue's size should matter.
    const entries = [...SPELL_V1_ENTRIES(), ...ENTRIES.filter(entry => entry.category === "spell")];
    planBuild(tidecallerDraft(), entries, "guided");
    expect(counters).toEqual({ index: 0, evaluate: 0 });
  });
});
