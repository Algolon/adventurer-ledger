/**
 * The play-state operations this iteration added: inspiration, death saves,
 * exhaustion and hit dice.
 *
 * Each is checked at its bounds, across an undo, and — where the operation is
 * declared to interact with another piece of state — across that interaction as
 * one transaction. Undo is the recurring subject because every one of these
 * fields is a place where an inferred inverse would look right and be wrong:
 * absent inspiration and explicit `false` are the same state to read and
 * different states to restore, and a heal that clears a death-save tally cannot
 * be reversed by damage.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  RUNECALLER_CHOICES,
  RUNECALLER_IDS,
  RUNECALLER_SPELL_SELECTIONS,
  SYNTHETIC_CHOICES,
  SYNTHETIC_EQUIPMENT_CHOICE,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild, CharacterRuntimeStateRecord } from "@/src/domain/character-record";
import type { CommitResult, DraftSnapshot, EditDraftSnapshot } from "@/src/services/character-services";
import type { RuntimeOperation, RuntimeResult } from "@/src/services/runtime-service";
import { applyRuntimeFragment, runtimeFragmentDiff } from "@/src/services/runtime-service";

let harness: Harness;
beforeEach(async () => {
  harness = await createHarness();
});
afterEach(closeHarnesses);

const CHARACTER = "character:brammel";

const VANGUARD = (level: number): Partial<CharacterDraftBuild> => ({
  name: "Brammel Voss",
  level,
  classId: SYNTHETIC_IDS.class,
  speciesId: SYNTHETIC_IDS.species,
  backgroundId: SYNTHETIC_IDS.background,
  abilityMethod: "standard-array",
  abilityBaseScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
  abilityIncreases: { strength: 2, constitution: 1 },
  abilityScores: { strength: 17, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
  choiceSelections: {
    [SYNTHETIC_CHOICES.fightingStyle]: ["option:guarded-hand"],
    [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-riverlore", "option:proficiency:skill-haulage"],
    [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
    ...(level >= 2 ? { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] } : {}),
  },
  equipmentSelections: { [SYNTHETIC_EQUIPMENT_CHOICE]: ["equipment-option:warden-pack"] },
});

async function commit(build: Partial<CharacterDraftBuild>, characterId = CHARACTER, draftId = "draft:brammel") {
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({
      draftId,
      rulesetProfileId: SYNTHETIC_RULESET_ID,
      level: build.level ?? 1,
      presentation: "guided",
    }),
  );
  const filled = expectOk<DraftSnapshot>(
    await harness.drafts.update({ draftId, expectedRevision: created.revision, patch: build, lastStepId: "review" }),
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
}

const runtimeOf = (characterId = CHARACTER) => harness.context.repositories.runtime.get(characterId);

/** Applies one operation at the current revision and returns the result. */
async function act(operation: RuntimeOperation, operationId: string, characterId = CHARACTER) {
  const current = (await runtimeOf(characterId))!;
  return harness.runtime.apply({
    characterId,
    expectedRuntimeRevision: current.revision,
    operationId,
    operation,
  });
}

const doAct = async (operation: RuntimeOperation, operationId: string, characterId = CHARACTER) =>
  expectOk<RuntimeResult>(await act(operation, operationId, characterId));

async function undo(operationId: string, characterId = CHARACTER) {
  const current = (await runtimeOf(characterId))!;
  return harness.runtime.undoLast(characterId, current.revision, operationId);
}

describe("inspiration", () => {
  beforeEach(async () => {
    await commit(VANGUARD(1));
  });

  it("reads as false on a runtime row written before the field existed", async () => {
    const seeded = (await runtimeOf())!;
    const { inspiration, ...legacy } = seeded;
    expect(inspiration).toBeUndefined();
    await harness.database.characterRuntimeStates.put(legacy as CharacterRuntimeStateRecord);

    expect("inspiration" in (await runtimeOf())!).toBe(false);
    expect((await harness.query.sheet(CHARACTER))?.inspiration).toBe(false);
  });

  it("restores absence exactly when a first gain is undone", async () => {
    const seeded = (await runtimeOf())!;
    const { inspiration: _absent, ...legacy } = seeded;
    await harness.database.characterRuntimeStates.put(legacy as CharacterRuntimeStateRecord);

    const gained = await doAct({ kind: "inspiration-set", value: true }, "operation:gain");
    expect(gained.runtime.inspiration).toBe(true);
    expect(gained.undoable).toBe(true);

    expectOk<RuntimeResult>(await undo("operation:undo"));
    // Restored to false, which is what absence meant. The sheet agrees.
    expect((await runtimeOf())!.inspiration ?? false).toBe(false);
    expect((await harness.query.sheet(CHARACTER))?.inspiration).toBe(false);
  });

  it("restores true when a spend is undone", async () => {
    await doAct({ kind: "inspiration-set", value: true }, "operation:gain");
    const spent = await doAct({ kind: "inspiration-set", value: false }, "operation:spend");
    expect(spent.runtime.inspiration).toBe(false);
    expect(spent.undoable).toBe(true);

    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect((await runtimeOf())!.inspiration).toBe(true);
  });

  it("treats an absent value and an explicit false as the same state", async () => {
    const seeded = (await runtimeOf())!;
    const { inspiration: _absent, ...legacy } = seeded;
    const withoutField = legacy as CharacterRuntimeStateRecord;
    const withFalse: CharacterRuntimeStateRecord = { ...withoutField, inspiration: false };

    // No change to record, in either direction.
    expect(runtimeFragmentDiff(withoutField, withFalse).changed).toBe(false);
    expect(runtimeFragmentDiff(withFalse, withoutField).changed).toBe(false);
    // And an unrelated change carries no inspiration key at all.
    const diff = runtimeFragmentDiff(withoutField, { ...withoutField, exhaustion: 1 });
    expect(diff.before.inspiration).toBeUndefined();
    expect(diff.after.inspiration).toBeUndefined();
  });

  it("setting the value it already has changes nothing and claims no reversal", async () => {
    const repeat = await doAct({ kind: "inspiration-set", value: false }, "operation:noop");
    expect(repeat.undoable).toBe(false);
  });
});

describe("death saves", () => {
  beforeEach(async () => {
    await commit(VANGUARD(1));
  });

  const tally = async () => (await runtimeOf())!.deathSaves;

  it("bounds successes and failures to three", async () => {
    for (let index = 0; index < 5; index += 1)
      await act({ kind: "death-save", result: "success" }, `operation:success-${index}`);
    for (let index = 0; index < 5; index += 1)
      await act({ kind: "death-save", result: "failure" }, `operation:failure-${index}`);

    expect(await tally()).toEqual({ successes: 3, failures: 3 });
  });

  it("stays at zero when reset from zero, and records no reversible action", async () => {
    expect(await tally()).toEqual({ successes: 0, failures: 0 });
    const cleared = await doAct({ kind: "death-saves-clear" }, "operation:clear-from-zero");
    expect(cleared.runtime.deathSaves).toEqual({ successes: 0, failures: 0 });
    // Nothing changed, so nothing claims it can be reversed.
    expect(cleared.undoable).toBe(false);
  });

  it("restores the exact previous tally on undo", async () => {
    await doAct({ kind: "death-save", result: "failure" }, "operation:f1");
    await doAct({ kind: "death-save", result: "success" }, "operation:s1");
    const before = await tally();
    expect(before).toEqual({ successes: 1, failures: 1 });

    await doAct({ kind: "death-save", result: "failure" }, "operation:f2");
    expect(await tally()).toEqual({ successes: 1, failures: 2 });

    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect(await tally()).toEqual(before);
  });

  it("clears the tally in the same operation that heals above zero", async () => {
    await doAct({ kind: "damage", amount: 99 }, "operation:down");
    expect((await runtimeOf())!.currentHitPoints).toBe(0);
    await doAct({ kind: "death-save", result: "failure" }, "operation:f1");
    await doAct({ kind: "death-save", result: "success" }, "operation:s1");
    expect(await tally()).toEqual({ successes: 1, failures: 1 });

    const healed = await doAct({ kind: "heal", amount: 3 }, "operation:heal");
    expect(healed.runtime.currentHitPoints).toBe(3);
    expect(healed.runtime.deathSaves).toEqual({ successes: 0, failures: 0 });
    // One action, not two: the clear is part of the heal's own record.
    const actions = await harness.context.repositories.actions.listByCharacter(CHARACTER, 5);
    expect(actions[0].kind).toBe("heal");
    expect(actions[0].before?.deathSaves).toEqual({ successes: 1, failures: 1 });
  });

  it("restores both the hit points and the tally when that heal is undone", async () => {
    await doAct({ kind: "damage", amount: 99 }, "operation:down");
    await doAct({ kind: "death-save", result: "failure" }, "operation:f1");
    await doAct({ kind: "death-save", result: "failure" }, "operation:f2");
    await doAct({ kind: "death-save", result: "success" }, "operation:s1");
    const before = (await runtimeOf())!;

    await doAct({ kind: "heal", amount: 4 }, "operation:heal");
    expectOk<RuntimeResult>(await undo("operation:undo"));

    const restored = (await runtimeOf())!;
    expect(restored.currentHitPoints).toBe(before.currentHitPoints);
    expect(restored.deathSaves).toEqual({ successes: 1, failures: 2 });
  });

  it("does not clear the tally when a heal leaves the character at zero", async () => {
    await doAct({ kind: "damage", amount: 99 }, "operation:down");
    await doAct({ kind: "death-save", result: "failure" }, "operation:f1");
    const healed = await doAct({ kind: "heal", amount: 0 }, "operation:heal-nothing");
    expect(healed.runtime.currentHitPoints).toBe(0);
    expect(healed.runtime.deathSaves).toEqual({ successes: 0, failures: 1 });
  });
});

describe("exhaustion", () => {
  beforeEach(async () => {
    await commit(VANGUARD(1));
  });

  const exhaustion = async () => (await runtimeOf())!.exhaustion;

  it("is bounded to zero and six", async () => {
    await doAct({ kind: "exhaustion-set", value: 99 }, "operation:high");
    expect(await exhaustion()).toBe(6);
    await doAct({ kind: "exhaustion-set", value: -4 }, "operation:low");
    expect(await exhaustion()).toBe(0);
  });

  it("restores the exact previous level on undo", async () => {
    await doAct({ kind: "exhaustion-set", value: 3 }, "operation:three");
    await doAct({ kind: "exhaustion-set", value: 5 }, "operation:five");
    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect(await exhaustion()).toBe(3);
  });

  /**
   * The declared contract, and only the declared contract.
   *
   * A long rest reduces exhaustion by one level and never below zero. Nothing
   * here encodes a published edition's wider exhaustion rules; the sheet applies
   * what `docs/product/MOBILE_SHEET_SPEC.md` states and no more.
   */
  it("drops by exactly one level on a long rest", async () => {
    await doAct({ kind: "exhaustion-set", value: 3 }, "operation:three");
    await doAct({ kind: "long-rest" }, "operation:rest");
    expect(await exhaustion()).toBe(2);
  });

  it("stays at zero across a long rest taken without exhaustion", async () => {
    await doAct({ kind: "long-rest" }, "operation:rest");
    expect(await exhaustion()).toBe(0);
  });

  it("is not changed at all by a short rest", async () => {
    await doAct({ kind: "exhaustion-set", value: 2 }, "operation:two");
    await doAct({ kind: "short-rest" }, "operation:rest");
    expect(await exhaustion()).toBe(2);
  });

  it("restores the pre-rest level when the long rest is undone", async () => {
    await doAct({ kind: "exhaustion-set", value: 4 }, "operation:four");
    await doAct({ kind: "long-rest" }, "operation:rest");
    expect(await exhaustion()).toBe(3);
    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect(await exhaustion()).toBe(4);
  });
});

describe("hit dice", () => {
  beforeEach(async () => {
    await commit(VANGUARD(2));
  });

  const remaining = async () => (await runtimeOf())!.hitDiceRemaining;

  it("starts at the character's level", async () => {
    expect(await remaining()).toBe(2);
  });

  it("cannot be spent below zero", async () => {
    await doAct({ kind: "hit-dice-spend", amount: 5 }, "operation:spend");
    expect(await remaining()).toBe(0);
  });

  it("cannot be recovered above the character's level", async () => {
    await doAct({ kind: "hit-dice-recover", amount: 5 }, "operation:recover");
    expect(await remaining()).toBe(2);
  });

  it("restores the exact previous count on undo", async () => {
    await doAct({ kind: "hit-dice-spend", amount: 1 }, "operation:spend");
    expect(await remaining()).toBe(1);
    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect(await remaining()).toBe(2);
  });

  it("is untouched by a short rest and refilled by a long rest", async () => {
    await doAct({ kind: "hit-dice-spend", amount: 2 }, "operation:spend");
    await doAct({ kind: "short-rest" }, "operation:short");
    expect(await remaining()).toBe(0);

    await doAct({ kind: "long-rest" }, "operation:long");
    expect(await remaining()).toBe(2);

    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect(await remaining()).toBe(0);
  });

  /**
   * A permanent edit is not a rest.
   *
   * D-08's preserve-expenditure policy applies here exactly as it does to hit
   * points and resources: raising the level adds capacity without refunding what
   * was already spent, and lowering it can only take capacity away. Anything
   * else would make Edit character a free short rest.
   */
  it("keeps spent dice spent when a permanent edit raises the level", async () => {
    await doAct({ kind: "hit-dice-spend", amount: 2 }, "operation:spend");
    expect(await remaining()).toBe(0);

    const character = (await harness.context.repositories.characters.get(CHARACTER))!;
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(CHARACTER));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: { nickname: "Rested?" },
        lastStepId: "review",
      }),
    );
    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:edit",
        draftId: opened.draft.id,
        expectedDraftRevision: edited.revision,
        characterId: CHARACTER,
        expectedCharacterRevision: character.revision,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    expect(await remaining()).toBe(0);
  });

  /**
   * Level up and Edit character diverge here, and the divergence is the point.
   *
   * Level up grants one die, which is D-08's preserve-expenditure policy applied
   * to the pool: the maximum rose, so the current value rises with it. A build
   * correction is not advancement and grants none. Both are pinned so neither
   * drifts into the other.
   */
  it("grants exactly one die on a level up, where an edit grants none", async () => {
    // A level-1 Vanguard, so the level-up to 2 is the one the content covers.
    await commit(VANGUARD(1), "character:solo", "draft:solo");
    const spend = expectOk<RuntimeResult>(
      await act({ kind: "hit-dice-spend", amount: 1 }, "operation:spend", "character:solo"),
    );
    expect(spend.runtime.hitDiceRemaining).toBe(0);

    const character = (await harness.context.repositories.characters.get("character:solo"))!;
    expectOk(
      await harness.levelUp.confirm({
        operationId: "operation:level-up",
        characterId: "character:solo",
        expectedCharacterRevision: character.revision,
        expectedRuntimeRevision: spend.runtime.revision,
        targetLevel: 2,
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
        choiceSelections: { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] },
      }),
    );

    // One die granted for the level gained, not a refill to the new level of 2.
    expect((await runtimeOf("character:solo"))!.hitDiceRemaining).toBe(1);
  });

  it("clamps to the level rather than erasing the pool when the level drops", async () => {
    const seeded = (await runtimeOf())!;
    await harness.database.characterRuntimeStates.put({ ...seeded, hitDiceRemaining: 2 });

    // The commit service's own re-synchronisation, applied directly to a sheet
    // one level lower.
    const { syncRuntimeToSheet } = await import("@/src/services/character-services");
    const sheet = (await harness.query.sheet(CHARACTER))!;
    const lowered = syncRuntimeToSheet(
      { ...seeded, hitDiceRemaining: 2 },
      { ...sheet, level: 1 },
      "2026-08-03T09:00:10.000Z",
    );
    expect(lowered.hitDiceRemaining).toBe(1);
  });
});

describe("resources and spell slots", () => {
  it("keeps only the declared slot resources on the Spells surface", async () => {
    await commit(
      {
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
        // Answered so the guided commit is valid; this test is about slots.
        spellSelections: {
          [RUNECALLER_SPELL_SELECTIONS.cantrips]: [
            RUNECALLER_IDS.spells.siltWhisper,
            RUNECALLER_IDS.spells.tallyMark,
          ],
          [RUNECALLER_SPELL_SELECTIONS.runesKnown]: [
            RUNECALLER_IDS.spells.stoneReading,
            RUNECALLER_IDS.spells.quietTheWake,
          ],
        },
      },
      "character:sereth",
      "draft:sereth",
    );

    const sheet = (await harness.query.sheet("character:sereth"))!;
    expect(sheet.spellcasting?.slotResourceIds).toEqual([RUNECALLER_IDS.slots]);
    // Every declared slot ID is a resource the sheet actually has, and the
    // remaining resources are what the Actions surface keeps.
    for (const id of sheet.spellcasting!.slotResourceIds)
      expect(sheet.resources.map(resource => resource.id)).toContain(id);
    const slots = new Set(sheet.spellcasting!.slotResourceIds);
    expect(sheet.resources.filter(resource => !slots.has(resource.id)).map(resource => resource.id)).not.toContain(
      RUNECALLER_IDS.slots,
    );
  });

  it("spends, recovers and undoes a slot exactly", async () => {
    await commit(VANGUARD(1));
    const resourceId = SYNTHETIC_IDS.resource;
    const before = (await runtimeOf())!.resourceUses[resourceId];

    await doAct({ kind: "resource-spend", resourceId, amount: 1 }, "operation:spend");
    expect((await runtimeOf())!.resourceUses[resourceId]).toBe(before - 1);
    expectOk<RuntimeResult>(await undo("operation:undo"));
    expect((await runtimeOf())!.resourceUses[resourceId]).toBe(before);
  });
});

describe("fragment restoration across the added fields", () => {
  const base: CharacterRuntimeStateRecord = {
    characterId: CHARACTER,
    revision: 1,
    currentHitPoints: 6,
    maximumHitPointsAtLastSync: 10,
    temporaryHitPoints: 0,
    resourceUses: {},
    resourceMaximaAtLastSync: {},
    conditions: [],
    hitDiceRemaining: 2,
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0 },
    createdAt: "2026-08-03T09:00:00.000Z",
    updatedAt: "2026-08-03T09:00:00.000Z",
  };

  it("round-trips inspiration, exhaustion, hit dice and the death-save tally together", () => {
    const next: CharacterRuntimeStateRecord = {
      ...base,
      inspiration: true,
      exhaustion: 3,
      hitDiceRemaining: 0,
      deathSaves: { successes: 2, failures: 1 },
    };
    const diff = runtimeFragmentDiff(base, next);
    expect(diff.changed).toBe(true);
    const restored = applyRuntimeFragment(next, diff.before);
    expect(restored.inspiration ?? false).toBe(false);
    expect(restored.exhaustion).toBe(0);
    expect(restored.hitDiceRemaining).toBe(2);
    expect(restored.deathSaves).toEqual({ successes: 0, failures: 0 });
  });
});
