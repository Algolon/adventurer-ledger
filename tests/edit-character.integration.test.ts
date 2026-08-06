/**
 * The Edit character boundary.
 *
 * Two properties are asserted here, and they are the whole point of the route:
 * an edit draft *is* the committed character, and committing it changes nothing
 * a player is holding in their hands mid-session.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  RUNECALLER_CHOICES,

  RUNECALLER_IDS,
  SYNTHETIC_CHOICES,
  SYNTHETIC_EQUIPMENT_CHOICE,
  STANDARD_ARRAY,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild, CharacterRecord } from "@/src/domain/character-record";
import type {
  CommitResult,
  DraftSnapshot,
  EditDraftSnapshot,
} from "@/src/services/character-services";
import { draftBuildFromCharacter } from "@/src/services/edit-draft";
import type { RuntimeResult } from "@/src/services/runtime-service";

let harness: Harness;
beforeEach(async () => {
  harness = await createHarness();
});
afterEach(closeHarnesses);

/**
 * The Vanguard, built the way the builder builds one: an explicit standard-array
 * assignment plus the origin increases the background offers.
 */
const VANGUARD_BUILD: Partial<CharacterDraftBuild> = {
  name: "Brammel Voss",
  nickname: "Boss",
  level: 1,
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
  },
  equipmentSelections: { [SYNTHETIC_EQUIPMENT_CHOICE]: ["equipment-option:warden-pack"] },
};

const RUNECALLER_BUILD: Partial<CharacterDraftBuild> = {
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
};

async function commitCharacter(
  characterId: string,
  draftId: string,
  build: Partial<CharacterDraftBuild>,
): Promise<CharacterRecord> {
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({ draftId, rulesetProfileId: SYNTHETIC_RULESET_ID, level: 1, presentation: "guided" }),
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
  const record = await harness.context.repositories.characters.get(characterId);
  if (!record) throw new Error("the committed character was not written");
  return record;
}

const vanguard = () => commitCharacter("character:brammel", "draft:brammel", VANGUARD_BUILD);
const runecaller = () => commitCharacter("character:sereth", "draft:sereth", RUNECALLER_BUILD);

describe("edit-draft hydration", () => {
  it("opens with every committed permanent field prefilled", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const build = opened.draft.build;

    expect(opened.resumed).toBe(false);
    expect(opened.repairs).toEqual([]);
    expect(build.name).toBe("Brammel Voss");
    expect(build.nickname).toBe("Boss");
    expect(build.level).toBe(1);
    expect(build.classId).toBe(SYNTHETIC_IDS.class);
    expect(build.speciesId).toBe(SYNTHETIC_IDS.species);
    expect(build.backgroundId).toBe(SYNTHETIC_IDS.background);
    expect(build.abilityMethod).toBe("standard-array");
    expect(build.abilityScores).toEqual(character.abilityScores);
    expect(build.choiceSelections).toEqual(character.choiceSelections);
    expect(build.equipmentSelections).toEqual(character.equipmentSelections);
    expect(build.manualValues).toEqual(character.manualValues);
    expect(build.manualActions).toEqual(character.manualActions);
    expect(build.manualSheet).toBe(false);
  });

  /**
   * The recovery is asserted by its invariants, not by one particular answer.
   *
   * Two assignments of the same pattern can imply the same standard-array base
   * multiset, and both are then equally true readings of a record that stored
   * only the finals. What must hold in every case is that the base is a legal
   * starting assignment, the increases are the pattern the origin declares, and
   * the two add back up to the scores that were actually committed — so no
   * score can move across a reopen whichever reading is taken.
   */
  it("recovers a base and increase split that adds back up to the committed scores", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const { abilityBaseScores, abilityIncreases, abilityScores } = opened.draft.build;

    expect([...Object.values(abilityBaseScores)].sort((a, b) => a - b)).toEqual([...STANDARD_ARRAY].sort((a, b) => a - b));
    expect([...Object.values(abilityIncreases)].sort((a, b) => b - a)).toEqual([2, 1]);
    for (const [ability, score] of Object.entries(abilityScores))
      expect(score).toBe(
        (abilityBaseScores[ability as keyof typeof abilityBaseScores] ?? 0) +
          (abilityIncreases[ability as keyof typeof abilityIncreases] ?? 0),
      );
    expect(abilityScores).toEqual(character.abilityScores);
  });

  it("re-commits the identical scores when nothing about them is edited", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const committed = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: {},
        lastStepId: "review",
      }),
    );
    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:edit-noop",
        draftId: opened.draft.id,
        expectedDraftRevision: committed.revision,
        characterId: character.id,
        expectedCharacterRevision: opened.draft.editingCharacterRevision!,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    const updated = await harness.context.repositories.characters.get(character.id);
    expect(updated?.abilityScores).toEqual(character.abilityScores);
    expect(updated?.choiceSelections).toEqual(character.choiceSelections);
    expect(updated?.equipmentSelections).toEqual(character.equipmentSelections);
    expect(updated?.classLevels).toEqual(character.classLevels);
  });

  it("opens with no outstanding issues, because the committed build had none", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.plan.issues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(opened.plan.nextUnresolvedStepId).toBe("review");
  });

  it("uses the character's own ruleset and presentation, not the device default", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.rulesetProfileId).toBe(character.rulesetProfileId);
    expect(opened.draft.presentation).toBe(character.presentation);
  });

  it("records the revision it hydrated from as the commit's compare-and-swap token", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.editingCharacterId).toBe(character.id);
    expect(opened.draft.editingCharacterRevision).toBe(character.revision);
  });

  it("hydrates a caster's class and choices the same way", async () => {
    const character = await runecaller();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.build.classId).toBe(RUNECALLER_IDS.class);
    expect(opened.draft.build.choiceSelections[RUNECALLER_CHOICES.classSkills]).toEqual(
      character.choiceSelections[RUNECALLER_CHOICES.classSkills],
    );
    expect(opened.plan.issues.filter(issue => issue.severity === "error")).toEqual([]);
  });

  it("reports not-found for a character that does not exist", async () => {
    const outcome = await harness.drafts.openForCharacter("character:absent");
    expect(outcome.status).toBe("not-found");
  });
});

describe("edit lifecycle", () => {
  it("resumes an unfinished edit draft instead of replacing it", async () => {
    const character = await vanguard();
    const first = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: first.draft.id,
        expectedRevision: first.revision,
        patch: { name: "Brammel the Reworked" },
        lastStepId: "identity",
      }),
    );

    const second = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(second.resumed).toBe(true);
    expect(second.draft.id).toBe(first.draft.id);
    expect(second.draft.build.name).toBe("Brammel the Reworked");
    expect(second.draft.lastStepId).toBe("identity");
  });

  it("creates exactly one draft however many times Edit is pressed", async () => {
    const character = await vanguard();
    const opens = await Promise.all([
      harness.drafts.openForCharacter(character.id),
      harness.drafts.openForCharacter(character.id),
      harness.drafts.openForCharacter(character.id),
    ]);
    for (const outcome of opens) expect(outcome.status).toBe("ok");
    const drafts = await harness.context.repositories.drafts.listByEditingCharacter(character.id);
    expect(drafts).toHaveLength(1);
  });

  it("writes nothing to the committed character while the draft is edited", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    await harness.drafts.update({
      draftId: opened.draft.id,
      expectedRevision: opened.revision,
      patch: { name: "Not Committed" },
    });

    const unchanged = await harness.context.repositories.characters.get(character.id);
    expect(unchanged).toEqual(character);
  });

  it("leaves the character untouched when the edit draft is abandoned", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const changed = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: { name: "Discarded" },
      }),
    );
    expectOk(await harness.drafts.abandon(opened.draft.id, changed.revision));

    expect(await harness.context.repositories.characters.get(character.id)).toEqual(character);
    // The next Edit press hydrates afresh rather than reviving the abandoned one.
    const reopened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(reopened.resumed).toBe(false);
    expect(reopened.draft.build.name).toBe("Brammel Voss");
  });

  it("updates the same character rather than creating a second one", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: {
          abilityBaseScores: { strength: 13, dexterity: 15, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
          abilityIncreases: { strength: 2, constitution: 1 },
          abilityScores: { strength: 15, dexterity: 15, constitution: 15, intelligence: 12, wisdom: 10, charisma: 8 },
        },
        lastStepId: "review",
      }),
    );
    const result = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:edit-1",
        draftId: opened.draft.id,
        expectedDraftRevision: edited.revision,
        characterId: character.id,
        expectedCharacterRevision: opened.draft.editingCharacterRevision!,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    expect(result.characterId).toBe(character.id);
    expect(result.characterRevision).toBe(character.revision + 1);
    expect(await harness.context.repositories.characters.list()).toHaveLength(1);

    const updated = await harness.context.repositories.characters.get(character.id);
    expect(updated?.abilityScores.strength).toBe(15);
    expect(updated?.abilityScores.dexterity).toBe(15);
    expect(updated?.abilityScores.constitution).toBe(15);

    // A version and a fresh derived snapshot exist through the same contract.
    const versions = await harness.context.repositories.versions.listByCharacter(character.id);
    expect(versions.map(version => version.reason)).toContain("edit");
  });

  it("reopens showing the edited permanent values", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: { nickname: "Warden" },
        lastStepId: "review",
      }),
    );
    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:edit-nickname",
        draftId: opened.draft.id,
        expectedDraftRevision: edited.revision,
        characterId: character.id,
        expectedCharacterRevision: opened.draft.editingCharacterRevision!,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    const reopened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(reopened.resumed).toBe(false);
    expect(reopened.draft.build.nickname).toBe("Warden");
    expect(reopened.draft.editingCharacterRevision).toBe(character.revision + 1);
  });

  it("refuses a stale character revision instead of overwriting newer work", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const staleToken = opened.draft.editingCharacterRevision!;

    // The character moves on underneath the open edit.
    expectOk(await harness.library.setArchived(character.id, character.revision, true, "operation:archive"));

    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: { nickname: "Late" },
        lastStepId: "review",
      }),
    );
    const outcome = await harness.commit.commit({
      operationId: "operation:edit-stale",
      draftId: opened.draft.id,
      expectedDraftRevision: edited.revision,
      characterId: character.id,
      expectedCharacterRevision: staleToken,
      intent: "edit",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    });

    expect(outcome.status).toBe("stale");
    if (outcome.status === "stale") expect(outcome.recordId).toBe(character.id);
    // The newer work survived; nothing was written over it.
    const current = await harness.context.repositories.characters.get(character.id);
    expect(current?.status).toBe("archived");
    expect(current?.nickname).toBe("Boss");
  });

  it("cannot commit the same edit twice", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: { nickname: "Once" },
        lastStepId: "review",
      }),
    );
    const command = {
      operationId: "operation:edit-double",
      draftId: opened.draft.id,
      expectedDraftRevision: edited.revision,
      characterId: character.id,
      expectedCharacterRevision: opened.draft.editingCharacterRevision!,
      intent: "edit" as const,
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    };

    expectOk<CommitResult>(await harness.commit.commit(command));
    const second = await harness.commit.commit(command);
    expect(second.status).not.toBe("ok");
    expect(await harness.context.repositories.characters.list()).toHaveLength(1);
    const current = await harness.context.repositories.characters.get(character.id);
    expect(current?.revision).toBe(character.revision + 1);
  });
});

describe("play state across an edit", () => {
  /** Puts the character into a distinctive, entirely non-default runtime state. */
  async function dirtyRuntime(characterId: string) {
    let revision = (await harness.context.repositories.runtime.get(characterId))!.revision;
    const apply = async (operation: Parameters<Harness["runtime"]["apply"]>[0]["operation"], id: string) => {
      const result = expectOk<RuntimeResult>(
        await harness.runtime.apply({ characterId, expectedRuntimeRevision: revision, operationId: id, operation }),
      );
      revision = result.runtime.revision;
    };
    await apply({ kind: "damage", amount: 4 }, "runtime:damage");
    await apply({ kind: "temporary-hit-points", amount: 3 }, "runtime:temp");
    await apply({ kind: "hit-dice-spend", amount: 1 }, "runtime:hit-dice");
    await apply({ kind: "inspiration-set", value: true }, "runtime:inspiration");
    await apply({ kind: "exhaustion-set", value: 2 }, "runtime:exhaustion");
    await apply({ kind: "condition-add", conditionId: "condition:winded" }, "runtime:condition");
    await apply({ kind: "resource-spend", resourceId: SYNTHETIC_IDS.resource, amount: 1 }, "runtime:resource");
    return harness.context.repositories.runtime.get(characterId);
  }

  it("survives opening and abandoning an edit untouched", async () => {
    const character = await vanguard();
    const before = await dirtyRuntime(character.id);

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expectOk(await harness.drafts.abandon(opened.draft.id, opened.revision));

    expect(await harness.context.repositories.runtime.get(character.id)).toEqual(before);
  });

  it("survives a commit that changes no derived maximum", async () => {
    const character = await vanguard();
    const before = (await dirtyRuntime(character.id))!;

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: { nickname: "Still Boss" },
        lastStepId: "review",
      }),
    );
    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:edit-runtime",
        draftId: opened.draft.id,
        expectedDraftRevision: edited.revision,
        characterId: character.id,
        expectedCharacterRevision: opened.draft.editingCharacterRevision!,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    const after = (await harness.context.repositories.runtime.get(character.id))!;
    expect(after.currentHitPoints).toBe(before.currentHitPoints);
    expect(after.temporaryHitPoints).toBe(before.temporaryHitPoints);
    expect(after.hitDiceRemaining).toBe(before.hitDiceRemaining);
    expect(after.inspiration).toBe(true);
    expect(after.exhaustion).toBe(2);
    expect(after.conditions).toEqual(before.conditions);
    expect(after.resourceUses).toEqual(before.resourceUses);
    expect(after.deathSaves).toEqual(before.deathSaves);
  });

  it("moves current hit points by the same delta as the maximum, and no further", async () => {
    const character = await vanguard();
    const before = (await dirtyRuntime(character.id))!;
    const beforeSheet = (await harness.query.sheet(character.id))!;

    // Constitution 14 → 16 raises the maximum by exactly the modifier delta.
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: {
          abilityBaseScores: { strength: 14, dexterity: 12, constitution: 15, intelligence: 13, wisdom: 10, charisma: 8 },
          abilityIncreases: { strength: 2, constitution: 1 },
          abilityScores: { strength: 16, dexterity: 12, constitution: 16, intelligence: 13, wisdom: 10, charisma: 8 },
        },
        lastStepId: "review",
      }),
    );
    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:edit-con",
        draftId: opened.draft.id,
        expectedDraftRevision: edited.revision,
        characterId: character.id,
        expectedCharacterRevision: opened.draft.editingCharacterRevision!,
        intent: "edit",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
      }),
    );

    const afterSheet = (await harness.query.sheet(character.id))!;
    const after = (await harness.context.repositories.runtime.get(character.id))!;
    const maximumDelta = afterSheet.hitPoints.maximum.value! - beforeSheet.hitPoints.maximum.value!;

    expect(maximumDelta).toBeGreaterThan(0);
    // The deficit is preserved: current moved by the same amount the maximum did.
    expect(after.currentHitPoints).toBe(before.currentHitPoints + maximumDelta);
    // Everything a commit has no business touching is still exactly as it was.
    expect(after.inspiration).toBe(true);
    expect(after.exhaustion).toBe(2);
    expect(after.hitDiceRemaining).toBe(before.hitDiceRemaining);
    expect(after.conditions).toEqual(before.conditions);
  });
});

describe("missing and changed content", () => {
  /** Removes one entry from the installed content, as an uninstall would. */
  async function removeEntry(entryId: string) {
    await harness.database.contentEntries.delete(entryId);
  }

  it("keeps a saved species that is no longer installed, and names the step", async () => {
    const character = await vanguard();
    await removeEntry(SYNTHETIC_IDS.species);

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.build.speciesId).toBe(SYNTHETIC_IDS.species);
    expect(opened.repairs).toContainEqual({
      code: "SPECIES_SOURCE_MISSING",
      stepId: "origin",
      recordId: SYNTHETIC_IDS.species,
    });
    expect(opened.plan.issues.map(issue => issue.code)).toContain("SPECIES_SOURCE_MISSING");
  });

  it("keeps a saved class that is no longer installed", async () => {
    const character = await vanguard();
    await removeEntry(SYNTHETIC_IDS.class);

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.build.classId).toBe(SYNTHETIC_IDS.class);
    expect(opened.draft.build.manualSheet).toBe(false);
    expect(opened.repairs.map(note => note.code)).toContain("CLASS_SOURCE_MISSING");
  });

  it("keeps a selection the content no longer offers rather than clearing it", async () => {
    const character = await vanguard();
    // The class survives; only the option it used to offer is gone.
    const classEntry = (await harness.database.contentEntries.get(SYNTHETIC_IDS.class))!;
    await harness.database.contentEntries.put({
      ...classEntry,
      choices: classEntry.choices.map(choice =>
        choice.id === SYNTHETIC_CHOICES.fightingStyle
          ? { ...choice, options: choice.options.filter(option => option.id !== "option:guarded-hand") }
          : choice,
      ),
    });

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.build.choiceSelections[SYNTHETIC_CHOICES.fightingStyle]).toEqual(["option:guarded-hand"]);
    expect(opened.repairs).toContainEqual({
      code: "CHOICE_OPTION_NO_LONGER_OFFERED",
      stepId: "class-choices",
      recordId: SYNTHETIC_CHOICES.fightingStyle,
    });
  });

  it("reports nothing when the ruleset merely gained unrelated content", async () => {
    const character = await vanguard();
    const existing = (await harness.database.contentEntries.get(SYNTHETIC_IDS.weapon))!;
    await harness.database.contentEntries.put({
      ...existing,
      id: "weapon:added-later",
      slug: "added-later",
      name: "Added Later",
    });

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.repairs).toEqual([]);
    expect(opened.draft.build.classId).toBe(SYNTHETIC_IDS.class);
    expect(opened.draft.build.abilityScores).toEqual(character.abilityScores);
  });

  it("keeps the committed scores exactly when the origin allocation cannot be read back", async () => {
    const character = await vanguard();
    // A background whose declared pattern no longer explains the committed
    // finals: the increases cannot be recovered, but no score may move.
    const background = (await harness.database.contentEntries.get(SYNTHETIC_IDS.background))!;
    await harness.database.contentEntries.put({
      ...background,
      mechanics: {
        ...background.mechanics,
        abilityScoreChoices: { abilities: ["wisdom", "charisma"], increasePattern: [3] },
      },
    });

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.draft.build.abilityScores).toEqual(character.abilityScores);
    expect(opened.draft.build.abilityIncreases).toEqual({});
    expect(opened.repairs.map(note => note.code)).toContain("ORIGIN_ALLOCATION_NOT_RECOVERED");
  });
});

describe("the conversion itself", () => {
  it("is total: no committed field is dropped for want of content", () => {
    const character: CharacterRecord = {
      id: "character:bare",
      revision: 3,
      rulesetProfileId: "ruleset:absent",
      presentation: "flexible",
      name: "Bare Record",
      nickname: "Bare",
      pronouns: "they/them",
      level: 4,
      classLevels: [{ classId: "class:absent", subclassId: "subclass:absent", level: 4 }],
      speciesId: "species:absent",
      backgroundId: "background:absent",
      abilityMethod: "manual",
      abilityScores: { strength: 11 },
      choiceSelections: { "choice:absent": ["option:absent"] },
      equipmentSelections: { "equipment-choice:absent": ["equipment-option:absent"] },
      manualValues: { armorClass: 15 },
      manualActions: [{ id: "manual:swing", label: "Swing" }],
      acknowledgedIssueCodes: ["SOME_CODE"],
      contentFingerprint: "fp1:0:00000000",
      status: "active",
      kind: "player-character",
      tags: [],
      createdAt: "2026-08-03T09:00:00.000Z",
      updatedAt: "2026-08-03T09:00:00.000Z",
    };

    const { build, notes } = draftBuildFromCharacter(character, []);

    expect(build.name).toBe("Bare Record");
    expect(build.nickname).toBe("Bare");
    expect(build.pronouns).toBe("they/them");
    expect(build.level).toBe(4);
    expect(build.classId).toBe("class:absent");
    expect(build.subclassId).toBe("subclass:absent");
    expect(build.speciesId).toBe("species:absent");
    expect(build.backgroundId).toBe("background:absent");
    expect(build.abilityMethod).toBe("manual");
    expect(build.abilityScores).toEqual({ strength: 11 });
    expect(build.choiceSelections).toEqual({ "choice:absent": ["option:absent"] });
    expect(build.equipmentSelections).toEqual({ "equipment-choice:absent": ["equipment-option:absent"] });
    expect(build.manualValues).toEqual({ armorClass: 15 });
    expect(build.manualActions).toEqual([{ id: "manual:swing", label: "Swing" }]);
    expect(build.acknowledgedIssueCodes).toEqual(["SOME_CODE"]);
    expect(notes.map(note => note.code)).toEqual(
      expect.arrayContaining([
        "CLASS_SOURCE_MISSING",
        "SUBCLASS_SOURCE_MISSING",
        "SPECIES_SOURCE_MISSING",
        "BACKGROUND_SOURCE_MISSING",
        "CHOICE_OPTION_NO_LONGER_OFFERED",
        "EQUIPMENT_OPTION_NO_LONGER_OFFERED",
      ]),
    );
  });

  it("recognises a manual sheet by what only a manual sheet has", () => {
    const base: CharacterRecord = {
      id: "character:manual",
      revision: 1,
      rulesetProfileId: "ruleset:any",
      presentation: "flexible",
      name: "Hand Written",
      level: 1,
      classLevels: [],
      abilityMethod: "manual",
      abilityScores: { strength: 10 },
      choiceSelections: {},
      equipmentSelections: {},
      manualValues: { armorClass: 12 },
      manualActions: [],
      acknowledgedIssueCodes: [],
      contentFingerprint: "fp1:0:00000000",
      status: "active",
      kind: "player-character",
      tags: [],
      createdAt: "2026-08-03T09:00:00.000Z",
      updatedAt: "2026-08-03T09:00:00.000Z",
    };

    expect(draftBuildFromCharacter(base, []).build.manualSheet).toBe(true);
    // A classless build with nothing hand-entered is unfinished, not manual.
    expect(draftBuildFromCharacter({ ...base, manualValues: {} }, []).build.manualSheet).toBe(false);
    // A class always wins: the sheet is automatic.
    expect(
      draftBuildFromCharacter({ ...base, classLevels: [{ classId: "class:any", level: 1 }] }, []).build.manualSheet,
    ).toBe(false);
  });
});

/**
 * A selection the content no longer offers must make its step incomplete.
 *
 * Counting selections was enough to call a choice resolved, so a saved option ID
 * the installed content had stopped offering read as a finished step: the
 * builder showed no issue, Review accepted it, and the commit wrote a selection
 * nothing could resolve. Membership is what "resolved" was always supposed to
 * mean.
 */
describe("a selection the content no longer offers", () => {
  it("makes its step incomplete rather than reading as resolved", async () => {
    const character = await vanguard();
    const classEntry = (await harness.database.contentEntries.get(SYNTHETIC_IDS.class))!;
    await harness.database.contentEntries.put({
      ...classEntry,
      choices: classEntry.choices.map(choice =>
        choice.id === SYNTHETIC_CHOICES.fightingStyle
          ? { ...choice, options: choice.options.filter(option => option.id !== "option:guarded-hand") }
          : choice,
      ),
    });

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));

    // The value is still stored, and the step that owns it says so.
    expect(opened.draft.build.choiceSelections[SYNTHETIC_CHOICES.fightingStyle]).toEqual(["option:guarded-hand"]);
    expect(opened.plan.issues.map(issue => issue.code)).toContain("CHOICE_UNRESOLVED");
    expect(opened.plan.steps.find(step => step.id === "class-choices")?.status).toBe("incomplete");
    expect(opened.plan.nextUnresolvedStepId).toBe("class-choices");
  });

  it("refuses to commit it in guided mode instead of writing an unresolvable build", async () => {
    const character = await vanguard();
    const classEntry = (await harness.database.contentEntries.get(SYNTHETIC_IDS.class))!;
    await harness.database.contentEntries.put({
      ...classEntry,
      choices: classEntry.choices.map(choice =>
        choice.id === SYNTHETIC_CHOICES.fightingStyle
          ? { ...choice, options: choice.options.filter(option => option.id !== "option:guarded-hand") }
          : choice,
      ),
    });

    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    const edited = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: opened.draft.id,
        expectedRevision: opened.revision,
        patch: {},
        lastStepId: "review",
      }),
    );
    const outcome = await harness.commit.commit({
      operationId: "operation:edit-unresolvable",
      draftId: opened.draft.id,
      expectedDraftRevision: edited.revision,
      characterId: character.id,
      expectedCharacterRevision: opened.draft.editingCharacterRevision!,
      intent: "edit",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID),
    });

    expect(outcome.status).toBe("invalid");
    // The committed character is untouched.
    expect(await harness.context.repositories.characters.get(character.id)).toEqual(character);
  });

  it("still counts a selection the content does offer as resolved", async () => {
    const character = await vanguard();
    const opened = expectOk<EditDraftSnapshot>(await harness.drafts.openForCharacter(character.id));
    expect(opened.plan.issues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(opened.plan.steps.find(step => step.id === "class-choices")?.status).toBe("complete");
  });
});
