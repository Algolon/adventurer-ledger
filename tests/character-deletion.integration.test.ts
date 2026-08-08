/**
 * Deleting a character, and the exact boundary of what that removes.
 *
 * A local-first delete has no undo and no copy elsewhere, so the cascade is
 * asserted against the real schema rather than described. The tables checked
 * here are every table the database keys by `characterId`, plus the drafts that
 * name a character in `editingCharacterId` — that is the whole of what a
 * character owns, and each one is proven both to go when it should and to stay
 * when it belongs to someone else.
 *
 * The negative half matters as much as the positive: content packs, sources,
 * entries, ruleset profiles and other characters are shared, and a delete that
 * reached any of them would take a user's whole library with one character.
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
import type { CharacterDeletionReceipt, CommitResult, DraftSnapshot } from "@/src/services/character-services";

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

/** Commits one character, so the test starts from a real durable record. */
async function commitCharacter(characterId: string, name: string) {
  const draftId = `draft:${characterId}`;
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({
      draftId,
      rulesetProfileId: SYNTHETIC_RULESET_ID,
      level: 1,
      presentation: "guided",
    }),
  );
  const filled = expectOk<DraftSnapshot>(
    await harness.drafts.update({
      draftId,
      expectedRevision: created.revision,
      patch: { ...BUILD, name },
      lastStepId: "review",
    }),
  );
  const fingerprint = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
  const result = expectOk<CommitResult>(
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
  return result;
}

/** Applies one play action, which is what creates runtime state and a log row. */
async function play(characterId: string) {
  expectOk(
    await harness.runtime.apply({
      characterId,
      expectedRuntimeRevision: 1,
      operationId: `operation:play:${characterId}`,
      operation: { kind: "damage", amount: 3 },
    }),
  );
}

/** Every table a character can own a row in, counted for one character. */
async function ownedRowCounts(characterId: string) {
  const { database } = harness;
  return {
    characters: await database.characters.where("id").equals(characterId).count(),
    versions: await database.characterVersions.where("characterId").equals(characterId).count(),
    snapshots: await database.characterSnapshots.where("characterId").equals(characterId).count(),
    drafts: await database.characterDrafts.where("editingCharacterId").equals(characterId).count(),
    runtimeStates: await database.characterRuntimeStates.where("characterId").equals(characterId).count(),
    actions: await database.characterActions.where("characterId").equals(characterId).count(),
    overrides: await database.characterOverrides.where("characterId").equals(characterId).count(),
    derivedSnapshots: await database.characterDerivedSnapshots.where("characterId").equals(characterId).count(),
    validationIssues: await database.validationIssues.where("characterId").equals(characterId).count(),
    overrideDecisions: await database.overrideDecisions.where("characterId").equals(characterId).count(),
  };
}

/** Shared records no character may ever remove. */
async function sharedRowCounts() {
  const { database } = harness;
  return {
    contentPacks: await database.contentPacks.count(),
    contentEntries: await database.contentEntries.count(),
    sources: await database.sources.count(),
    rulesetProfiles: await database.rulesetProfiles.count(),
    appPreferences: await database.appPreferences.count(),
  };
}

describe("deleting a character", () => {
  it("removes the character record itself", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    expect(await harness.database.characters.get("character:brammel")).toBeDefined();

    const receipt = expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));
    expect(receipt.characterId).toBe("character:brammel");
    expect(await harness.database.characters.get("character:brammel")).toBeUndefined();
  });

  it("removes the version history the character owns", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    expect((await ownedRowCounts("character:brammel")).versions).toBeGreaterThan(0);

    const receipt = expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));
    expect(receipt.removed.versions).toBeGreaterThan(0);
    expect((await ownedRowCounts("character:brammel")).versions).toBe(0);
  });

  it("removes an edit draft bound to the character", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    // Opening for edit is what creates the character-bound draft.
    expectOk(await harness.drafts.openForCharacter("character:brammel"));
    expect((await ownedRowCounts("character:brammel")).drafts).toBe(1);

    const receipt = expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));
    expect(receipt.removed.drafts).toBe(1);
    expect((await ownedRowCounts("character:brammel")).drafts).toBe(0);
  });

  it("removes runtime and play state", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    // Play writes runtime state and an action log entry.
    await play("character:brammel");
    const before = await ownedRowCounts("character:brammel");
    expect(before.runtimeStates).toBe(1);
    expect(before.actions).toBeGreaterThan(0);

    const receipt = expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));
    expect(receipt.removed.runtimeStates).toBe(1);
    const after = await ownedRowCounts("character:brammel");
    expect(after.runtimeStates).toBe(0);
    expect(after.actions).toBe(0);
  });

  it("removes derived persistence the character owns", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    await harness.query.sheet("character:brammel");
    expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));
    expect((await ownedRowCounts("character:brammel")).derivedSnapshots).toBe(0);
  });

  it("leaves every other character completely untouched", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    await commitCharacter("character:sereth", "Sereth Marsh");
    expectOk(await harness.drafts.openForCharacter("character:sereth"));
    await play("character:sereth");

    const before = await ownedRowCounts("character:sereth");
    expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));

    expect(await ownedRowCounts("character:sereth")).toEqual(before);
    expect(await harness.database.characters.get("character:sereth")).toBeDefined();
  });

  it("leaves shared content, packs, sources, rulesets and settings untouched", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    const before = await sharedRowCounts();

    expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));

    expect(await sharedRowCounts()).toEqual(before);
  });

  it("reports not-found for a character that does not exist, and writes nothing", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    const before = await ownedRowCounts("character:brammel");

    const outcome = await harness.library.delete("character:ghost");
    expect(outcome.status).toBe("not-found");
    expect(await ownedRowCounts("character:brammel")).toEqual(before);
  });

  /**
   * A repeated confirmation, or a delete raced from a second tab. The first
   * call removes the character; the second finds nothing and says so rather
   * than throwing or removing something else.
   */
  it("is safe to repeat", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    await commitCharacter("character:sereth", "Sereth Marsh");

    expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));
    const second = await harness.library.delete("character:brammel");

    expect(second.status).toBe("not-found");
    expect(await harness.database.characters.get("character:sereth")).toBeDefined();
    expect(await harness.database.characters.count()).toBe(1);
  });

  it("removes every owned row and nothing else, in one call", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    expectOk(await harness.drafts.openForCharacter("character:brammel"));
    await play("character:brammel");
    await harness.query.sheet("character:brammel");

    expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));

    const after = await ownedRowCounts("character:brammel");
    for (const [table, count] of Object.entries(after)) expect(`${table}=${count}`).toBe(`${table}=0`);
  });

  it("does not log the character's name", async () => {
    await commitCharacter("character:brammel", "Brammel Voss");
    harness.logLines.length = 0;
    expectOk<CharacterDeletionReceipt>(await harness.library.delete("character:brammel"));

    const line = harness.logLines.find(entry => entry.operation === "character.delete");
    expect(line).toBeDefined();
    expect(JSON.stringify(harness.logLines)).not.toContain("Brammel");
  });
});
