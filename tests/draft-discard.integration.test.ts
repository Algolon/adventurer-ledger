/**
 * Discarding an unfinished build, and the exact boundary of what that removes.
 *
 * Until now the only way to get rid of a build was to finish it and then delete
 * the committed character, so the pilot's phone accumulated drafts it could not
 * clear. `abandon` marks a draft and leaves the row; discard removes it.
 *
 * Nothing else in the schema keys by draft ID, so the assertions below are
 * about the negative half: every other draft, every committed character and all
 * installed content have to survive one build being thrown away — and a draft
 * opened against a committed character must take only itself with it.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  SYNTHETIC_CHOICES,
  SYNTHETIC_EQUIPMENT_CHOICE,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { CommitResult, DraftDiscardReceipt, DraftSnapshot } from "@/src/services/character-services";

const BUILD: Partial<CharacterDraftBuild> = {
  name: "Brammel Voss",
  level: 1,
  classId: SYNTHETIC_IDS.class,
  speciesId: SYNTHETIC_IDS.species,
  backgroundId: SYNTHETIC_IDS.background,
  abilityMethod: "standard-array",
  abilityScores: { strength: 16, dexterity: 15, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
  choiceSelections: {
    [SYNTHETIC_CHOICES.fightingStyle]: ["option:guarded-hand"],
    [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-riverlore", "option:proficiency:skill-haulage"],
    [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
  },
  equipmentSelections: { [SYNTHETIC_EQUIPMENT_CHOICE]: ["equipment-option:warden-pack"] },
};

let harness: Harness;
beforeEach(async () => {
  harness = await createHarness();
});
afterEach(closeHarnesses);

/** An in-progress draft, filled far enough to be a real build. */
async function startDraft(draftId: string, name: string) {
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({ draftId, rulesetProfileId: SYNTHETIC_RULESET_ID, level: 1, presentation: "guided" }),
  );
  return expectOk<DraftSnapshot>(
    await harness.drafts.update({
      draftId,
      expectedRevision: created.revision,
      patch: { ...BUILD, name },
      lastStepId: "abilities",
    }),
  );
}

async function commitCharacter(characterId: string, name: string) {
  const draftId = `draft:commit:${characterId}`;
  const filled = await startDraft(draftId, name);
  const fingerprint = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
  return expectOk<CommitResult>(
    await harness.commit.commit({
      operationId: `operation:${characterId}`,
      draftId,
      expectedDraftRevision: filled.revision,
      characterId,
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: fingerprint,
    }),
  );
}

describe("discarding an unfinished build", () => {
  it("removes the draft outright rather than marking it", async () => {
    const draft = await startDraft("draft:one", "Throwaway");
    expectOk<DraftDiscardReceipt>(await harness.drafts.discard("draft:one", draft.revision));

    expect(await harness.drafts.get("draft:one")).toBeUndefined();
    const library = await harness.query.library();
    expect(library.drafts).toHaveLength(0);
  });

  it("leaves every other unfinished build alone", async () => {
    const keep = await startDraft("draft:keep", "Keeper");
    const drop = await startDraft("draft:drop", "Throwaway");

    expectOk<DraftDiscardReceipt>(await harness.drafts.discard("draft:drop", drop.revision));

    const library = await harness.query.library();
    expect(library.drafts.map(item => item.draftId)).toEqual(["draft:keep"]);
    expect((await harness.drafts.get("draft:keep"))?.revision).toBe(keep.revision);
  });

  it("leaves committed characters and installed content untouched", async () => {
    await commitCharacter("character:survivor", "Survivor");
    const drop = await startDraft("draft:drop", "Throwaway");
    const contentBefore = (await harness.query.contentForRuleset(SYNTHETIC_RULESET_ID)).length;

    expectOk<DraftDiscardReceipt>(await harness.drafts.discard("draft:drop", drop.revision));

    const library = await harness.query.library();
    expect(library.characters.map(item => item.characterId)).toEqual(["character:survivor"]);
    expect(await harness.query.sheet("character:survivor")).toBeDefined();
    expect((await harness.query.contentForRuleset(SYNTHETIC_RULESET_ID)).length).toBe(contentBefore);
    expect((await harness.query.rulesets()).length).toBeGreaterThan(0);
  });

  it("abandons an edit without touching the character it was editing", async () => {
    await commitCharacter("character:edited", "Edited");
    const opened = expectOk<DraftSnapshot>(
      await harness.drafts.openForCharacter("character:edited", "draft:edit"),
    );
    const before = await harness.query.sheet("character:edited");

    const receipt = expectOk<DraftDiscardReceipt>(await harness.drafts.discard("draft:edit", opened.revision));

    expect(receipt.editedCharacterId).toBe("character:edited");
    const after = await harness.query.sheet("character:edited");
    expect(after?.characterRevision).toBe(before?.characterRevision);
    expect(after?.name).toBe("Edited");
  });

  it("refuses a discard raised against a revision that has moved on", async () => {
    const draft = await startDraft("draft:one", "Throwaway");
    await harness.drafts.update({
      draftId: "draft:one",
      expectedRevision: draft.revision,
      patch: { name: "Renamed" },
      lastStepId: "abilities",
    });

    const outcome = await harness.drafts.discard("draft:one", draft.revision);

    expect(outcome.status).toBe("stale");
    expect(await harness.drafts.get("draft:one")).toBeDefined();
  });

  it("treats a repeated discard as already gone rather than an error", async () => {
    const draft = await startDraft("draft:one", "Throwaway");
    expectOk<DraftDiscardReceipt>(await harness.drafts.discard("draft:one", draft.revision));

    expect((await harness.drafts.discard("draft:one", draft.revision)).status).toBe("not-found");
  });
});
