import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import { SYNTHETIC_CHOICES, SYNTHETIC_EQUIPMENT_CHOICE, SYNTHETIC_IDS, SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild, CharacterRecord } from "@/src/domain/character-record";
import type { CommitResult, DraftSnapshot } from "@/src/services/character-services";

/**
 * Adversarial review of every M2.1 write path.
 *
 * These tests deliberately make a late write fail, or send a stale revision, and
 * assert that nothing partial survives. A green happy path proves nothing about
 * rollback.
 */
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
    [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-watchcraft", "option:proficiency:skill-haulage"],
    [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
  },
  equipmentSelections: { [SYNTHETIC_EQUIPMENT_CHOICE]: ["equipment-option:warden-pack"] },
};

let harness: Harness;
beforeEach(async () => {
  harness = await createHarness();
});
afterEach(closeHarnesses);

async function commitBrammel() {
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({ draftId: "draft:b", rulesetProfileId: SYNTHETIC_RULESET_ID, level: 1, presentation: "guided" }),
  );
  const draft = expectOk<DraftSnapshot>(
    await harness.drafts.update({ draftId: "draft:b", expectedRevision: created.revision, patch: BUILD }),
  );
  return expectOk<CommitResult>(
    await harness.commit.commit({
      operationId: "operation:commit",
      draftId: "draft:b",
      expectedDraftRevision: draft.revision,
      characterId: "character:brammel",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    }),
  );
}

/** Counts every character-owned record, for before/after comparison. */
async function census() {
  const database = harness.database;
  return {
    characters: await database.characters.count(),
    versions: await database.characterVersions.count(),
    snapshots: await database.characterSnapshots.count(),
    runtime: await database.characterRuntimeStates.count(),
    actions: await database.characterActions.count(),
    overrides: await database.characterOverrides.count(),
    derived: await database.characterDerivedSnapshots.count(),
  };
}

/** Occupies a version operation ID so the next append using it throws. */
async function squatVersionOperation(operationId: string, characterId = "character:brammel") {
  await harness.database.characterVersions.add({
    id: `${characterId}@squat:${operationId}`,
    characterId,
    sequence: 9000 + (await harness.database.characterVersions.count()),
    reason: "edit",
    operationId,
    snapshot: (await harness.database.characters.get(characterId)) as CharacterRecord,
    createdAt: "2026-08-03T08:00:00.000Z",
    updatedAt: "2026-08-03T08:00:00.000Z",
  });
}

describe("transaction ownership", () => {
  it("keeps every transaction in the services, never in a repository", () => {
    const repositories = readFileSync("src/storage/character-repositories.ts", "utf8");
    // A repository that opened its own transaction could not be rolled back by
    // the service that called it.
    expect(repositories).not.toContain(".transaction(");
  });
});

describe("commit rollback", () => {
  it("leaves no partial durable state when a late write fails", async () => {
    const before = await census();
    const created = expectOk<DraftSnapshot>(
      await harness.drafts.create({ draftId: "draft:b", rulesetProfileId: SYNTHETIC_RULESET_ID, level: 1, presentation: "guided" }),
    );
    const draft = expectOk<DraftSnapshot>(
      await harness.drafts.update({ draftId: "draft:b", expectedRevision: created.revision, patch: BUILD }),
    );
    // Occupy the version operation ID the commit will use.
    await harness.database.characterVersions.add({
      id: "character:squat@1",
      characterId: "character:squat",
      sequence: 1,
      reason: "edit",
      operationId: "operation:commit",
      snapshot: { ...(BUILD as unknown as CharacterRecord), id: "character:squat", revision: 1 },
      createdAt: "2026-08-03T08:00:00.000Z",
      updatedAt: "2026-08-03T08:00:00.000Z",
    });

    await expect(
      harness.commit.commit({
        operationId: "operation:commit",
        draftId: "draft:b",
        expectedDraftRevision: draft.revision,
        characterId: "character:brammel",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    ).rejects.toThrow();

    const after = await census();
    expect(after.characters).toBe(before.characters);
    expect(after.runtime).toBe(before.runtime);
    expect(after.derived).toBe(before.derived);
    // The draft remains editable.
    expect((await harness.database.characterDrafts.get("draft:b"))?.status).toBe("in-progress");
  });
});

describe("override rollback", () => {
  it("writes neither the override nor a version when the version append fails", async () => {
    await commitBrammel();
    await squatVersionOperation("operation:override");
    const before = await census();

    await expect(
      harness.overrides.set({
        operationId: "operation:override",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "armorClass",
        operation: "replace",
        value: 20,
        scope: "persistent",
      }),
    ).rejects.toThrow();

    const after = await census();
    expect(after.overrides).toBe(before.overrides);
    expect(after.versions).toBe(before.versions);
    expect((await harness.database.characters.get("character:brammel"))?.revision).toBe(1);
  });
});

describe("level-up rollback", () => {
  it("leaves the pre-level aggregate untouched when a late write fails", async () => {
    await commitBrammel();
    await squatVersionOperation("operation:level");
    const before = await census();

    await expect(
      harness.levelUp.confirm({
        operationId: "operation:level",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        expectedRuntimeRevision: 1,
        targetLevel: 2,
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
        choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
      }),
    ).rejects.toThrow();

    const after = await census();
    // No restore point, no new version, no level change, no runtime change.
    expect(after.snapshots).toBe(before.snapshots);
    expect(after.versions).toBe(before.versions);
    expect((await harness.database.characters.get("character:brammel"))?.level).toBe(1);
    expect((await harness.database.characterRuntimeStates.get("character:brammel"))?.revision).toBe(1);
  });
});

describe("duplicate rollback", () => {
  it("creates nothing when a late write fails", async () => {
    await commitBrammel();
    await harness.database.characterVersions.add({
      id: "character:copy@squat",
      characterId: "character:copy",
      sequence: 5000,
      reason: "edit",
      operationId: "operation:duplicate",
      snapshot: (await harness.database.characters.get("character:brammel")) as CharacterRecord,
      createdAt: "2026-08-03T08:00:00.000Z",
      updatedAt: "2026-08-03T08:00:00.000Z",
    });
    const before = await census();

    await expect(
      harness.library.duplicate("character:brammel", "character:copy", "operation:duplicate"),
    ).rejects.toThrow();

    const after = await census();
    expect(after.characters).toBe(before.characters);
    expect(after.runtime).toBe(before.runtime);
    expect(after.overrides).toBe(before.overrides);
    expect(await harness.database.characters.get("character:copy")).toBeUndefined();
  });
});

describe("revision integrity", () => {
  it("never advances a revision on a rejected write", async () => {
    await commitBrammel();
    const attempts = [
      () =>
        harness.overrides.set({
          operationId: "operation:stale-override",
          characterId: "character:brammel",
          expectedCharacterRevision: 99,
          targetPath: "armorClass",
          operation: "replace",
          value: 20,
          scope: "persistent",
        }),
      () =>
        harness.runtime.apply({
          characterId: "character:brammel",
          expectedRuntimeRevision: 99,
          operationId: "operation:stale-runtime",
          operation: { kind: "damage", amount: 1 },
        }),
      () => harness.library.setArchived("character:brammel", 99, true, "operation:stale-archive"),
    ];
    for (const attempt of attempts) expect((await attempt()).status).toBe("stale");

    expect((await harness.database.characters.get("character:brammel"))?.revision).toBe(1);
    expect((await harness.database.characterRuntimeStates.get("character:brammel"))?.revision).toBe(1);
    expect(await harness.database.characterActions.count()).toBe(0);
  });

  it("rejects a replayed runtime operation ID rather than applying it twice", async () => {
    await commitBrammel();
    expectOk(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:replay",
        operation: { kind: "damage", amount: 3 },
      }),
    );
    await expect(
      harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 2,
        operationId: "operation:replay",
        operation: { kind: "damage", amount: 3 },
      }),
    ).rejects.toThrow();

    // The first application stands; the replay changed nothing.
    expect((await harness.database.characterRuntimeStates.get("character:brammel"))?.currentHitPoints).toBe(7);
    expect(await harness.database.characterActions.count()).toBe(1);
  });

  it("rejects a replayed version operation ID across durable paths", async () => {
    await commitBrammel();
    await squatVersionOperation("operation:replayed-version");
    await expect(
      harness.library.setArchived("character:brammel", 1, true, "operation:replayed-version"),
    ).rejects.toThrow();
    expect((await harness.database.characters.get("character:brammel"))?.status).toBe("active");
  });
});

describe("history attribution", () => {
  it("keeps every record owned by the character it belongs to", async () => {
    await commitBrammel();
    expectOk(
      await harness.overrides.set({
        operationId: "operation:override",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "armorClass",
        operation: "replace",
        value: 20,
        scope: "persistent",
      }),
    );
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:damage",
      operation: { kind: "damage", amount: 2 },
    });
    expectOk(await harness.library.duplicate("character:brammel", "character:copy", "operation:duplicate"));

    for (const table of ["characterVersions", "characterActions", "characterOverrides"] as const) {
      const rows = await harness.database[table].toArray();
      for (const row of rows)
        expect(["character:brammel", "character:copy"]).toContain((row as { characterId: string }).characterId);
    }
    // The copy owns its own version and override, and inherits no session log.
    expect(await harness.database.characterVersions.where("characterId").equals("character:copy").count()).toBe(1);
    expect(await harness.database.characterOverrides.where("characterId").equals("character:copy").count()).toBe(1);
    expect(await harness.database.characterActions.where("characterId").equals("character:copy").count()).toBe(0);
  });
});

describe("typed failures stay sanitized", () => {
  it("never echoes a name, note, reason or imported value", async () => {
    await commitBrammel();
    const outcomes: unknown[] = [];
    outcomes.push(
      await harness.overrides.set({
        operationId: "operation:private-1",
        characterId: "character:brammel",
        expectedCharacterRevision: 99,
        targetPath: "armorClass",
        operation: "replace",
        value: 20,
        scope: "persistent",
        reason: "private table ruling",
      }),
    );
    outcomes.push(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 99,
        operationId: "operation:private-2",
        operation: { kind: "damage", amount: 1 },
        note: "private session note",
      }),
    );
    outcomes.push(await harness.transfer.preview('{"kind":"x","secret":"private imported value"}'));
    outcomes.push(await harness.drafts.update({ draftId: "draft:absent", expectedRevision: 1, patch: { name: "Secret Name" } }));

    const serialized = JSON.stringify(outcomes) + JSON.stringify(harness.logLines);
    for (const secret of ["private table ruling", "private session note", "private imported value", "Secret Name", "Brammel"])
      expect(serialized).not.toContain(secret);
  });
});
