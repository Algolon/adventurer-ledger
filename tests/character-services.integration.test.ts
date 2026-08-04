import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  SYNTHETIC_CHOICES,
  SYNTHETIC_EQUIPMENT_CHOICE,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild, CharacterRuntimeStateRecord } from "@/src/domain/character-record";
import { migrateLegacyCharacter } from "@/src/migrations/character-m2-1";
import type { CommitResult, DraftSnapshot } from "@/src/services/character-services";
import type { LevelUpPreview, LevelUpResult } from "@/src/services/levelup-service";
import type { RuntimeResult } from "@/src/services/runtime-service";
import type { ImportReceipt, TransferPreview } from "@/src/services/transfer-service";

const BRAMMEL_BUILD: Partial<CharacterDraftBuild> = {
  name: "Brammel Voss",
  nickname: "Boss",
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

async function newDraft(presentation: "guided" | "flexible" = "guided") {
  return expectOk<DraftSnapshot>(
    await harness.drafts.create({
      draftId: "draft:brammel",
      rulesetProfileId: SYNTHETIC_RULESET_ID,
      level: 1,
      presentation,
    }),
  );
}

async function completeDraft(presentation: "guided" | "flexible" = "guided") {
  const created = await newDraft(presentation);
  return expectOk<DraftSnapshot>(
    await harness.drafts.update({
      draftId: created.draft.id,
      expectedRevision: created.revision,
      patch: BRAMMEL_BUILD,
      lastStepId: "review",
    }),
  );
}

async function commitBrammel(presentation: "guided" | "flexible" = "guided") {
  const draft = await completeDraft(presentation);
  const fingerprint = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
  const result = expectOk<CommitResult>(
    await harness.commit.commit({
      operationId: "operation:commit-1",
      draftId: draft.draft.id,
      expectedDraftRevision: draft.revision,
      characterId: "character:brammel",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: fingerprint,
    }),
  );
  return { draft, result, fingerprint };
}

describe("CharacterDraftService", () => {
  it("persists a draft and returns a save receipt with the next revision", async () => {
    const created = await newDraft();
    expect(created.draft.revision).toBe(1);
    expect(created.draft.status).toBe("in-progress");
    // No class is chosen yet, so no spell choices apply and that step is not in
    // the sequence. It appears if and when a spell-capable class is selected.
    expect(created.plan.steps.map(step => step.id)).toEqual([
      "start", "class", "origin", "abilities", "class-choices", "equipment", "identity", "review",
    ]);
    expect(created.plan.systemSummaries.find(summary => summary.id === "spellcasting")?.applicable).toBe(false);
    expect(created.plan.nextUnresolvedStepId).toBe("class");
  });

  it("autosaves an accepted choice and resumes it after a fresh read", async () => {
    const created = await newDraft();
    const saved = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: created.draft.id,
        expectedRevision: created.revision,
        patch: { classId: SYNTHETIC_IDS.class },
        lastStepId: "class",
      }),
    );
    expect(saved.revision).toBe(2);

    const resumed = await harness.drafts.get(created.draft.id);
    expect(resumed?.draft.build.classId).toBe(SYNTHETIC_IDS.class);
    expect(resumed?.draft.lastStepId).toBe("class");
    expect(resumed?.plan.nextUnresolvedStepId).toBe("origin");
  });

  it("rejects a stale revision as a typed outcome and performs no write", async () => {
    const created = await newDraft();
    await harness.drafts.update({ draftId: created.draft.id, expectedRevision: 1, patch: { name: "First" } });
    const outcome = await harness.drafts.update({ draftId: created.draft.id, expectedRevision: 1, patch: { name: "Second" } });

    expect(outcome.status).toBe("stale");
    if (outcome.status === "stale") {
      expect(outcome.expectedRevision).toBe(1);
      expect(outcome.actualRevision).toBe(2);
    }
    const stored = await harness.drafts.get(created.draft.id);
    expect(stored?.draft.build.name).toBe("First");
    expect(stored?.revision).toBe(2);
  });

  it("returns a typed not-found outcome for an unknown draft", async () => {
    const outcome = await harness.drafts.update({ draftId: "draft:absent", expectedRevision: 1, patch: {} });
    expect(outcome.status).toBe("not-found");
  });

  it("keeps every saved value and the same draft ID when the presentation mode changes", async () => {
    const draft = await completeDraft("guided");
    const switched = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(draft.draft.id, draft.revision, "flexible"),
    );

    expect(switched.draft.id).toBe(draft.draft.id);
    expect(switched.draft.presentation).toBe("flexible");
    expect(switched.draft.build).toEqual(draft.draft.build);
    expect(switched.revision).toBe(draft.revision + 1);

    const back = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(switched.draft.id, switched.revision, "guided"),
    );
    expect(back.draft.build).toEqual(draft.draft.build);
  });

  it("marks a draft abandoned without deleting it", async () => {
    const created = await newDraft();
    expect((await harness.drafts.abandon(created.draft.id, created.revision)).status).toBe("ok");
    expect(await harness.database.characterDrafts.get(created.draft.id)).toBeDefined();
    expect(await harness.drafts.list()).toHaveLength(0);
  });

  it("excludes names and manual values from operational log lines", async () => {
    await completeDraft();
    const serialized = JSON.stringify(harness.logLines);
    expect(serialized).not.toContain("Brammel");
    expect(serialized).not.toContain("Boss");
    expect(harness.logLines.every(line => typeof line.operation === "string")).toBe(true);
  });
});

describe("CharacterBuildCommitService", () => {
  it("creates the character, version 1 and runtime state in one transaction", async () => {
    const { result } = await commitBrammel();

    expect(result.characterRevision).toBe(1);
    expect(result.runtimeRevision).toBe(1);
    const versions = await harness.database.characterVersions.where("characterId").equals("character:brammel").toArray();
    expect(versions).toHaveLength(1);
    expect(versions[0].sequence).toBe(1);
    expect(versions[0].reason).toBe("initial");
    const runtime = await harness.database.characterRuntimeStates.get("character:brammel");
    expect(runtime?.currentHitPoints).toBe(10);
    expect(runtime?.resourceUses[SYNTHETIC_IDS.resource]).toBe(3);
    // Initial creation does not create a redundant restore point.
    expect(await harness.database.characterSnapshots.count()).toBe(0);
    expect((await harness.database.characterDrafts.get("draft:brammel"))?.status).toBe("committed");
  });

  it("rejects a commit whose reviewed content fingerprint no longer matches", async () => {
    const draft = await completeDraft();
    const outcome = await harness.commit.commit({
      operationId: "operation:stale",
      draftId: draft.draft.id,
      expectedDraftRevision: draft.revision,
      characterId: "character:brammel",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: "fp1:0:deadbeef",
    });

    expect(outcome.status).toBe("conflict");
    if (outcome.status === "conflict") expect(outcome.code).toBe("STALE_PREVIEW");
    // No partial durable state exists and the draft remains editable.
    expect(await harness.database.characters.count()).toBe(0);
    expect(await harness.database.characterVersions.count()).toBe(0);
    expect(await harness.database.characterRuntimeStates.count()).toBe(0);
    expect((await harness.database.characterDrafts.get(draft.draft.id))?.status).toBe("in-progress");
  });

  it("refuses a guided commit with unresolved blocking issues and writes nothing", async () => {
    const created = await newDraft("guided");
    const partial = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: created.draft.id,
        expectedRevision: created.revision,
        patch: { ...BRAMMEL_BUILD, classId: undefined },
      }),
    );
    const outcome = await harness.commit.commit({
      operationId: "operation:blocked",
      draftId: partial.draft.id,
      expectedDraftRevision: partial.revision,
      characterId: "character:brammel",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    });

    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues.some(issue => issue.code === "CLASS_NOT_CHOSEN")).toBe(true);
    expect(await harness.database.characters.count()).toBe(0);
  });

  it("rejects a stale draft revision without writing", async () => {
    const draft = await completeDraft();
    const outcome = await harness.commit.commit({
      operationId: "operation:stale-draft",
      draftId: draft.draft.id,
      expectedDraftRevision: draft.revision - 1,
      characterId: "character:brammel",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    });
    expect(outcome.status).toBe("stale");
    expect(await harness.database.characters.count()).toBe(0);
  });

  it("refuses a second first commit for the same character ID", async () => {
    await commitBrammel();
    const second = await completeDraftWithId("draft:brammel-2");
    const outcome = await harness.commit.commit({
      operationId: "operation:duplicate",
      draftId: second.draft.id,
      expectedDraftRevision: second.revision,
      characterId: "character:brammel",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    });
    expect(outcome.status).toBe("conflict");
    if (outcome.status === "conflict") expect(outcome.code).toBe("CHARACTER_ALREADY_EXISTS");
  });

  async function completeDraftWithId(draftId: string) {
    const created = expectOk<DraftSnapshot>(
      await harness.drafts.create({ draftId, rulesetProfileId: SYNTHETIC_RULESET_ID, level: 1, presentation: "guided" }),
    );
    return expectOk<DraftSnapshot>(
      await harness.drafts.update({ draftId, expectedRevision: created.revision, patch: BRAMMEL_BUILD }),
    );
  }
});

describe("CharacterQueryService", () => {
  it("reports a genuinely empty library before anything is created", async () => {
    const library = await harness.query.library();
    expect(library.characters).toHaveLength(0);
    expect(library.drafts).toHaveLength(0);
  });

  it("lists an incomplete draft with its issue count and resume step", async () => {
    const created = await newDraft();
    await harness.drafts.update({ draftId: created.draft.id, expectedRevision: 1, patch: { classId: SYNTHETIC_IDS.class } });
    const library = await harness.query.library();

    expect(library.characters).toHaveLength(0);
    expect(library.drafts).toHaveLength(1);
    expect(library.drafts[0].issueCount).toBeGreaterThan(0);
    expect(library.drafts[0].resumeStepId).toBe("origin");
    expect(library.drafts[0].name).toBe("Unnamed character");
  });

  it("lists a committed character whose primary destination is the sheet", async () => {
    await commitBrammel();
    const library = await harness.query.library();

    expect(library.characters).toHaveLength(1);
    expect(library.characters[0]).toMatchObject({
      characterId: "character:brammel",
      name: "Brammel Voss",
      level: 1,
      classLabel: "Vanguard",
      state: "automatic",
      primaryDestination: "sheet",
    });
    // The committed draft no longer shows as resumable work.
    expect(library.drafts).toHaveLength(0);
  });

  it("resolves the committed sheet through the resolver", async () => {
    await commitBrammel();
    const sheet = await harness.query.sheet("character:brammel");
    expect(sheet?.armorClass.value).toBe(18);
    expect(sheet?.hitPoints.maximum.value).toBe(10);
    expect(sheet?.actions[0].attackExpression).toBe("1d20 + 5");
    expect(sheet?.completeness).toBe("guided-complete");
  });
});

describe("CharacterRuntimeService", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  it("applies damage as one runtime mutation plus one action entry", async () => {
    const result = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:damage-1",
        operation: { kind: "damage", amount: 5 },
      }),
    );

    expect(result.runtime.currentHitPoints).toBe(5);
    expect(result.runtime.revision).toBe(2);
    expect(result.undoable).toBe(true);
    const actions = await harness.database.characterActions.where("characterId").equals("character:brammel").toArray();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "damage", delta: -5, resultingRuntimeRevision: 2 });
    // A runtime action never creates a durable character version.
    expect(await harness.database.characterVersions.count()).toBe(1);
    expect((await harness.database.characters.get("character:brammel"))?.revision).toBe(1);
  });

  it("clamps damage and healing to the valid range with a sanitized warning", async () => {
    const overkill = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:overkill",
        operation: { kind: "damage", amount: 99 },
      }),
    );
    expect(overkill.runtime.currentHitPoints).toBe(0);
    expect(overkill.warnings.map(warning => warning.code)).toContain("HIT_POINTS_CLAMPED");

    const overheal = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 2,
        operationId: "operation:overheal",
        operation: { kind: "heal", amount: 99 },
      }),
    );
    expect(overheal.runtime.currentHitPoints).toBe(10);
  });

  it("absorbs damage with temporary hit points before current hit points", async () => {
    const temporary = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:temp",
        operation: { kind: "temporary-hit-points", amount: 4 },
      }),
    );
    expect(temporary.runtime.temporaryHitPoints).toBe(4);

    const hit = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 2,
        operationId: "operation:temp-damage",
        operation: { kind: "damage", amount: 6 },
      }),
    );
    expect(hit.runtime.temporaryHitPoints).toBe(0);
    expect(hit.runtime.currentHitPoints).toBe(8);
  });

  it("cannot silently exceed a resource's bounds", async () => {
    const spent = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:spend",
        operation: { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 2 },
      }),
    );
    expect(spent.runtime.resourceUses[SYNTHETIC_IDS.resource]).toBe(1);

    const overspend = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 2,
        operationId: "operation:overspend",
        operation: { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 9 },
      }),
    );
    expect(overspend.runtime.resourceUses[SYNTHETIC_IDS.resource]).toBe(0);
    expect(overspend.warnings.map(warning => warning.code)).toContain("RESOURCE_BOUNDS_CLAMPED");
  });

  it("restores short-rest resources on a short rest without healing", async () => {
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:pre-rest-damage",
      operation: { kind: "damage", amount: 4 },
    });
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 2,
      operationId: "operation:pre-rest-spend",
      operation: { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 3 },
    });
    const rested = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 3,
        operationId: "operation:short-rest",
        operation: { kind: "short-rest" },
      }),
    );
    expect(rested.runtime.resourceUses[SYNTHETIC_IDS.resource]).toBe(3);
    expect(rested.runtime.currentHitPoints).toBe(6);
  });

  it("adds and removes a condition idempotently", async () => {
    const added = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:condition-add",
        operation: { kind: "condition-add", conditionId: "condition:winded" },
      }),
    );
    expect(added.runtime.conditions.map(item => item.conditionId)).toEqual(["condition:winded"]);

    const removed = expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 2,
        operationId: "operation:condition-remove",
        operation: { kind: "condition-remove", conditionId: "condition:winded" },
      }),
    );
    expect(removed.runtime.conditions).toHaveLength(0);
  });

  it("undoes the last reversible action by appending history, never deleting it", async () => {
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:damage",
      operation: { kind: "damage", amount: 6 },
    });
    const undone = expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 2, "operation:undo"));

    expect(undone.runtime.currentHitPoints).toBe(10);
    const actions = await harness.database.characterActions.where("characterId").equals("character:brammel").sortBy("sequence");
    expect(actions).toHaveLength(2);
    expect(actions[1].kind).toBe("undo");
    expect(actions[1].reversesActionId).toBe(actions[0].id);
    // The reversed action is retained but no longer offered for undo.
    expect(actions[0].reversible).toBe(false);
    expect((await harness.runtime.undoLast("character:brammel", 3, "operation:undo-2")).status).toBe("invalid");
  });

  it("rejects a stale runtime revision and leaves runtime and log untouched", async () => {
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:first",
      operation: { kind: "damage", amount: 3 },
    });
    const outcome = await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:stale",
      operation: { kind: "damage", amount: 3 },
    });

    expect(outcome.status).toBe("stale");
    const runtime = await harness.database.characterRuntimeStates.get("character:brammel");
    expect(runtime?.currentHitPoints).toBe(7);
    expect(await harness.database.characterActions.count()).toBe(1);
  });

  it("rolls back the runtime write when the action append fails", async () => {
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:reused",
      operation: { kind: "damage", amount: 2 },
    });
    // Re-using an operation ID makes the log append reject; the paired runtime
    // write must roll back with it.
    await expect(
      harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 2,
        operationId: "operation:reused",
        operation: { kind: "damage", amount: 2 },
      }),
    ).rejects.toThrow();

    const runtime = await harness.database.characterRuntimeStates.get("character:brammel");
    expect(runtime?.revision).toBe(2);
    expect(runtime?.currentHitPoints).toBe(8);
    expect(await harness.database.characterActions.count()).toBe(1);
  });

  it("keeps a private action note out of history summaries", async () => {
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:noted",
      operation: { kind: "damage", amount: 1 },
      note: "private table note",
    });
    const history = await harness.query.history("character:brammel");
    expect(history.actions[0].hasNote).toBe(true);
    expect(JSON.stringify(history)).not.toContain("private table note");
    expect(JSON.stringify(harness.logLines)).not.toContain("private table note");
  });
});

describe("CharacterLevelUpService", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  it("previews the documented preserve-deficit demonstration without writing", async () => {
    // Spend down to 5/10 hit points and 1/3 uses first.
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:hp",
      operation: { kind: "damage", amount: 5 },
    });
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 2,
      operationId: "operation:uses",
      operation: { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 2 },
    });

    const preview = expectOk<LevelUpPreview>(
      await harness.levelUp.preview("character:brammel", { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] }),
    );

    expect(preview.fromLevel).toBe(1);
    expect(preview.toLevel).toBe(2);
    expect(preview.policyId).toBe("preserve-deficit-expenditure");
    // 5 / 10 with a +2 maximum becomes 7 / 12.
    expect(preview.hitPoints).toMatchObject({ beforeCurrent: 5, beforeMaximum: 10, afterMaximum: 12, maximumDelta: 2, proposedCurrent: 7 });
    // 1 / 3 uses with a +1 maximum becomes 2 / 4.
    expect(preview.resources[0]).toMatchObject({ beforeCurrent: 1, beforeMaximum: 3, afterMaximum: 4, maximumDelta: 1, proposedCurrent: 2 });
    // Only the newly required choice is offered.
    expect(preview.newChoices.map(choice => choice.choiceId)).toEqual([SYNTHETIC_CHOICES.weaponMastery]);

    // Preview is read-only.
    expect((await harness.database.characters.get("character:brammel"))?.level).toBe(1);
    expect(await harness.database.characterSnapshots.count()).toBe(0);
    expect(await harness.database.characterVersions.count()).toBe(1);
  });

  it("commits level, choices, version, restore point and runtime atomically", async () => {
    const fingerprint = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
    const result = expectOk<LevelUpResult>(
      await harness.levelUp.confirm({
        operationId: "operation:level-2",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        expectedRuntimeRevision: 1,
        targetLevel: 2,
        expectedContentFingerprint: fingerprint,
        choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
      }),
    );

    expect(result.toLevel).toBe(2);
    const character = await harness.database.characters.get("character:brammel");
    expect(character?.level).toBe(2);
    expect(character?.classLevels[0].level).toBe(2);
    expect(character?.revision).toBe(2);

    const snapshots = await harness.database.characterSnapshots.toArray();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].kind).toBe("pre-level");
    expect(snapshots[0].label).toBe("Before level 2");
    expect(snapshots[0].runtimeState.currentHitPoints).toBe(10);

    const sheet = await harness.query.sheet("character:brammel");
    expect(sheet?.hitPoints.maximum.value).toBe(12);
    expect(sheet?.resources[0].maximum.value).toBe(4);
    const runtime = await harness.database.characterRuntimeStates.get("character:brammel");
    expect(runtime?.currentHitPoints).toBe(12);
    expect(runtime?.resourceUses[SYNTHETIC_IDS.resource]).toBe(4);
  });

  it("refuses to confirm while a newly required choice is unresolved", async () => {
    const outcome = await harness.levelUp.confirm({
      operationId: "operation:level-2-blocked",
      characterId: "character:brammel",
      expectedCharacterRevision: 1,
      expectedRuntimeRevision: 1,
      targetLevel: 2,
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      choiceSelections: {},
    });

    expect(outcome.status).toBe("invalid");
    expect((await harness.database.characters.get("character:brammel"))?.level).toBe(1);
    expect(await harness.database.characterSnapshots.count()).toBe(0);
  });

  it("refuses a level step other than exactly one", async () => {
    const outcome = await harness.levelUp.confirm({
      operationId: "operation:level-3",
      characterId: "character:brammel",
      expectedCharacterRevision: 1,
      expectedRuntimeRevision: 1,
      targetLevel: 3,
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      choiceSelections: {},
    });
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues[0].code).toBe("LEVEL_STEP_UNSUPPORTED");
  });

  it("rejects a stale character or runtime revision and leaves level 1 unchanged", async () => {
    const fingerprint = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
    const staleCharacter = await harness.levelUp.confirm({
      operationId: "operation:stale-character",
      characterId: "character:brammel",
      expectedCharacterRevision: 99,
      expectedRuntimeRevision: 1,
      targetLevel: 2,
      expectedContentFingerprint: fingerprint,
      choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
    });
    expect(staleCharacter.status).toBe("stale");

    const staleRuntime = await harness.levelUp.confirm({
      operationId: "operation:stale-runtime",
      characterId: "character:brammel",
      expectedCharacterRevision: 1,
      expectedRuntimeRevision: 99,
      targetLevel: 2,
      expectedContentFingerprint: fingerprint,
      choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
    });
    expect(staleRuntime.status).toBe("stale");

    expect((await harness.database.characters.get("character:brammel"))?.level).toBe(1);
    expect(await harness.database.characterSnapshots.count()).toBe(0);
    expect(await harness.database.characterVersions.count()).toBe(1);
  });

  it("restores the pre-level snapshot without deleting the level-up history", async () => {
    const fingerprint = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
    const levelled = expectOk<LevelUpResult>(
      await harness.levelUp.confirm({
        operationId: "operation:level-2",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        expectedRuntimeRevision: 1,
        targetLevel: 2,
        expectedContentFingerprint: fingerprint,
        choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
      }),
    );
    const versionsAfterLevelUp = await harness.database.characterVersions.count();

    const restored = expectOk<LevelUpResult>(
      await harness.levelUp.restore("character:brammel", levelled.restorePointId, levelled.characterRevision, "operation:restore"),
    );

    expect(restored.toLevel).toBe(1);
    const character = await harness.database.characters.get("character:brammel");
    expect(character?.level).toBe(1);
    const runtime = await harness.database.characterRuntimeStates.get("character:brammel");
    expect(runtime?.currentHitPoints).toBe(10);
    // History grew; nothing was removed.
    expect(await harness.database.characterVersions.count()).toBe(versionsAfterLevelUp + 1);
    expect(await harness.database.characterSnapshots.count()).toBe(1);
  });
});

describe("CharacterTransferService", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  async function exportBrammel() {
    const outcome = await harness.transfer.createTransfer("character:brammel");
    return expectOk<{ json: string; manifest: { characterFingerprint: string } }>(outcome);
  }

  it("exports a safe artifact with a manifest, fingerprint and dependency metadata", async () => {
    const { json, manifest } = await exportBrammel();

    expect(manifest).toMatchObject({ characterId: "character:brammel", level: 1, classLabel: "Vanguard", restricted: false, formatVersion: 1 });
    expect(manifest.characterFingerprint).toMatch(/^cfp2:/);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe("runefolio-character-transfer");
    expect(parsed.dependencies.length).toBeGreaterThan(0);
    expect(parsed.derivedSummary.armorClass).toBe("18");
  });

  it("excludes private full text, override reasons and action notes from the file", async () => {
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:noted",
      operation: { kind: "damage", amount: 1 },
      note: "private session note",
    });
    await harness.database.characterOverrides.put({
      id: "override:1",
      characterId: "character:brammel",
      targetPath: "armorClass",
      operation: "add",
      value: 1,
      automaticBaseline: 18,
      scope: "persistent",
      status: "active",
      reason: "private table ruling",
      createdAt: "2026-08-03T08:00:00.000Z",
      updatedAt: "2026-08-03T08:00:00.000Z",
    });

    const { json } = await exportBrammel();
    expect(json).not.toContain("private session note");
    expect(json).not.toContain("private table ruling");
    const exclusions = JSON.parse(json).exclusions as { code: string; count: number }[];
    expect(exclusions.find(item => item.code === "ACTION_LOG_NOTES")?.count).toBe(1);
    expect(exclusions.find(item => item.code === "OVERRIDE_REASON")?.count).toBe(1);
  });

  it("refuses a standard transfer that would embed a restricted entry", async () => {
    await harness.database.contentEntries
      .where("id")
      .equals(SYNTHETIC_IDS.class)
      .modify(entry => {
        entry.exportRestricted = true;
      });
    const outcome = await harness.transfer.createTransfer("character:brammel");
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid")
      expect(outcome.issues[0].code).toBe("RESTRICTED_ENTRY_EXCLUDED_FROM_STANDARD_TRANSFER");
  });

  it("previews an unknown file without mutating anything", async () => {
    const { json } = await exportBrammel();
    await harness.database.characters.clear();
    await harness.database.characterRuntimeStates.clear();

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    expect(preview.category).toBe("new");
    expect(preview.availableActions).toEqual(["import"]);
    expect(preview.manifest.name).toBe("Brammel Voss");
    expect(await harness.database.characters.count()).toBe(0);
  });

  it("reports Already current for an identical ID and fingerprint", async () => {
    const { json } = await exportBrammel();
    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    expect(preview.category).toBe("already-current");
    expect(preview.availableActions).toHaveLength(0);

    const outcome = await harness.transfer.confirm(preview.token, "import", "operation:already");
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues[0].code).toBe("ALREADY_CURRENT");
  });

  it("offers Keep both and Replace for the same ID with a different fingerprint", async () => {
    const { json } = await exportBrammel();
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:diverge",
      operation: { kind: "damage", amount: 3 },
    });
    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
      record.revision = 2;
    });

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    expect(preview.category).toBe("conflict");
    expect(preview.availableActions).toEqual(["keep-both", "replace"]);
  });

  it("keeps both by remapping the character ID and marking the copy", async () => {
    const { json } = await exportBrammel();
    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
      record.revision = 2;
    });
    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    const receipt = expectOk<ImportReceipt>(await harness.transfer.confirm(preview.token, "keep-both", "operation:keep"));

    expect(receipt.characterId).not.toBe("character:brammel");
    expect(await harness.database.characters.count()).toBe(2);
    const imported = await harness.database.characters.get(receipt.characterId);
    expect(imported?.name).toBe("Brammel Voss (Imported copy)");
    // The local record is untouched.
    expect((await harness.database.characters.get("character:brammel"))?.name).toBe("Locally renamed");
  });

  it("replaces the local record only after versioning it and taking a restore point", async () => {
    const { json } = await exportBrammel();
    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
      record.revision = 2;
    });
    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    const receipt = expectOk<ImportReceipt>(await harness.transfer.confirm(preview.token, "replace", "operation:replace", 2));

    expect(receipt.restorePointId).toBeDefined();
    const snapshot = await harness.database.characterSnapshots.get(receipt.restorePointId!);
    expect(snapshot?.kind).toBe("pre-import-replace");
    const version = await harness.database.characterVersions.get(snapshot!.characterVersionId);
    expect(version?.snapshot.name).toBe("Locally renamed");
    expect((await harness.database.characters.get("character:brammel"))?.name).toBe("Brammel Voss");
    expect(await harness.database.characters.count()).toBe(1);
  });

  it("rejects Replace against a stale destination revision without writing", async () => {
    const { json } = await exportBrammel();
    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
      record.revision = 2;
    });
    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    const outcome = await harness.transfer.confirm(preview.token, "replace", "operation:replace-stale", 1);

    expect(outcome.status).toBe("stale");
    expect((await harness.database.characters.get("character:brammel"))?.name).toBe("Locally renamed");
    expect(await harness.database.characterSnapshots.count()).toBe(0);
  });

  it("cancelling leaves local records unchanged because nothing is written before confirm", async () => {
    const { json } = await exportBrammel();
    const before = await harness.database.characters.toArray();
    expectOk<TransferPreview>(await harness.transfer.preview(json));
    // Cancel is simply not calling confirm.
    expect(await harness.database.characters.toArray()).toEqual(before);
  });

  it("reports missing dependencies without substituting a nearest match", async () => {
    const { json } = await exportBrammel();
    await harness.database.characters.clear();
    await harness.database.contentEntries.delete(SYNTHETIC_IDS.class);

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    expect(preview.manifest.missingDependencyIds).toContain(SYNTHETIC_IDS.class);
    const receipt = expectOk<ImportReceipt>(await harness.transfer.confirm(preview.token, "import", "operation:import-missing"));
    expect(receipt.unresolvedDependencyIds).toContain(SYNTHETIC_IDS.class);
    const snapshot = await harness.database.characterDerivedSnapshots.get("character:brammel");
    expect(snapshot?.confidence).toBe("uncertain");
  });

  it("rejects malformed, oversized, unsafe and forbidden-key payloads by code alone", async () => {
    const cases: [string, string][] = [
      ["not json", "TRANSFER_NOT_JSON"],
      [JSON.stringify({ formatVersion: 1 }), "TRANSFER_SHAPE_INVALID"],
      [JSON.stringify({ kind: "runefolio-character-transfer", note: "<script>alert(1)</script>" }), "TRANSFER_UNSAFE_STRUCTURE"],
      [`{"a":{"__proto__":{"polluted":true}}}`, "TRANSFER_UNSAFE_STRUCTURE"],
    ];
    for (const [payload, code] of cases) {
      const outcome = await harness.transfer.preview(payload);
      expect(outcome.status).toBe("invalid");
      if (outcome.status === "invalid") expect(outcome.issues.some(issue => issue.code === code)).toBe(true);
    }
    // A rejected payload never reaches the database.
    expect(await harness.database.characters.count()).toBe(1);
  });
});

describe("CharacterOverrideService", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  it("records a replace override with the recalculated automatic baseline and a new version", async () => {
    const result = expectOk<{ overrideId: string; characterRevision: number; automaticBaseline: number | null }>(
      await harness.overrides.set({
        operationId: "operation:override-ac",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "armorClass",
        operation: "replace",
        value: 20,
        scope: "persistent",
        reason: "private table ruling",
      }),
    );

    // The baseline is recalculated, not taken from the caller.
    expect(result.automaticBaseline).toBe(18);
    expect(result.characterRevision).toBe(2);
    const sheet = await harness.query.sheet("character:brammel");
    expect(sheet?.armorClass.value).toBe(20);
    expect(sheet?.armorClass.override).toEqual({ operation: "replace", value: 20, automaticBaseline: 18, stale: false });

    // The outgoing record was versioned before the durable edit.
    const versions = await harness.database.characterVersions.where("characterId").equals("character:brammel").sortBy("sequence");
    expect(versions).toHaveLength(2);
    expect(versions[1].reason).toBe("override");
    expect(versions[1].snapshot.revision).toBe(1);
  });

  it("applies a numeric add override on top of the automatic baseline", async () => {
    expectOk(
      await harness.overrides.set({
        operationId: "operation:override-add",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "armorClass",
        operation: "add",
        value: 2,
        scope: "persistent",
      }),
    );
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(20);
  });

  it("rejects a target outside the allow-list without writing", async () => {
    const outcome = await harness.overrides.set({
      operationId: "operation:override-bad-path",
      characterId: "character:brammel",
      expectedCharacterRevision: 1,
      targetPath: "biography.backstory",
      operation: "replace",
      value: 1,
      scope: "persistent",
    });
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") expect(outcome.issues[0].code).toBe("OVERRIDE_TARGET_NOT_ALLOWED");
    expect(await harness.database.characterOverrides.count()).toBe(0);
    expect((await harness.database.characters.get("character:brammel"))?.revision).toBe(1);
  });

  it("rejects a non-numeric or non-typed operation without evaluating it", async () => {
    for (const command of [
      { targetPath: "armorClass", operation: "multiply" as never, value: 2 },
      { targetPath: "armorClass", operation: "replace" as const, value: Number.NaN },
    ]) {
      const outcome = await harness.overrides.set({
        operationId: `operation:override-${String(command.operation)}-${String(command.value)}`,
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        scope: "persistent",
        ...command,
      });
      expect(outcome.status).toBe("invalid");
    }
    expect(await harness.database.characterOverrides.count()).toBe(0);
  });

  it("rejects a stale character revision and writes nothing", async () => {
    const outcome = await harness.overrides.set({
      operationId: "operation:override-stale",
      characterId: "character:brammel",
      expectedCharacterRevision: 99,
      targetPath: "armorClass",
      operation: "replace",
      value: 20,
      scope: "persistent",
    });
    expect(outcome.status).toBe("stale");
    expect(await harness.database.characterOverrides.count()).toBe(0);
    expect(await harness.database.characterVersions.count()).toBe(1);
  });

  it("keeps an override visible for review when upstream choices move the baseline", async () => {
    expectOk(
      await harness.overrides.set({
        operationId: "operation:override-hp",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "hitPoints.maximum",
        operation: "replace",
        value: 15,
        scope: "persistent",
      }),
    );
    // Levelling up moves the automatic maximum from 10 to 12.
    expectOk(
      await harness.levelUp.confirm({
        operationId: "operation:override-levelup",
        characterId: "character:brammel",
        expectedCharacterRevision: 2,
        expectedRuntimeRevision: 1,
        targetLevel: 2,
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
        choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
      }),
    );

    const sheet = await harness.query.sheet("character:brammel");
    // The override is still applied and still visible, but flagged for review.
    expect(sheet?.hitPoints.maximum.value).toBe(15);
    expect(sheet?.hitPoints.maximum.override?.stale).toBe(true);
    expect(await harness.database.characterOverrides.count()).toBe(1);
  });

  it("removes an override and returns the value to its automatic result", async () => {
    const created = expectOk<{ overrideId: string; characterRevision: number }>(
      await harness.overrides.set({
        operationId: "operation:override-remove-setup",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "armorClass",
        operation: "replace",
        value: 20,
        scope: "persistent",
      }),
    );
    const removed = expectOk<{ automaticBaseline: number | null }>(
      await harness.overrides.remove("character:brammel", created.overrideId, created.characterRevision, "operation:override-remove"),
    );

    expect(removed.automaticBaseline).toBe(18);
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(18);
    expect(await harness.database.characterOverrides.count()).toBe(0);
    // Removal is versioned like any other durable edit.
    expect(await harness.database.characterVersions.count()).toBe(3);
  });

  it("keeps a private override reason out of logs and transfers", async () => {
    expectOk(
      await harness.overrides.set({
        operationId: "operation:override-private",
        characterId: "character:brammel",
        expectedCharacterRevision: 1,
        targetPath: "armorClass",
        operation: "replace",
        value: 20,
        scope: "persistent",
        reason: "private table ruling",
      }),
    );
    expect(JSON.stringify(harness.logLines)).not.toContain("private table ruling");
    const exported = expectOk<{ json: string }>(await harness.transfer.createTransfer("character:brammel"));
    expect(exported.json).not.toContain("private table ruling");
  });
});

describe("exact runtime undo", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  const runtimeOf = () => harness.database.characterRuntimeStates.get("character:brammel");
  const apply = (revision: number, operation: Parameters<Harness["runtime"]["apply"]>[0]["operation"], operationId: string) =>
    harness.runtime.apply({ characterId: "character:brammel", expectedRuntimeRevision: revision, operationId, operation });

  it("restores temporary hit points that absorbed damage", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "temporary-hit-points", amount: 4 }, "operation:temp"));
    expectOk<RuntimeResult>(await apply(2, { kind: "damage", amount: 6 }, "operation:hit"));
    expect(await runtimeOf()).toMatchObject({ currentHitPoints: 8, temporaryHitPoints: 0 });

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 3, "operation:undo"));
    // Healing six would leave temporary hit points at zero; the exact prior
    // values must come back instead.
    expect(await runtimeOf()).toMatchObject({ currentHitPoints: 10, temporaryHitPoints: 4 });
  });

  it("restores the pre-heal value when healing was clamped at the maximum", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 1 }, "operation:scratch"));
    expectOk<RuntimeResult>(await apply(2, { kind: "heal", amount: 5 }, "operation:overheal"));
    expect((await runtimeOf())?.currentHitPoints).toBe(10);

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 3, "operation:undo"));
    // Applying five damage would land on 5; the stored prior value is 9.
    expect((await runtimeOf())?.currentHitPoints).toBe(9);
  });

  it("restores the pre-damage value when damage was clamped at zero", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 99 }, "operation:overkill"));
    expect((await runtimeOf())?.currentHitPoints).toBe(0);
    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 2, "operation:undo"));
    expect((await runtimeOf())?.currentHitPoints).toBe(10);
  });

  it("restores exact resource uses when a spend was clamped", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 9 }, "operation:overspend"));
    expect((await runtimeOf())?.resourceUses[SYNTHETIC_IDS.resource]).toBe(0);
    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 2, "operation:undo"));
    expect((await runtimeOf())?.resourceUses[SYNTHETIC_IDS.resource]).toBe(3);
  });

  it("restores an explicit full value rather than deleting the key", async () => {
    // The seeded runtime already holds an explicit 3, which is the canonical
    // prior representation here and must survive the round trip as a value.
    expect((await runtimeOf())?.resourceUses[SYNTHETIC_IDS.resource]).toBe(3);
    expectOk<RuntimeResult>(await apply(1, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 1 }, "operation:spend"));
    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 2, "operation:undo"));

    const restored = await runtimeOf();
    expect(restored?.resourceUses[SYNTHETIC_IDS.resource]).toBe(3);
    expect(SYNTHETIC_IDS.resource in restored!.resourceUses).toBe(true);
  });

  it("restores exactly 1 when a spend of 5 was clamped from 1", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 2 }, "operation:down-to-one"));
    expect((await runtimeOf())?.resourceUses[SYNTHETIC_IDS.resource]).toBe(1);

    expectOk<RuntimeResult>(await apply(2, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 5 }, "operation:overspend"));
    expect((await runtimeOf())?.resourceUses[SYNTHETIC_IDS.resource]).toBe(0);

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 3, "operation:undo"));
    // Adding back five would land at 5; the stored prior value is 1.
    expect((await runtimeOf())?.resourceUses[SYNTHETIC_IDS.resource]).toBe(1);
  });

  describe("a resource key that is absent before the action", () => {
    /** Absence is what the v4->v5 migration writes and the resolver reads as full. */
    const clearResourceMap = async () => {
      const seeded = await runtimeOf();
      await harness.database.characterRuntimeStates.put({ ...seeded!, resourceUses: {} });
      return (await runtimeOf())!;
    };

    it("is the state the v4 to v5 migration produces", () => {
      const { runtime } = migrateLegacyCharacter({ id: "character:legacy", name: "Legacy", level: 2, maximumHitPoints: 12 });
      expect(runtime.resourceUses).toEqual({});
    });

    it("is restored to absence, and still resolves as full, after undoing a spend", async () => {
      const before = await clearResourceMap();
      expect(SYNTHETIC_IDS.resource in before.resourceUses).toBe(false);

      const spend = expectOk<RuntimeResult>(
        await apply(before.revision, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 1 }, "operation:spend"),
      );
      expect(spend.runtime.resourceUses[SYNTHETIC_IDS.resource]).toBe(2);
      expect(spend.undoable).toBe(true);

      expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", spend.runtime.revision, "operation:undo"));

      const restored = await runtimeOf();
      // The exact prior stored representation is absence, not an explicit 3.
      expect(SYNTHETIC_IDS.resource in restored!.resourceUses).toBe(false);
      expect(restored!.resourceUses).toEqual({});
      // And the derived sheet still shows it as full.
      const sheet = await harness.query.sheet("character:brammel");
      const resource = sheet?.resources.find(item => item.id === SYNTHETIC_IDS.resource);
      expect(resource?.current.value).toBe(3);
      expect(resource?.maximum.value).toBe(3);
    });

    it("is restored to absence after undoing a recovery", async () => {
      const before = await clearResourceMap();
      // Recovering from full is clamped, so this also covers a clamped recover.
      const recover = expectOk<RuntimeResult>(
        await apply(before.revision, { kind: "resource-recover", resourceId: SYNTHETIC_IDS.resource, amount: 2 }, "operation:recover"),
      );
      if (recover.undoable) {
        expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", recover.runtime.revision, "operation:undo"));
        expect((await runtimeOf())!.resourceUses).toEqual({});
      } else {
        // Clamped to the same value: nothing changed, so nothing claims reversal.
        expect((await runtimeOf())!.resourceUses[SYNTHETIC_IDS.resource] ?? 3).toBe(3);
      }
    });

    it("consumes the reversed action only after the restoration succeeded", async () => {
      const before = await clearResourceMap();
      const spend = expectOk<RuntimeResult>(
        await apply(before.revision, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 1 }, "operation:spend"),
      );
      const beforeUndo = await harness.database.characterActions.get(spend.actionId);
      expect(beforeUndo?.reversible).toBe(true);

      expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", spend.runtime.revision, "operation:undo"));

      expect((await harness.database.characterActions.get(spend.actionId))?.reversible).toBe(false);
      expect((await runtimeOf())!.resourceUses).toEqual({});
      // A second undo finds nothing left to reverse.
      expect((await harness.runtime.undoLast("character:brammel", 3, "operation:undo-2")).status).toBe("invalid");
    });
  });

  it("does not disturb unrelated resource keys changed before the undone action", async () => {
    // Two resources: one the action touches, one it must leave alone. The
    // second ID is not in the slice, so it can only be reached by direct state.
    const other = "resource:other-synthetic";
    const seeded = await runtimeOf();
    await harness.database.characterRuntimeStates.put({
      ...seeded!,
      resourceUses: { [SYNTHETIC_IDS.resource]: 3, [other]: 1 },
      resourceMaximaAtLastSync: { ...seeded!.resourceMaximaAtLastSync, [other]: 2 },
    });
    const before = (await runtimeOf())!;

    const spend = expectOk<RuntimeResult>(
      await apply(before.revision, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 1 }, "operation:spend"),
    );
    expect(spend.runtime.resourceUses[other]).toBe(1);

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", spend.runtime.revision, "operation:undo"));

    const restored = await runtimeOf();
    expect(restored!.resourceUses[SYNTHETIC_IDS.resource]).toBe(3);
    // The unrelated key is neither overwritten nor deleted.
    expect(restored!.resourceUses[other]).toBe(1);
    expect(restored!.resourceUses).toEqual(before.resourceUses);
  });

  it("restores the previous condition list on undo in both directions", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "condition-add", conditionId: "condition:winded" }, "operation:add"));
    expectOk<RuntimeResult>(await apply(2, { kind: "condition-add", conditionId: "condition:braced" }, "operation:add-2"));
    expectOk<RuntimeResult>(await apply(3, { kind: "condition-remove", conditionId: "condition:winded" }, "operation:remove"));
    expect((await runtimeOf())?.conditions.map(item => item.conditionId)).toEqual(["condition:braced"]);

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 4, "operation:undo"));
    expect((await runtimeOf())?.conditions.map(item => item.conditionId)).toEqual(["condition:winded", "condition:braced"]);
  });

  it("reverses a long rest exactly, including hit dice and exhaustion", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 6 }, "operation:hurt"));
    expectOk<RuntimeResult>(await apply(2, { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 2 }, "operation:spend"));
    const before = await runtimeOf();
    expectOk<RuntimeResult>(await apply(3, { kind: "long-rest" }, "operation:rest"));
    expect((await runtimeOf())?.currentHitPoints).toBe(10);

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 4, "operation:undo"));
    const restored = await runtimeOf();
    expect(restored?.currentHitPoints).toBe(before?.currentHitPoints);
    expect(restored?.resourceUses[SYNTHETIC_IDS.resource]).toBe(before?.resourceUses[SYNTHETIC_IDS.resource]);
    expect(restored?.hitDiceRemaining).toBe(before?.hitDiceRemaining);
    expect(restored?.exhaustion).toBe(before?.exhaustion);
  });

  it("marks an action that changed nothing as not reversible", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "condition-add", conditionId: "condition:winded" }, "operation:add"));
    const repeat = expectOk<RuntimeResult>(
      await apply(2, { kind: "condition-add", conditionId: "condition:winded" }, "operation:add-again"),
    );
    expect(repeat.undoable).toBe(false);
    const actions = await harness.database.characterActions.where("characterId").equals("character:brammel").sortBy("sequence");
    // No `before` fragment means no claim of reversibility.
    expect(actions[1].reversible).toBe(false);
    expect(actions[1].before).toBeUndefined();
  });

  /**
   * The invariant, proved by round-trip rather than by shape.
   *
   * Asserting `reversible === Boolean(before)` only proves a fragment was
   * stored, not that it restores anything. A fragment can be present and still
   * be unable to express the change it recorded, which is exactly how an undo
   * that silently kept a resource spent passed the old assertion.
   */
  const REVERSIBILITY_SWEEP = [
    { kind: "damage", amount: 3 },
    { kind: "heal", amount: 2 },
    { kind: "temporary-hit-points", amount: 5 },
    { kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 1 },
    { kind: "resource-recover", resourceId: SYNTHETIC_IDS.resource, amount: 1 },
    { kind: "condition-add", conditionId: "condition:winded" },
    { kind: "condition-remove", conditionId: "condition:winded" },
    { kind: "short-rest" },
    { kind: "long-rest" },
  ] as const;

  /** The runtime fields an undo must reproduce exactly. */
  const affectedState = (runtime: CharacterRuntimeStateRecord | undefined) => ({
    currentHitPoints: runtime?.currentHitPoints,
    temporaryHitPoints: runtime?.temporaryHitPoints,
    hitDiceRemaining: runtime?.hitDiceRemaining,
    exhaustion: runtime?.exhaustion,
    // Serialized so an absent key and an explicit value cannot compare equal.
    resourceUses: JSON.stringify(runtime?.resourceUses ?? {}),
    conditions: runtime?.conditions.map(item => item.conditionId) ?? [],
  });

  for (const [label, seed] of [
    ["a populated resource map", undefined],
    ["an absent resource key", {}],
  ] as const)
    it(`every action labelled reversible restores the exact prior state, with ${label}`, async () => {
      if (seed) {
        const seeded = await runtimeOf();
        await harness.database.characterRuntimeStates.put({ ...seeded!, resourceUses: seed });
      }

      for (const operation of REVERSIBILITY_SWEEP) {
        const before = await runtimeOf();
        const applied = await apply(before!.revision, operation, `operation:sweep-${operation.kind}`);
        if (applied.status !== "ok") continue;
        const action = (
          await harness.database.characterActions.where("characterId").equals("character:brammel").sortBy("sequence")
        ).at(-1);

        if (!action?.reversible) continue;
        // reversible action -> apply -> apply the recorded undo -> the exact
        // affected runtime state equals the state before the action.
        const after = await runtimeOf();
        expectOk<RuntimeResult>(
          await harness.runtime.undoLast("character:brammel", after!.revision, `operation:undo-${operation.kind}`),
        );
        expect(affectedState(await runtimeOf())).toEqual(affectedState(before));
      }
    });

  it("cannot undo the same action twice", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 4 }, "operation:hit"));
    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 2, "operation:undo"));
    expect((await runtimeOf())?.currentHitPoints).toBe(10);

    // The reversed action is spent and the undo itself is not reversible.
    const second = await harness.runtime.undoLast("character:brammel", 3, "operation:undo-2");
    expect(second.status).toBe("invalid");
    expect((await runtimeOf())?.currentHitPoints).toBe(10);
  });

  it("walks back through the stack one action at a time", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 3 }, "operation:one"));
    expectOk<RuntimeResult>(await apply(2, { kind: "damage", amount: 2 }, "operation:two"));
    expect((await runtimeOf())?.currentHitPoints).toBe(5);

    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 3, "operation:undo-1"));
    expect((await runtimeOf())?.currentHitPoints).toBe(7);
    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 4, "operation:undo-2"));
    expect((await runtimeOf())?.currentHitPoints).toBe(10);
  });

  it("appends undo history without deleting the action it reverses", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 4 }, "operation:hit"));
    expectOk<RuntimeResult>(await harness.runtime.undoLast("character:brammel", 2, "operation:undo"));
    const actions = await harness.database.characterActions.where("characterId").equals("character:brammel").sortBy("sequence");
    expect(actions).toHaveLength(2);
    expect(actions[0].kind).toBe("damage");
    expect(actions[1].kind).toBe("undo");
    expect(actions[1].reversesActionId).toBe(actions[0].id);
    // A runtime action never creates a durable character version.
    expect(await harness.database.characterVersions.count()).toBe(1);
  });

  it("writes nothing when the runtime revision is stale", async () => {
    expectOk<RuntimeResult>(await apply(1, { kind: "damage", amount: 3 }, "operation:hit"));
    const outcome = await harness.runtime.undoLast("character:brammel", 1, "operation:undo-stale");
    expect(outcome.status).toBe("stale");
    expect((await runtimeOf())?.currentHitPoints).toBe(7);
    expect(await harness.database.characterActions.count()).toBe(1);
  });

  it("keeps the stored fragment free of private content", async () => {
    expectOk<RuntimeResult>(
      await harness.runtime.apply({
        characterId: "character:brammel",
        expectedRuntimeRevision: 1,
        operationId: "operation:noted",
        operation: { kind: "damage", amount: 2 },
        note: "private session note",
      }),
    );
    const action = (await harness.database.characterActions.toArray())[0];
    expect(JSON.stringify(action.before)).not.toContain("private session note");
    expect(JSON.stringify(action.after)).not.toContain("private session note");
    // Only bounded numeric runtime fields are captured.
    expect(Object.keys(action.before ?? {})).toEqual(["currentHitPoints"]);
  });
});

describe("the character aggregate across transfer, replace and restore", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  /** Adds an armour-class override and returns the resulting character revision. */
  async function addOverride(expectedRevision = 1, value = 20) {
    const result = expectOk<{ characterRevision: number }>(
      await harness.overrides.set({
        operationId: `operation:override-${value}-${expectedRevision}`,
        characterId: "character:brammel",
        expectedCharacterRevision: expectedRevision,
        targetPath: "armorClass",
        operation: "replace",
        value,
        scope: "persistent",
        reason: "private table ruling",
      }),
    );
    return result.characterRevision;
  }

  const exportBrammel = async () =>
    expectOk<{ json: string; document: { overrides: unknown[] } }>(await harness.transfer.createTransfer("character:brammel"));

  it("carries an active override through export and import", async () => {
    await addOverride();
    const { json, document } = await exportBrammel();
    expect(document.overrides).toHaveLength(1);
    // The private reason never leaves the device.
    expect(json).not.toContain("private table ruling");

    await harness.database.characters.clear();
    await harness.database.characterRuntimeStates.clear();
    await harness.database.characterOverrides.clear();

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    expectOk<ImportReceipt>(await harness.transfer.confirm(preview.token, "import", "operation:import"));

    const sheet = await harness.query.sheet("character:brammel");
    // The imported sheet reproduces the overridden value, not the automatic one.
    expect(sheet?.armorClass.value).toBe(20);
    expect(sheet?.armorClass.override?.operation).toBe("replace");
    const stored = await harness.database.characterOverrides.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].reason).toBeUndefined();
  });

  it("remaps override ownership on Keep both without touching the original", async () => {
    await addOverride();
    const { json } = await exportBrammel();
    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
      record.revision = 9;
    });

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    const receipt = expectOk<ImportReceipt>(await harness.transfer.confirm(preview.token, "keep-both", "operation:keep"));

    const copied = await harness.database.characterOverrides.where("characterId").equals(receipt.characterId).toArray();
    expect(copied).toHaveLength(1);
    expect(copied[0].id).toContain(receipt.characterId);
    expect(copied[0].value).toBe(20);
    expect(copied[0].reason).toBeUndefined();

    // The original keeps its own override, and the copy does not alias it.
    const original = await harness.database.characterOverrides.where("characterId").equals("character:brammel").toArray();
    expect(original).toHaveLength(1);
    expect(original[0].id).not.toBe(copied[0].id);

    // The imported copy starts with no session history of its own.
    expect(await harness.database.characterActions.where("characterId").equals(receipt.characterId).count()).toBe(0);
  });

  it("archives the whole outgoing aggregate on Replace and leaves no orphans", async () => {
    const revision = await addOverride();
    await harness.runtime.apply({
      characterId: "character:brammel",
      expectedRuntimeRevision: 1,
      operationId: "operation:local-damage",
      operation: { kind: "damage", amount: 3 },
    });
    // Export a version that has no override, so Replace must remove the local one.
    await harness.overrides.remove("character:brammel", "character:brammel:override:armorClass", revision, "operation:strip");
    const { json } = await exportBrammel();
    const restoredRevision = await addOverride((await harness.database.characters.get("character:brammel"))!.revision, 25);
    expect(restoredRevision).toBeGreaterThan(0);

    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
    });
    const localRevision = (await harness.database.characters.get("character:brammel"))!.revision;

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    const receipt = expectOk<ImportReceipt>(
      await harness.transfer.confirm(preview.token, "replace", "operation:replace", localRevision),
    );

    // The restore point holds the complete outgoing aggregate.
    const snapshot = await harness.database.characterSnapshots.get(receipt.restorePointId!);
    expect(snapshot?.kind).toBe("pre-import-replace");
    expect(snapshot?.overrides).toHaveLength(1);
    expect(snapshot?.overrides[0].value).toBe(25);
    expect(snapshot?.runtimeState.currentHitPoints).toBe(7);

    // No orphan override survives, and the old session log is not presented as
    // history of the imported state.
    expect(await harness.database.characterOverrides.count()).toBe(0);
    expect(await harness.database.characterActions.where("characterId").equals("character:brammel").count()).toBe(0);
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(18);
  });

  it("restores the override set belonging to a pre-import snapshot", async () => {
    const revision = await addOverride();
    const { json } = await exportBrammel();
    // Diverge locally so Replace is offered.
    await harness.overrides.remove("character:brammel", "character:brammel:override:armorClass", revision, "operation:strip");
    const localRevision = (await harness.database.characters.get("character:brammel"))!.revision;
    await addOverride(localRevision, 25);
    const beforeReplace = (await harness.database.characters.get("character:brammel"))!.revision;

    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));
    const receipt = expectOk<ImportReceipt>(
      await harness.transfer.confirm(preview.token, "replace", "operation:replace", beforeReplace),
    );
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(20);

    const current = (await harness.database.characters.get("character:brammel"))!;
    expectOk(await harness.levelUp.restore("character:brammel", receipt.restorePointId!, current.revision, "operation:restore"));

    // The pre-replace override is back and the imported one is gone.
    const overrides = await harness.database.characterOverrides.toArray();
    expect(overrides).toHaveLength(1);
    expect(overrides[0].value).toBe(25);
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(25);
  });

  it("captures overrides in the pre-level restore point and restores them", async () => {
    await addOverride(1, 20);
    const character = (await harness.database.characters.get("character:brammel"))!;
    const levelled = expectOk<LevelUpResult>(
      await harness.levelUp.confirm({
        operationId: "operation:level",
        characterId: "character:brammel",
        expectedCharacterRevision: character.revision,
        expectedRuntimeRevision: 1,
        targetLevel: 2,
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
        choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
      }),
    );
    const snapshot = await harness.database.characterSnapshots.get(levelled.restorePointId);
    expect(snapshot?.overrides).toHaveLength(1);
    expect(snapshot?.overrides[0].value).toBe(20);
  });

  it("rolls back the whole import when a late write fails", async () => {
    const { json } = await exportBrammel();
    await harness.database.characters.where("id").equals("character:brammel").modify(record => {
      record.name = "Locally renamed";
    });
    const localRevision = (await harness.database.characters.get("character:brammel"))!.revision;
    const preview = expectOk<TransferPreview>(await harness.transfer.preview(json));

    // Occupy the operation ID the import's second version append will use, so it
    // throws after the restore point and the override removal have been written.
    await harness.database.characterVersions.add({
      id: "character:brammel@squatter",
      characterId: "character:brammel",
      sequence: 99,
      reason: "edit",
      operationId: "operation:replace",
      snapshot: (await harness.database.characters.get("character:brammel"))!,
      createdAt: "2026-08-03T08:00:00.000Z",
      updatedAt: "2026-08-03T08:00:00.000Z",
    });

    await expect(harness.transfer.confirm(preview.token, "replace", "operation:replace", localRevision)).rejects.toThrow();

    // No mixed aggregate: the local record, its overrides and its log are intact.
    expect((await harness.database.characters.get("character:brammel"))?.name).toBe("Locally renamed");
    expect(await harness.database.characterSnapshots.count()).toBe(0);
  });
});

describe("until-level-up override scope", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  async function addOverride(scope: "persistent" | "until-level-up", targetPath: string, value: number, expectedRevision: number) {
    const result = expectOk<{ characterRevision: number; overrideId: string }>(
      await harness.overrides.set({
        operationId: `operation:${scope}:${targetPath}`,
        characterId: "character:brammel",
        expectedCharacterRevision: expectedRevision,
        targetPath,
        operation: "replace",
        value,
        scope,
      }),
    );
    return result;
  }

  const levelUp = async (expectedCharacterRevision: number) =>
    harness.levelUp.confirm({
      operationId: "operation:level-2",
      characterId: "character:brammel",
      expectedCharacterRevision,
      expectedRuntimeRevision: 1,
      targetLevel: 2,
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
    });

  it("expires only until-level-up overrides on a successful level-up", async () => {
    const temporary = await addOverride("until-level-up", "armorClass", 20, 1);
    const persistent = await addOverride("persistent", "initiative", 9, temporary.characterRevision);
    expect(await harness.database.characterOverrides.count()).toBe(2);

    const levelled = expectOk<LevelUpResult>(await levelUp(persistent.characterRevision));

    const remaining = await harness.database.characterOverrides.toArray();
    expect(remaining.map(item => item.targetPath)).toEqual(["initiative"]);
    const sheet = await harness.query.sheet("character:brammel");
    // The temporary override is gone, so armour class is automatic again.
    expect(sheet?.armorClass.value).toBe(18);
    expect(sheet?.initiative.value).toBe(9);

    // The pre-level restore point still holds both.
    const snapshot = await harness.database.characterSnapshots.get(levelled.restorePointId);
    expect(snapshot?.overrides.map(item => item.targetPath).sort()).toEqual(["armorClass", "initiative"]);
  });

  it("restores an expired override when the level-up is undone", async () => {
    const temporary = await addOverride("until-level-up", "armorClass", 20, 1);
    const levelled = expectOk<LevelUpResult>(await levelUp(temporary.characterRevision));
    expect(await harness.database.characterOverrides.count()).toBe(0);

    const current = (await harness.database.characters.get("character:brammel"))!;
    expectOk(await harness.levelUp.restore("character:brammel", levelled.restorePointId, current.revision, "operation:restore"));

    const restored = await harness.database.characterOverrides.toArray();
    expect(restored).toHaveLength(1);
    expect(restored[0].scope).toBe("until-level-up");
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(20);
  });

  it("leaves every override untouched when the level-up is refused", async () => {
    const temporary = await addOverride("until-level-up", "armorClass", 20, 1);
    // An unresolved new choice makes the confirm invalid.
    const outcome = await harness.levelUp.confirm({
      operationId: "operation:level-blocked",
      characterId: "character:brammel",
      expectedCharacterRevision: temporary.characterRevision,
      expectedRuntimeRevision: 1,
      targetLevel: 2,
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      choiceSelections: {},
    });
    expect(outcome.status).toBe("invalid");

    expect(await harness.database.characterOverrides.count()).toBe(1);
    expect((await harness.query.sheet("character:brammel"))?.armorClass.value).toBe(20);
    expect((await harness.database.characters.get("character:brammel"))?.level).toBe(1);
  });

  it("leaves every override untouched when the level-up is stale", async () => {
    const temporary = await addOverride("until-level-up", "armorClass", 20, 1);
    const outcome = await harness.levelUp.confirm({
      operationId: "operation:level-stale",
      characterId: "character:brammel",
      expectedCharacterRevision: temporary.characterRevision + 99,
      expectedRuntimeRevision: 1,
      targetLevel: 2,
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
    });
    expect(outcome.status).toBe("stale");
    expect(await harness.database.characterOverrides.count()).toBe(1);
    expect(await harness.database.characterSnapshots.count()).toBe(0);
  });
});

describe("CharacterLibraryService", () => {
  beforeEach(async () => {
    await commitBrammel();
  });

  it("duplicates into a fully independent aggregate", async () => {
    // Give the original an override and some session history first.
    expectOk(
      await harness.overrides.set({
        operationId: "operation:dup-override",
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
      operationId: "operation:dup-damage",
      operation: { kind: "damage", amount: 4 },
    });

    const result = expectOk<{ characterId: string }>(
      await harness.library.duplicate("character:brammel", "character:brammel-copy", "operation:duplicate"),
    );

    const copy = await harness.database.characters.get(result.characterId);
    expect(copy?.name).toBe("Brammel Voss (Copy)");
    expect(copy?.revision).toBe(1);

    // Its own runtime, overrides and version 1; no shared ownership.
    const copyRuntime = await harness.database.characterRuntimeStates.get(result.characterId);
    expect(copyRuntime?.characterId).toBe(result.characterId);
    const copyOverrides = await harness.database.characterOverrides.where("characterId").equals(result.characterId).toArray();
    expect(copyOverrides).toHaveLength(1);
    expect(copyOverrides[0].id).toContain(result.characterId);
    // The copy has no session history of its own.
    expect(await harness.database.characterActions.where("characterId").equals(result.characterId).count()).toBe(0);
    expect(await harness.database.characterActions.where("characterId").equals("character:brammel").count()).toBe(1);

    // Playing the copy leaves the original untouched.
    await harness.runtime.apply({
      characterId: result.characterId,
      expectedRuntimeRevision: 1,
      operationId: "operation:copy-damage",
      operation: { kind: "damage", amount: 2 },
    });
    const original = await harness.database.characterRuntimeStates.get("character:brammel");
    expect(original?.currentHitPoints).toBe(6);
    expect((await harness.database.characterRuntimeStates.get(result.characterId))?.currentHitPoints).toBe(4);
    expect((await harness.query.sheet(result.characterId))?.armorClass.value).toBe(20);
  });

  it("refuses to duplicate onto an existing character ID", async () => {
    const outcome = await harness.library.duplicate("character:brammel", "character:brammel", "operation:duplicate");
    expect(outcome.status).toBe("conflict");
  });

  it("archives without deleting history and keeps the record out of the active library", async () => {
    const versionsBefore = await harness.database.characterVersions.count();
    expectOk(await harness.library.setArchived("character:brammel", 1, true, "operation:archive"));

    expect((await harness.database.characters.get("character:brammel"))?.status).toBe("archived");
    const library = await harness.query.library();
    expect(library.characters).toHaveLength(0);
    // Archiving is versioned, and nothing was removed.
    expect(await harness.database.characterVersions.count()).toBe(versionsBefore + 1);
    expect(await harness.database.characterRuntimeStates.get("character:brammel")).toBeDefined();

    // It can be brought back.
    expectOk(await harness.library.setArchived("character:brammel", 2, false, "operation:unarchive"));
    expect((await harness.query.library()).characters).toHaveLength(1);
  });

  it("rejects a stale archive and writes nothing", async () => {
    const outcome = await harness.library.setArchived("character:brammel", 99, true, "operation:archive-stale");
    expect(outcome.status).toBe("stale");
    expect((await harness.database.characters.get("character:brammel"))?.status).toBe("active");
    expect(await harness.database.characterVersions.count()).toBe(1);
  });
});
