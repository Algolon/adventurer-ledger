/**
 * The whole persistence path for a spell selection, through the real services.
 *
 * The slice is only real if the answer survives every boundary it crosses, so
 * this walks them in order rather than asserting the ends: a draft is updated,
 * re-read from storage, committed, projected onto the sheet, reopened for edit,
 * changed and recommitted. A UI-only implementation passes none of these.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  RUNECALLER_CHOICES,
  RUNECALLER_IDS,
  RUNECALLER_SPELL_SELECTIONS,
  SYNTHETIC_CHOICES,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild, CharacterRecord } from "@/src/domain/character-record";
import type { CommitResult, DraftSnapshot, EditDraftSnapshot } from "@/src/services/character-services";
import type { DerivedCharacterSheet } from "@/src/services/derived-resolver";

let harness: Harness;
beforeEach(async () => {
  harness = await createHarness();
});
afterEach(closeHarnesses);

const CANTRIPS = [RUNECALLER_IDS.spells.siltWhisper, RUNECALLER_IDS.spells.tallyMark];
const RUNES = [RUNECALLER_IDS.spells.stoneReading, RUNECALLER_IDS.spells.quietTheWake];

/** A complete, guided-valid Runecaller, spell decisions included. */
const CASTER_BUILD: Partial<CharacterDraftBuild> = {
  name: "Sereth Marsh",
  level: 1,
  classId: RUNECALLER_IDS.class,
  speciesId: SYNTHETIC_IDS.species,
  backgroundId: SYNTHETIC_IDS.background,
  abilityMethod: "standard-array",
  abilityBaseScores: { strength: 8, dexterity: 14, constitution: 13, intelligence: 15, wisdom: 12, charisma: 10 },
  abilityIncreases: { strength: 2, constitution: 1 },
  abilityScores: { strength: 10, dexterity: 14, constitution: 14, intelligence: 15, wisdom: 12, charisma: 10 },
  choiceSelections: {
    [RUNECALLER_CHOICES.classSkills]: ["option:runecaller-proficiency:skill-riverlore"],
    [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
  },
  equipmentSelections: { "equipment-choice:runecaller-kit": ["equipment-option:runecaller-warden-pack"] },
  spellSelections: {
    [RUNECALLER_SPELL_SELECTIONS.cantrips]: CANTRIPS,
    [RUNECALLER_SPELL_SELECTIONS.runesKnown]: RUNES,
  },
};

/** The derived sheet, which is what a later Sheet UX would actually consume. */
async function sheetOf(characterId: string): Promise<DerivedCharacterSheet> {
  const sheet = await harness.query.sheet(characterId);
  if (!sheet) throw new Error("no derived sheet was produced");
  return sheet;
}

async function createDraft(draftId: string) {
  return expectOk<DraftSnapshot>(
    await harness.drafts.create({ draftId, rulesetProfileId: SYNTHETIC_RULESET_ID, level: 1, presentation: "guided" }),
  );
}

async function commitCaster(characterId: string, draftId: string): Promise<CharacterRecord> {
  const created = await createDraft(draftId);
  const filled = expectOk<DraftSnapshot>(
    await harness.drafts.update({
      draftId,
      expectedRevision: created.revision,
      patch: CASTER_BUILD,
      lastStepId: "review",
    }),
  );
  expectOk<CommitResult>(
    await harness.commit.commit({
      operationId: `operation:${characterId}`,
      draftId,
      expectedDraftRevision: filled.revision,
      characterId,
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    }),
  );
  const record = await harness.context.repositories.characters.get(characterId);
  if (!record) throw new Error("the committed character was not written");
  return record;
}

describe("a spell selection in a draft", () => {
  it("is planned as an obligation the caster owes", async () => {
    const created = await createDraft("draft:owed");
    const planned = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: "draft:owed",
        expectedRevision: created.revision,
        patch: { ...CASTER_BUILD, spellSelections: {} },
        lastStepId: "spells-resources",
      }),
    );
    const selections = planned.plan.spellSelections;
    expect(selections.map(selection => selection.selectionId)).toEqual([
      RUNECALLER_SPELL_SELECTIONS.cantrips,
      RUNECALLER_SPELL_SELECTIONS.runesKnown,
    ]);
    expect(selections.every(selection => !selection.resolved)).toBe(true);
    expect(planned.plan.issues.some(issue => issue.code === "SPELL_SELECTION_UNRESOLVED")).toBe(true);
    expect(planned.plan.guidedComplete).toBe(false);
  });

  it("survives a re-read of the draft from storage", async () => {
    const created = await createDraft("draft:reread");
    await harness.drafts.update({
      draftId: "draft:reread",
      expectedRevision: created.revision,
      patch: CASTER_BUILD,
      lastStepId: "spells-resources",
    });
    // A fresh read, as resuming the app performs one.
    const resumed = await harness.drafts.get("draft:reread");
    if (!resumed) throw new Error("the draft was not resumable");
    expect(resumed.draft.build.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.cantrips]).toEqual(CANTRIPS);
    expect(resumed.draft.build.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.runesKnown]).toEqual(RUNES);
    expect(resumed.plan.spellSelections.every(selection => selection.resolved)).toBe(true);
    expect(resumed.plan.guidedComplete).toBe(true);
  });
});

describe("a committed caster", () => {
  it("stores the selections on the durable record", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    expect(character.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.cantrips]).toEqual(CANTRIPS);
    expect(character.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.runesKnown]).toEqual(RUNES);
  });

  it("projects known, granted and always-prepared apart on the sheet", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    const sheet = await sheetOf(character.id);
    const spells = sheet.spellcasting?.spells ?? [];
    const find = (id: string) => spells.find(spell => spell.id === id);

    // Chosen: known, not granted.
    for (const id of [...CANTRIPS, ...RUNES]) {
      expect(find(id)?.known).toBe(true);
      expect(find(id)?.granted).toBe(false);
    }
    // Granted outright, and one of those always prepared.
    expect(find(RUNECALLER_IDS.spells.emberline)?.granted).toBe(true);
    expect(find(RUNECALLER_IDS.spells.emberline)?.alwaysPrepared).toBe(true);
    expect(find(RUNECALLER_IDS.spells.wardOfReeds)?.granted).toBe(true);
    expect(find(RUNECALLER_IDS.spells.wardOfReeds)?.alwaysPrepared).toBe(false);
  });

  it("does not put a merely reachable spell on the sheet", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    const sheet = await sheetOf(character.id);
    const ids = new Set((sheet.spellcasting?.spells ?? []).map(spell => spell.id));
    // On the repertoire, offered by a selection, and chosen by nobody.
    expect(ids.has(RUNECALLER_IDS.spells.lanternRune)).toBe(false);
    expect(ids.has(RUNECALLER_IDS.spells.borrowedFooting)).toBe(false);
  });

  it("gives one canonical row to a spell reached more than one way", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    const sheet = await sheetOf(character.id);
    const spells = sheet.spellcasting?.spells ?? [];
    // Every granted rune is also on the repertoire the class reaches.
    expect(new Set(spells.map(spell => spell.id)).size).toBe(spells.length);
  });
});

describe("reopening a committed caster for edit", () => {
  it("prefills the selections as they were committed", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.build.spellSelections).toEqual(character.spellSelections);
    expect(opened.repairs).toEqual([]);
    expect(opened.plan.spellSelections.every(selection => selection.resolved)).toBe(true);
  });

  it("shows the chosen spells as selected and the granted ones as not selectable", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const cantrips = opened.plan.spellSelections.find(
      selection => selection.selectionId === RUNECALLER_SPELL_SELECTIONS.cantrips,
    );
    const chosen = cantrips?.options.filter(option => option.selected).map(option => option.id) ?? [];
    expect(chosen.sort()).toEqual([...CANTRIPS].sort());
    const granted = cantrips?.options.find(option => option.id === RUNECALLER_IDS.spells.emberline);
    expect(granted?.selectable).toBe(false);
    expect(granted?.alwaysPrepared).toBe(true);
  });

  it("keeps a legal reselection through a recommit and a reopen", async () => {
    const character = await commitCaster("character:sereth", "draft:sereth");
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const swapped = [RUNECALLER_IDS.spells.siltWhisper, RUNECALLER_IDS.spells.lanternRune];

    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.draft.revision,
        patch: {
          spellSelections: {
            ...character.spellSelections,
            [RUNECALLER_SPELL_SELECTIONS.cantrips]: swapped,
          },
        },
        lastStepId: "review",
      }),
    );
    expect(edited.plan.spellSelections.every(selection => selection.resolved)).toBe(true);

    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:sereth-edit",
        draftId: opened.draft.id,
        expectedDraftRevision: edited.revision,
        characterId: character.id,
        expectedCharacterRevision: opened.draft.editingCharacterRevision as number,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    const recommitted = await harness.context.repositories.characters.get(character.id);
    expect(recommitted?.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.cantrips]).toEqual(swapped);
    // And the runes nobody touched are exactly where they were.
    expect(recommitted?.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.runesKnown]).toEqual(RUNES);

    const reopened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(reopened.draft.build.spellSelections?.[RUNECALLER_SPELL_SELECTIONS.cantrips]).toEqual(swapped);

    const sheet = await sheetOf(character.id);
    const ids = new Set((sheet.spellcasting?.spells ?? []).map(spell => spell.id));
    expect(ids.has(RUNECALLER_IDS.spells.lanternRune)).toBe(true);
    // The cantrip that was swapped out is no longer the character's.
    expect(ids.has(RUNECALLER_IDS.spells.tallyMark)).toBe(false);
  });
});
