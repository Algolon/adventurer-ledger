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
