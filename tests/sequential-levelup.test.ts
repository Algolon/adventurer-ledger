/**
 * Sequential level-up over real 1–5 progression.
 *
 * Level-up advances exactly one level and discovers that level's choices through
 * the same generic planner creation uses, so a subclass at 3 and two choices at
 * 4 arrive at the right step with no level-up-specific planning code.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import type { CharacterRecord } from "@/src/domain/character-record";
import type { ContentEntry } from "@/src/domain/model";
import type { LevelUpPreview, LevelUpResult } from "@/src/services/levelup-service";
import {
  PROG_CHOICES,
  PROG_ENTRIES,
  PROG_IDS,
  PROG_RULESET,
  PROG_RULESET_ID,
  PROG_SOURCE_ID,
} from "@/tests/fixtures/progression-ruleset";

let harness: Harness;
const ID = "character:wayfinder-test";

beforeEach(async () => {
  harness = await createHarness();
  const now = "2026-08-04T08:00:00.000Z";
  await harness.database.sources.put({
    id: PROG_SOURCE_ID,
    name: "Stonewake synthetic progression",
    edition: "homebrew",
    priority: 30,
    visibility: "public-original",
    licenseType: "original",
    enabledByDefault: true,
    createdAt: now,
    updatedAt: now,
  } as never);
  await harness.database.contentEntries.bulkPut(PROG_ENTRIES as unknown as ContentEntry[]);
  await harness.database.rulesetProfiles.put(PROG_RULESET);
});
afterEach(closeHarnesses);

/** A committed level-1 Wayfinder with its level-1 choices already resolved. */
async function commitLevelOne() {
  const now = "2026-08-04T08:00:00.000Z";
  const character: CharacterRecord = {
    id: ID,
    revision: 1,
    rulesetProfileId: PROG_RULESET_ID,
    presentation: "guided",
    name: "Wren Halloway",
    level: 1,
    classLevels: [{ classId: PROG_IDS.class, level: 1 }],
    speciesId: PROG_IDS.species,
    backgroundId: PROG_IDS.background,
    abilityMethod: "standard-array",
    abilityScores: { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 16, charisma: 8 },
    choiceSelections: {
      [PROG_CHOICES.classSkills]: ["option:skill-pathfinding", "option:skill-masonry"],
      [PROG_CHOICES.speciesStone]: ["option:stone-granite"],
      "choice:road-sense-approach": ["option:road-sense-weather"],
    },
    equipmentSelections: { [PROG_CHOICES.equipment]: ["equipment-option:lantern"] },
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
    contentFingerprint: await harness.query.contentFingerprint(PROG_RULESET_ID),
    status: "active",
    kind: "player-character",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  await harness.database.characters.put(character);
  await harness.database.characterRuntimeStates.put({
    characterId: ID,
    revision: 1,
    currentHitPoints: 12,
    maximumHitPointsAtLastSync: 12,
    temporaryHitPoints: 0,
    resourceUses: {},
    resourceMaximaAtLastSync: {},
    conditions: [],
    hitDiceRemaining: 1,
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0 },
    createdAt: now,
    updatedAt: now,
  });
  await harness.database.characterVersions.put({
    id: `${ID}@1`,
    characterId: ID,
    sequence: 1,
    reason: "initial",
    operationId: "operation:seed",
    snapshot: character,
    createdAt: now,
    updatedAt: now,
  });
  return character;
}

const currentLevel = async () => (await harness.database.characters.get(ID))?.level;
const runtimeRevision = async () => (await harness.database.characterRuntimeStates.get(ID))!.revision;
const characterRevision = async () => (await harness.database.characters.get(ID))!.revision;

/** Confirms exactly one level, supplying whatever that level requires. */
async function advanceOnce(
  step: number,
  choiceSelections: Record<string, readonly string[]> = {},
  subclassId?: string,
) {
  const fingerprint = await harness.query.contentFingerprint(PROG_RULESET_ID);
  return harness.levelUp.confirm({
    operationId: `operation:levelup-${step}`,
    characterId: ID,
    expectedCharacterRevision: await characterRevision(),
    expectedRuntimeRevision: await runtimeRevision(),
    targetLevel: step,
    expectedContentFingerprint: fingerprint,
    choiceSelections,
    ...(subclassId ? { subclassId } : {}),
  });
}

describe("level-up advances exactly one level at a time", () => {
  it("previews only the next level, never a jump", async () => {
    await commitLevelOne();
    const preview = expectOk<LevelUpPreview>(await harness.levelUp.preview(ID));
    expect(preview.toLevel).toBe(2);
  });

  it("walks 1 to 5 one level at a time, discovering each level's own choices", async () => {
    await commitLevelOne();

    // 1 -> 2: this level declares no choices at all.
    const toTwo = expectOk<LevelUpPreview>(await harness.levelUp.preview(ID));
    expect(toTwo.toLevel).toBe(2);
    expect(toTwo.newChoices).toHaveLength(0);
    expectOk<LevelUpResult>(await advanceOnce(2));
    expect(await currentLevel()).toBe(2);

    // 2 -> 3: the subclass path appears, and it is required.
    const toThree = expectOk<LevelUpPreview>(await harness.levelUp.preview(ID));
    expect(toThree.toLevel).toBe(3);
    expect(toThree.newChoices.map(c => c.choiceId)).toContain(PROG_CHOICES.subclassPath);
    // Confirming without it is refused.
    expect((await advanceOnce(3)).status).toBe("invalid");
    expect(await currentLevel()).toBe(2);

    expectOk<LevelUpResult>(
      await advanceOnce(
        3,
        { [PROG_CHOICES.subclassPath]: ["option:path-cairn"], [PROG_CHOICES.subclassMark]: ["option:mark-stacked"] },
        PROG_IDS.subclassA,
      ),
    );
    expect(await currentLevel()).toBe(3);
    // The subclass identity is stored on the class level, not inferred.
    expect((await harness.database.characters.get(ID))?.classLevels[0].subclassId).toBe(PROG_IDS.subclassA);

    // 3 -> 4: two new choices arrive together.
    const toFour = expectOk<LevelUpPreview>(await harness.levelUp.preview(ID));
    expect(toFour.toLevel).toBe(4);
    const fourIds = toFour.newChoices.map(c => c.choiceId);
    expect(fourIds).toContain(PROG_CHOICES.feat);
    expect(fourIds).toContain(PROG_CHOICES.technique);

    expectOk<LevelUpResult>(
      await advanceOnce(4, {
        [PROG_CHOICES.feat]: ["option:feat-road-sense"],
        [PROG_CHOICES.technique]: ["option:technique-quiet-camp"],
      }),
    );
    expect(await currentLevel()).toBe(4);

    // 4 -> 5.
    expectOk<LevelUpResult>(await advanceOnce(5));
    expect(await currentLevel()).toBe(5);

    // The recorded history steps through every level: no version skips one,
    // which is the durable evidence that nothing jumped.
    const versions = await harness.database.characterVersions.where("characterId").equals(ID).sortBy("sequence");
    const levels = [...new Set(versions.map(version => version.snapshot.level))].sort((a, b) => a - b);
    expect(levels).toEqual([1, 2, 3, 4, 5]);
    // One pre-level restore point per level-up.
    const snapshots = await harness.database.characterSnapshots.where("characterId").equals(ID).toArray();
    expect(snapshots).toHaveLength(4);
  });

  it("refuses a target level that is not exactly one above the current level", async () => {
    await commitLevelOne();
    // Asking to land on 5 from 1 is not a supported operation.
    const outcome = await advanceOnce(5);
    expect(outcome.status).not.toBe("ok");
    expect(await currentLevel()).toBe(1);
  });

  it("writes nothing when the level-up is stale", async () => {
    await commitLevelOne();
    const fingerprint = await harness.query.contentFingerprint(PROG_RULESET_ID);
    const outcome = await harness.levelUp.confirm({
      operationId: "operation:stale",
      characterId: ID,
      expectedCharacterRevision: 99,
      expectedRuntimeRevision: await runtimeRevision(),
      targetLevel: 2,
      expectedContentFingerprint: fingerprint,
      choiceSelections: {},
    });
    expect(outcome.status).toBe("stale");
    expect(await currentLevel()).toBe(1);
    expect(await harness.database.characterSnapshots.count()).toBe(0);
  });

  it("restores the pre-level state after a choice-bearing level-up", async () => {
    await commitLevelOne();
    expectOk<LevelUpResult>(await advanceOnce(2));
    const result = expectOk<LevelUpResult>(
      await advanceOnce(
        3,
        { [PROG_CHOICES.subclassPath]: ["option:path-cairn"], [PROG_CHOICES.subclassMark]: ["option:mark-stacked"] },
        PROG_IDS.subclassA,
      ),
    );
    expect(await currentLevel()).toBe(3);

    expectOk<LevelUpResult>(
      await harness.levelUp.restore(ID, result.restorePointId!, await characterRevision(), "operation:restore"),
    );

    const restored = await harness.database.characters.get(ID);
    expect(restored?.level).toBe(2);
    // The subclass chosen at 3 is gone with the level that granted it.
    expect(restored?.classLevels[0].subclassId).toBeUndefined();
    // History is appended, never erased: the level-3 version is still there.
    const versions = await harness.database.characterVersions.where("characterId").equals(ID).toArray();
    expect(versions.some(version => version.snapshot.level === 3)).toBe(true);
  });
});
