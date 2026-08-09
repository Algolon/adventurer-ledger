/**
 * The semantics of a player choosing spells.
 *
 * Written before the implementation, against the contracts the slice has to
 * establish rather than against whatever it happens to do. The eight cases the
 * design note calls out are each stated once here, in the order a reader meets
 * them: availability is not obligation, obligation comes from content, an answer
 * persists and is classified, and a source change takes only what it owned.
 */
import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT_BUILD, type CharacterDraftBuild } from "@/src/domain/character-record";
import { planBuild } from "@/src/services/build-planner";
import { changeClass } from "@/src/services/class-change";
import {
  CASTER_IDS,
  CASTER_SELECTION_IDS,
  CASTER_SPELL_IDS,
  casterStoredEntries,
} from "./fixtures/caster-selection-pack";

const entries = casterStoredEntries();

const build = (partial: Partial<CharacterDraftBuild> = {}): CharacterDraftBuild => ({
  ...EMPTY_DRAFT_BUILD,
  name: "Test caster",
  level: 1,
  speciesId: CASTER_IDS.species,
  backgroundId: CASTER_IDS.background,
  abilityScores: { strength: 8, dexterity: 13, constitution: 12, intelligence: 15, wisdom: 14, charisma: 10 },
  abilityBaseScores: { strength: 8, dexterity: 13, constitution: 12, intelligence: 13, wisdom: 13, charisma: 10 },
  abilityIncreases: { intelligence: 2, wisdom: 1 },
  ...partial,
});

const selectionsOf = (draft: CharacterDraftBuild) => planBuild(draft, entries).spellSelections;
const byId = (draft: CharacterDraftBuild, selectionId: string) => {
  const found = selectionsOf(draft).find(selection => selection.selectionId === selectionId);
  if (!found) throw new Error(`No selection planned for ${selectionId}`);
  return found;
};

describe("availability is not obligation", () => {
  it("plans no selection for a build that reaches no spell list", () => {
    // The species and background alone reach nothing. Availability is empty, and
    // so is the obligation: a non-caster is not owed a spell decision.
    const plan = planBuild(build(), entries);
    expect(plan.spellAvailability.spells).toHaveLength(0);
    expect(plan.spellSelections).toHaveLength(0);
  });

  it("keeps reachable spells out of the character's own spell state", () => {
    // The Spell Foundation contract, restated where it is easiest to break: the
    // Runescribe reaches six spells at level 1 and is granted none of them.
    const plan = planBuild(build({ classId: CASTER_IDS.runescribe }), entries);
    expect(plan.spellAvailability.spells.length).toBeGreaterThan(0);
    expect(plan.spellAvailability.spells.every(spell => !spell.known)).toBe(true);
    expect(plan.spellAvailability.spells.every(spell => !spell.alwaysPrepared)).toBe(true);
  });
});

describe("obligation comes from content", () => {
  it("owes the counts the level 1 progression rows state", () => {
    const draft = build({ classId: CASTER_IDS.runescribe });
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeCantrips).required).toBe(2);
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeKnown).required).toBe(2);
  });

  it("offers a prepared model as well as a known one", () => {
    expect(byId(build({ classId: CASTER_IDS.runescribe }), CASTER_SELECTION_IDS.runescribeKnown).model).toBe("known");
    expect(byId(build({ classId: CASTER_IDS.warden }), CASTER_SELECTION_IDS.wardenPrepared).model).toBe("prepared");
  });

  it("owes the whole accumulated obligation at a higher starting level", () => {
    // Level 5 is a fresh character, not four level-ups. The cantrip row at 4 and
    // the known row at 5 are both already due.
    const draft = build({ classId: CASTER_IDS.runescribe, level: 5 });
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeCantrips).required).toBe(3);
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeKnown).required).toBe(4);
  });

  it("reaches a higher spell level only when a progression row says so", () => {
    const atOne = byId(build({ classId: CASTER_IDS.runescribe }), CASTER_SELECTION_IDS.runescribeKnown);
    expect(atOne.options.map(option => option.id)).not.toContain(CASTER_SPELL_IDS.scriveningWard);

    const atThree = byId(
      build({ classId: CASTER_IDS.runescribe, level: 3 }),
      CASTER_SELECTION_IDS.runescribeKnown,
    );
    expect(atThree.options.map(option => option.id)).toContain(CASTER_SPELL_IDS.scriveningWard);
    // Level 3 is still not level 5.
    expect(atThree.options.map(option => option.id)).not.toContain(CASTER_SPELL_IDS.chapterOfAsh);
  });

  it("separates cantrips from levelled spells by the declared band", () => {
    const draft = build({ classId: CASTER_IDS.runescribe });
    const cantrips = byId(draft, CASTER_SELECTION_IDS.runescribeCantrips);
    const known = byId(draft, CASTER_SELECTION_IDS.runescribeKnown);
    expect(cantrips.options.every(option => option.level === 0)).toBe(true);
    expect(known.options.every(option => option.level > 0)).toBe(true);
  });
});

describe("eligibility", () => {
  it("offers only spells on a list the build actually reaches", () => {
    const offered = byId(
      build({ classId: CASTER_IDS.runescribe, level: 5 }),
      CASTER_SELECTION_IDS.runescribeKnown,
    ).options.map(option => option.id);
    // On the sealed list only, which nothing in the pack reaches.
    expect(offered).not.toContain(CASTER_SPELL_IDS.sealedVerse);
    // On the Warden's list only.
    expect(offered).not.toContain(CASTER_SPELL_IDS.holdTheLine);
  });

  it("rejects a stored spell the build's lists do not reach", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: { [CASTER_SELECTION_IDS.runescribeKnown]: [CASTER_SPELL_IDS.sealedVerse] },
    });
    const selection = byId(draft, CASTER_SELECTION_IDS.runescribeKnown);
    expect(selection.selected).not.toContain(CASTER_SPELL_IDS.sealedVerse);
    expect(selection.ineligibleSelected).toContain(CASTER_SPELL_IDS.sealedVerse);
    expect(selection.resolved).toBe(false);
  });

  it("keeps one canonical identity for a spell two lists both name", () => {
    // `whisperOfSalt` is on both class lists. One record, one row, one option.
    const offered = byId(
      build({ classId: CASTER_IDS.runescribe }),
      CASTER_SELECTION_IDS.runescribeKnown,
    ).options.filter(option => option.id === CASTER_SPELL_IDS.whisperOfSalt);
    expect(offered).toHaveLength(1);
  });
});

describe("counting", () => {
  it("is unresolved below the required count and reports it against its own step", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: { [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark] },
    });
    const plan = planBuild(draft, entries);
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeCantrips).resolved).toBe(false);
    expect(
      plan.issues.some(
        issue => issue.code === "SPELL_SELECTION_UNRESOLVED" && issue.recordId === CASTER_SELECTION_IDS.runescribeCantrips,
      ),
    ).toBe(true);
    expect(plan.steps.find(step => step.id === "spells-resources")?.status).toBe("incomplete");
  });

  it("is resolved at exactly the required count", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: {
        [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark, CASTER_SPELL_IDS.markOfPassage],
        [CASTER_SELECTION_IDS.runescribeKnown]: [CASTER_SPELL_IDS.bindingScript, CASTER_SPELL_IDS.whisperOfSalt],
      },
    });
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeCantrips).resolved).toBe(true);
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeKnown).resolved).toBe(true);
    expect(planBuild(draft, entries).issues.some(issue => issue.code === "SPELL_SELECTION_UNRESOLVED")).toBe(false);
  });

  it("rejects more than the required count", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: {
        [CASTER_SELECTION_IDS.runescribeCantrips]: [
          CASTER_SPELL_IDS.emberSpark,
          CASTER_SPELL_IDS.markOfPassage,
          // A third cantrip the level 1 row does not authorise.
          CASTER_SPELL_IDS.steadyFlame,
        ],
      },
    });
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeCantrips).resolved).toBe(false);
    expect(planBuild(draft, entries).issues.some(issue => issue.code === "SPELL_SELECTION_UNRESOLVED")).toBe(true);
  });

  it("does not let a granted spell consume the allowance", () => {
    // The Warden is granted two spells and still owes one prepared choice.
    const draft = build({ classId: CASTER_IDS.warden });
    const selection = byId(draft, CASTER_SELECTION_IDS.wardenPrepared);
    expect(selection.required).toBe(1);
    expect(selection.selected).toHaveLength(0);
    expect(selection.resolved).toBe(false);
  });

  it("does not offer an always-prepared spell as a selectable choice", () => {
    const selection = byId(build({ classId: CASTER_IDS.warden }), CASTER_SELECTION_IDS.wardenPrepared);
    const always = selection.options.find(option => option.id === CASTER_SPELL_IDS.wardensEye);
    // Present as a distinguished row if present at all, but never selectable.
    expect(always?.selectable ?? false).toBe(false);
    expect(always?.alwaysPrepared ?? true).toBe(true);
  });
});

describe("source change", () => {
  it("removes spell selections the outgoing class owned", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: {
        [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark, CASTER_SPELL_IDS.markOfPassage],
      },
    });
    const changed = changeClass(draft, CASTER_IDS.warden, entries);
    expect(changed.build.spellSelections?.[CASTER_SELECTION_IDS.runescribeCantrips]).toBeUndefined();
    expect(changed.removed.map(note => note.recordId)).toContain(CASTER_SELECTION_IDS.runescribeCantrips);
  });

  it("surfaces the incoming class's own obligation", () => {
    const draft = build({ classId: CASTER_IDS.runescribe });
    const changed = changeClass(draft, CASTER_IDS.warden, entries);
    const planned = planBuild(changed.build, entries).spellSelections;
    expect(planned.map(selection => selection.selectionId)).toEqual([CASTER_SELECTION_IDS.wardenPrepared]);
  });

  it("leaves unrelated draft state alone", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: { [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark] },
    });
    const changed = changeClass(draft, CASTER_IDS.warden, entries);
    expect(changed.build.name).toBe(draft.name);
    expect(changed.build.speciesId).toBe(CASTER_IDS.species);
    expect(changed.build.backgroundId).toBe(CASTER_IDS.background);
    expect(changed.build.abilityScores).toEqual(draft.abilityScores);
  });

  it("is idempotent", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: { [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark] },
    });
    const once = changeClass(draft, CASTER_IDS.warden, entries);
    const twice = changeClass(once.build, CASTER_IDS.warden, entries);
    expect(twice.build).toEqual(once.build);
    expect(twice.removed).toHaveLength(0);
  });
});

describe("level change", () => {
  it("keeps still-legal selections when the level rises", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      spellSelections: {
        [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark, CASTER_SPELL_IDS.markOfPassage],
      },
    });
    const raised = { ...draft, level: 4 };
    const selection = byId(raised, CASTER_SELECTION_IDS.runescribeCantrips);
    expect(selection.selected).toHaveLength(2);
    // The level 4 row raises the count, so the delta is one more cantrip.
    expect(selection.required).toBe(3);
    expect(selection.resolved).toBe(false);
  });

  it("does not leave an over-count silently active when the level falls", () => {
    const draft = build({
      classId: CASTER_IDS.runescribe,
      level: 5,
      spellSelections: {
        [CASTER_SELECTION_IDS.runescribeKnown]: [
          CASTER_SPELL_IDS.bindingScript,
          CASTER_SPELL_IDS.whisperOfSalt,
          CASTER_SPELL_IDS.scriveningWard,
          CASTER_SPELL_IDS.chapterOfAsh,
        ],
      },
    });
    expect(byId(draft, CASTER_SELECTION_IDS.runescribeKnown).resolved).toBe(true);

    const lowered = { ...draft, level: 1 };
    const selection = byId(lowered, CASTER_SELECTION_IDS.runescribeKnown);
    expect(selection.required).toBe(2);
    expect(selection.resolved).toBe(false);
    // The level 2 and 3 spells are beyond what level 1 reaches, and are reported
    // rather than quietly kept or quietly deleted.
    expect(selection.ineligibleSelected).toContain(CASTER_SPELL_IDS.scriveningWard);
    expect(selection.ineligibleSelected).toContain(CASTER_SPELL_IDS.chapterOfAsh);
    expect(planBuild(lowered, entries).issues.some(issue => issue.code === "SPELL_SELECTION_UNRESOLVED")).toBe(true);
  });
});
