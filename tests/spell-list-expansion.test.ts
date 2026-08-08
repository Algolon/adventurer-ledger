/**
 * Reaching a spell list makes its spells reachable — and nothing more.
 *
 * Content can already say `class → addSpellList → spell-list → spellIds`, and
 * until now nothing read the last hop: the rules engine collected the list ID
 * into `spellLists` and no surface ever expanded it. The only way to make a
 * spell offerable was an `addSpell` effect per spell, which for a real catalogue
 * means roughly a thousand redundant grants.
 *
 * These are the semantics that replace that, and the distinction they turn on is
 * the whole point: *access to a list*, *membership of a spell in a list* and
 * *knowing a spell* are three different facts. Expanding the first two must not
 * produce the third.
 */
import { describe, expect, it } from "vitest";
import {
  buildSpellListIndex,
  planSpellAvailability,
  spellAvailabilityFor,
} from "@/src/services/spell-availability";
import { planActivation } from "@/src/services/choice-planner";
import { planBuild } from "@/src/services/build-planner";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import {
  LITANY_MEMBER_IDS,
  SPELL_IDS,
  SPELL_LIST_IDS,
  SPELL_V1_ENTRIES,
  spellPackV2StoredEntries,
} from "@/tests/fixtures/spell-foundation-pack";
import { nonCasterDraft, tidecaller, tidecallerDraft } from "@/tests/fixtures/spell-foundation-character";

const ENTRIES = spellPackV2StoredEntries();

const availabilityFor = (build = tidecallerDraft()) =>
  planSpellAvailability(planActivation(build, ENTRIES), ENTRIES, build);

const rowFor = (id: string) => availabilityFor().spells.find(spell => spell.id === id);

describe("the index reads membership from both directions the schema allows", () => {
  const index = buildSpellListIndex(ENTRIES);

  it("finds a spell the list's own spellIds names", () => {
    expect(index.membersOf(SPELL_LIST_IDS.litany)).toContain(SPELL_IDS.saltWard);
  });

  it("finds a spell that names the list from its own side", () => {
    // `undertow` is absent from the litany's `spellIds` and declares it in
    // `spellListIds`. Reading one direction only would lose it.
    expect(index.membersOf(SPELL_LIST_IDS.litany)).toContain(SPELL_IDS.undertow);
  });

  it("returns each member once, in a deterministic order", () => {
    const members = index.membersOf(SPELL_LIST_IDS.litany);
    expect([...members]).toEqual(LITANY_MEMBER_IDS);
    expect(new Set(members).size).toBe(members.length);
  });

  it("reports an unknown list as empty rather than throwing", () => {
    expect(index.membersOf("spell-list:not-installed")).toEqual([]);
  });

  it("keeps a spell on two lists as one record with two memberships", () => {
    expect(index.listsFor(SPELL_IDS.sharedCurrent)).toEqual(
      [SPELL_LIST_IDS.deepChoir, SPELL_LIST_IDS.litany].sort(),
    );
    expect(index.membersOf(SPELL_LIST_IDS.deepChoir)).toContain(SPELL_IDS.sharedCurrent);
    expect(index.membersOf(SPELL_LIST_IDS.litany)).toContain(SPELL_IDS.sharedCurrent);
  });
});

describe("a class reaches the spells of the list it is granted", () => {
  it("reports the list the class's own effect grants", () => {
    expect(availabilityFor().listIds).toEqual([SPELL_LIST_IDS.litany]);
  });

  it("makes every member of that list reachable", () => {
    expect(availabilityFor().spells.map(spell => spell.id).sort()).toEqual(LITANY_MEMBER_IDS);
  });

  it("does not reach a spell that is only on a list nobody granted", () => {
    expect(rowFor(SPELL_IDS.abyssalHymn)).toBeUndefined();
  });

  it("reaches a shared spell once, not once per list", () => {
    const rows = availabilityFor().spells.filter(spell => spell.id === SPELL_IDS.sharedCurrent);
    expect(rows).toHaveLength(1);
    // The record still knows both memberships; only the reachable one counts.
    expect(rows[0].viaListIds).toEqual([SPELL_LIST_IDS.litany]);
  });

  it("produces no duplicate rows at all", () => {
    const ids = availabilityFor().spells.map(spell => spell.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic across repeated planning of the same build", () => {
    expect(availabilityFor()).toEqual(availabilityFor());
  });

  it("gives a build with no class no availability at all", () => {
    const build = nonCasterDraft();
    const empty = planSpellAvailability(planActivation(build, ENTRIES), ENTRIES, build);
    expect(empty.listIds).toEqual([]);
    expect(empty.spells).toEqual([]);
  });
});

describe("membership is not knowledge", () => {
  it("marks a list member the class was never granted as not known", () => {
    for (const id of [SPELL_IDS.saltWard, SPELL_IDS.undertow, SPELL_IDS.sharedCurrent]) {
      expect(rowFor(id)?.known).toBe(false);
      expect(rowFor(id)?.alwaysPrepared).toBe(false);
    }
  });

  it("marks only the outright grant as known", () => {
    expect(rowFor(SPELL_IDS.tidemark)?.known).toBe(true);
    expect(rowFor(SPELL_IDS.tidemark)?.alwaysPrepared).toBe(true);
  });

  it("leaves the derived sheet's spell list to the grants alone", () => {
    // The sheet answers "what does this character have"; availability answers
    // "what could this character take". Expanding the list must not move the
    // first, or every list member silently becomes a known spell.
    const sheet = resolveDerivedCharacter({ character: tidecaller(), entries: ENTRIES, ruleset: undefined });
    expect(sheet.spellcasting?.spells.map(spell => spell.id)).toEqual([SPELL_IDS.tidemark]);
  });

  it("carries ritual metadata onto the reachable rows", () => {
    expect(rowFor(SPELL_IDS.saltWard)?.ritual).toBe(true);
    expect(rowFor(SPELL_IDS.undertow)?.ritual).toBe(false);
  });
});

describe("the builder's planning pass carries the availability", () => {
  it("offers the list's spells on the plan the Spells step reads", () => {
    const plan = planBuild(tidecallerDraft(), ENTRIES, "guided");
    expect(plan.spellAvailability.spells.map(spell => spell.id).sort()).toEqual(LITANY_MEMBER_IDS);
  });

  it("still treats the class as a caster, so the step stays applicable", () => {
    const plan = planBuild(tidecallerDraft(), ENTRIES, "guided");
    expect(plan.steps.map(step => step.id)).toContain("spells-resources");
  });

  it("gives a class with no spell reach an empty availability and no step", () => {
    // Version 1 of the same pack: the same class, before it reached a list.
    const plan = planBuild(tidecallerDraft(), SPELL_V1_ENTRIES(), "guided");
    expect(plan.spellAvailability.spells).toEqual([]);
    expect(plan.steps.map(step => step.id)).not.toContain("spells-resources");
  });

  it("commits nothing: availability adds no choice the user has to answer", () => {
    const before = planBuild(tidecallerDraft(), SPELL_V1_ENTRIES(), "guided");
    const after = planBuild(tidecallerDraft(), ENTRIES, "guided");
    expect(after.requiredChoices.map(choice => choice.choiceId)).toEqual(
      before.requiredChoices.map(choice => choice.choiceId),
    );
  });
});

describe("the expansion reports content it cannot resolve", () => {
  it("names a list member with no installed entry instead of dropping it", () => {
    // The litany still names `saltWard` in its own `spellIds`; the spell record
    // is gone. A short list would be indistinguishable from a correct one.
    const entries = ENTRIES.filter(entry => entry.id !== SPELL_IDS.saltWard);
    const build = tidecallerDraft();
    const availability = planSpellAvailability(planActivation(build, entries), entries, build);
    expect(availability.spells.map(spell => spell.id)).not.toContain(SPELL_IDS.saltWard);
    expect(availability.missingSpellIds).toContain(SPELL_IDS.saltWard);
  });

  it("cannot report a membership that only the missing spell declared", () => {
    // `undertow` is on the litany because `undertow` says so. Remove the record
    // and the claim goes with it: there is nothing left to call missing, and
    // nothing invents a member the remaining content never mentions.
    const entries = ENTRIES.filter(entry => entry.id !== SPELL_IDS.undertow);
    const build = tidecallerDraft();
    const availability = planSpellAvailability(planActivation(build, entries), entries, build);
    expect(availability.spells.map(spell => spell.id)).not.toContain(SPELL_IDS.undertow);
    expect(availability.missingSpellIds).toEqual([]);
  });

  it("treats a granted list that does not exist as reaching nothing", () => {
    const index = buildSpellListIndex(ENTRIES);
    const availability = spellAvailabilityFor(
      {
        spellLists: new Set(["spell-list:not-installed"]),
        spells: new Set<string>(),
        alwaysPreparedSpells: new Set<string>(),
      },
      index,
    );
    expect(availability.spells).toEqual([]);
    expect(availability.missingSpellIds).toEqual([]);
  });
});
