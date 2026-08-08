/**
 * Ruleset membership follows the pack it was derived from.
 *
 * The defect these tests pin was reported from a device: a pack was updated from
 * 215 entries to 262, the import preview correctly reported 47 added, 0 updated
 * and 215 unchanged, and Settings went on showing a 215-entry ruleset. New
 * character therefore still offered only the original origins. The content was
 * installed; nothing activated it.
 *
 * The cause is that a profile's `allowedEntryIds` was written once, when the
 * profile was created, and an update to the pack never advanced it. Two paths
 * have to hold as a result, and both are exercised here against original
 * synthetic fixtures:
 *
 *  1. updating an installed pack advances its existing profile, in the import's
 *     own transaction, without creating a second profile or moving any
 *     character; and
 *  2. a device that already took the newer pack before that was true is repaired
 *     in place, with nothing reinstalled, downgraded or deleted.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeHarnesses,
  createHarness,
  expectOk,
  type Harness,
} from "@/tests/fixtures/service-harness";
import {
  ACCEPTANCE_ADDED_IDS,
  ACCEPTANCE_BUNDLES,
  ACCEPTANCE_CHOICES,
  ACCEPTANCE_IDS,
  ACCEPTANCE_PACK_ID,
  ACCEPTANCE_PROFICIENCIES,
  ACCEPTANCE_RULESET_ID,
  acceptancePackJson,
  acceptancePackWithAdditionJson,
} from "@/tests/fixtures/acceptance-ruleset";
import {
  MEMBERSHIP_PACK_ID,
  MEMBERSHIP_RULESET_ID,
  MEMBERSHIP_V1_IDS,
  MEMBERSHIP_V2_ADDED_IDS,
  SCAFFOLD_IDS,
  SCAFFOLD_PACK_ID,
  SOURCE_SHARER_ENTRY_ID,
  dependentMembershipPackV1Json,
  dependentMembershipPackV2Json,
  membershipPackV1Json,
  membershipPackV2Json,
  scaffoldPack,
  sourceSharingPackJson,
} from "@/tests/fixtures/membership-pack";
import { SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ID, RulesetProfile } from "@/src/domain/model";
import type { CommitResult, DraftSnapshot } from "@/src/services/character-services";
import type { InstallResult } from "@/src/services/content-install-service";
import {
  proposeRulesetForPack,
  reconcileRulesetMembership,
  rulesetProfileOwnership,
} from "@/src/services/ruleset-planner";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeHarnesses();
});

const V1_MEMBERS = [...Object.values(MEMBERSHIP_V1_IDS)].sort();
const V2_MEMBERS = [...Object.values(MEMBERSHIP_V1_IDS), ...Object.values(MEMBERSHIP_V2_ADDED_IDS)].sort();
const SCAFFOLD_MEMBERS = [...Object.values(SCAFFOLD_IDS)];

/** Imports one pack the way the UI does, optionally creating its ruleset. */
async function importPack(json: string, options: { createRulesetForPackId?: ID } = {}): Promise<InstallResult> {
  const preview = await harness.install.preview([json]);
  if (!preview.canImport)
    throw new Error(`The fixture pack did not validate: ${preview.issues.map(issue => issue.code).join(", ")}`);
  return expectOk<InstallResult>(
    await harness.install.confirm(preview, {
      ...(options.createRulesetForPackId ? { createRulesetForPackIds: [options.createRulesetForPackId] } : {}),
    }),
  );
}

/** The scaffold the subject pack's three entries point at, and then version 1. */
async function installMembershipV1(packJson = membershipPackV1Json()): Promise<RulesetProfile> {
  await importPack(JSON.stringify(scaffoldPack()));
  await importPack(packJson, { createRulesetForPackId: MEMBERSHIP_PACK_ID });
  const profile = await harness.database.rulesetProfiles.get(MEMBERSHIP_RULESET_ID);
  if (!profile) throw new Error("The membership pack created no ruleset profile");
  return profile;
}

const membershipOf = async (rulesetId = MEMBERSHIP_RULESET_ID) =>
  [...((await harness.database.rulesetProfiles.get(rulesetId))?.allowedEntryIds ?? [])].sort();

const profileCount = () => harness.database.rulesetProfiles.count();

/* -------------------------------------------------------------------------- */
/* An update to an installed pack advances the ruleset it already has          */
/* -------------------------------------------------------------------------- */

describe("updating an installed pack", () => {
  it("advances the existing profile from 3 members to 5 without creating a second one", async () => {
    const created = await installMembershipV1();
    // The reported starting state: a profile scoped to exactly what v1 shipped.
    expect(created.allowedEntryIds).toEqual(V1_MEMBERS);
    expect(await membershipOf()).toHaveLength(3);
    const profilesBefore = await profileCount();

    // The same shape as the reported import: additive, nothing rewritten.
    const preview = await harness.install.preview([membershipPackV2Json()]);
    expect(preview.verdict).toBe("update");
    expect(preview.set.plan.entries.add).toHaveLength(2);
    expect(preview.set.plan.entries.update).toHaveLength(0);
    expect(preview.set.plan.entries.unchanged).toHaveLength(3);
    const result = expectOk<InstallResult>(await harness.install.confirm(preview, {}));

    // One pack at v2, one profile, five members.
    await expect(harness.database.contentPacks.get(MEMBERSHIP_PACK_ID)).resolves.toMatchObject({ version: "1.1.0" });
    expect(result.createdRulesetIds).toEqual([]);
    expect(result.updatedRulesetIds).toEqual([MEMBERSHIP_RULESET_ID]);
    expect(await membershipOf()).toEqual(V2_MEMBERS);
    await expect(profileCount()).resolves.toBe(profilesBefore);

    // And the count a user reads in Settings moves with it.
    const view = (await harness.install.installedRulesets()).find(item => item.id === MEMBERSHIP_RULESET_ID);
    expect(view?.entryCount).toBe(5);
  });

  it("keeps the profile's identity and moves updatedAt only for the membership change", async () => {
    const created = await installMembershipV1();
    harness.tick();
    await importPack(membershipPackV2Json());

    const updated = await harness.database.rulesetProfiles.get(MEMBERSHIP_RULESET_ID);
    expect(updated?.id).toBe(created.id);
    expect(updated?.name).toBe(created.name);
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.conflictResolution).toBe(created.conflictResolution);
    expect(updated?.requirementEnforcement).toBe(created.requirementEnforcement);
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
  });

  it("leaves the active ruleset selection exactly where the user put it", async () => {
    await installMembershipV1();
    expectOk(await harness.install.activate(SYNTHETIC_RULESET_ID));

    await importPack(membershipPackV2Json());

    await expect(harness.install.activeRulesetId()).resolves.toBe(SYNTHETIC_RULESET_ID);
    expect(await membershipOf()).toEqual(V2_MEMBERS);
  });

  it("excludes an entry from another pack that merely shares the source", async () => {
    await installMembershipV1();
    // Ordinary, valid content published against the same source ID.
    await importPack(sourceSharingPackJson());

    await importPack(membershipPackV2Json());

    const membership = await membershipOf();
    expect(membership).toEqual(V2_MEMBERS);
    expect(membership).not.toContain(SOURCE_SHARER_ENTRY_ID);
  });

  it("keeps a declared dependency's entries and advances only the pack's own", async () => {
    const created = await installMembershipV1(dependentMembershipPackV1Json());
    // Three of its own plus the three the declared dependency contributes.
    expect(created.allowedEntryIds).toEqual([...V1_MEMBERS, ...SCAFFOLD_MEMBERS].sort());

    await importPack(dependentMembershipPackV2Json());

    expect(await membershipOf()).toEqual([...V2_MEMBERS, ...SCAFFOLD_MEMBERS].sort());
    await expect(harness.database.rulesetProfiles.get(`ruleset:${SCAFFOLD_PACK_ID}`)).resolves.toBeUndefined();
  });

  it("rolls the membership back with the content when the import fails after writing", async () => {
    const created = await installMembershipV1();

    /*
     * Cancellation that lands after the write rather than before it. The pack
     * row is written first, so aborting from its own write hook puts the failure
     * strictly between the content write and the end of the transaction, which
     * is the only window in which a profile change could survive a rolled-back
     * import.
     */
    const controller = new AbortController();
    const abortOnWrite = () => controller.abort();
    harness.database.contentPacks.hook("updating", abortOnWrite);
    try {
      const preview = await harness.install.preview([membershipPackV2Json()]);
      const outcome = await harness.install.confirm(preview, { signal: controller.signal });
      expect(outcome.status).toBe("conflict");
    } finally {
      harness.database.contentPacks.hook("updating").unsubscribe(abortOnWrite);
    }

    await expect(harness.database.contentPacks.get(MEMBERSHIP_PACK_ID)).resolves.toMatchObject({ version: "1.0.0" });
    await expect(harness.database.contentEntries.get(MEMBERSHIP_V2_ADDED_IDS.species)).resolves.toBeUndefined();
    expect(await membershipOf()).toEqual(V1_MEMBERS);
    await expect(harness.database.rulesetProfiles.get(MEMBERSHIP_RULESET_ID)).resolves.toMatchObject({
      updatedAt: created.updatedAt,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* A device that already took the newer pack is repaired in place              */
/* -------------------------------------------------------------------------- */

/**
 * The reported device state, reconstructed exactly: the pack is installed at
 * version 2 with all five entries, and its profile is still scoped to the three
 * it was created with. Written directly, because no supported operation produces
 * it any more — that is the point of the repair.
 */
async function staleInstallation(): Promise<RulesetProfile> {
  const created = await installMembershipV1();
  await importPack(membershipPackV2Json());
  const stale: RulesetProfile = {
    ...created,
    allowedEntryIds: [...V1_MEMBERS],
    disallowedEntryIds: [],
    updatedAt: created.updatedAt,
  };
  await harness.database.rulesetProfiles.put(stale);
  return stale;
}

describe("repairing a device that already imported the newer pack", () => {
  it("brings a 3-member profile up to the installed pack's 5 members", async () => {
    const stale = await staleInstallation();
    expect(stale.allowedEntryIds).toHaveLength(3);
    await expect(harness.database.contentPacks.get(MEMBERSHIP_PACK_ID)).resolves.toMatchObject({ version: "1.1.0" });
    const profilesBefore = await profileCount();

    const repairs = await harness.install.reconcileInstalledRulesets();

    expect(repairs).toEqual([
      {
        rulesetId: MEMBERSHIP_RULESET_ID,
        packId: MEMBERSHIP_PACK_ID,
        previousEntryCount: 3,
        entryCount: 5,
        addedEntryCount: 2,
        removedEntryCount: 0,
        // Version 2's new feat is the first entry of its category the profile
        // reaches, so the repair widens the category filter as well as the
        // membership. Reported, because it is the half a source-scoped profile
        // gets on its own.
        addedCategories: ["feat"],
      },
    ]);
    expect(await membershipOf()).toEqual(V2_MEMBERS);
    await expect(profileCount()).resolves.toBe(profilesBefore);

    const repaired = await harness.database.rulesetProfiles.get(MEMBERSHIP_RULESET_ID);
    expect(repaired?.createdAt).toBe(stale.createdAt);
    expect(repaired?.name).toBe(stale.name);
    // No pack was reinstalled or rolled back to make this possible.
    await expect(harness.database.contentPacks.get(MEMBERSHIP_PACK_ID)).resolves.toMatchObject({ version: "1.1.0" });
  });

  it("is reachable from the ruleset list, and is a no-op the second time", async () => {
    await staleInstallation();

    const first = await harness.install.inspectInstalledRulesets();
    expect(first.repaired).toHaveLength(1);
    expect(first.views.find(view => view.id === MEMBERSHIP_RULESET_ID)?.entryCount).toBe(5);
    const afterFirst = await harness.database.rulesetProfiles.get(MEMBERSHIP_RULESET_ID);

    const second = await harness.install.inspectInstalledRulesets();
    expect(second.repaired).toEqual([]);
    await expect(harness.database.rulesetProfiles.get(MEMBERSHIP_RULESET_ID)).resolves.toEqual(afterFirst);
  });

  it("leaves the active selection and every other profile alone", async () => {
    await staleInstallation();
    expectOk(await harness.install.activate(SYNTHETIC_RULESET_ID));
    const others = await harness.database.rulesetProfiles.get(SYNTHETIC_RULESET_ID);

    await harness.install.reconcileInstalledRulesets();

    await expect(harness.install.activeRulesetId()).resolves.toBe(SYNTHETIC_RULESET_ID);
    // A source-scoped profile is not stale and is not converted to an explicit
    // one: it already sees everything its sources publish.
    await expect(harness.database.rulesetProfiles.get(SYNTHETIC_RULESET_ID)).resolves.toEqual(others);
    expect(others?.allowedEntryIds).toBeUndefined();
  });

  it("does not widen a profile whose pack was never updated", async () => {
    await installMembershipV1();
    await importPack(sourceSharingPackJson());

    await expect(harness.install.reconcileInstalledRulesets()).resolves.toEqual([]);
    expect(await membershipOf()).toEqual(V1_MEMBERS);
  });
});

/* -------------------------------------------------------------------------- */
/* An existing character keeps its ruleset and gains the new content           */
/* -------------------------------------------------------------------------- */

/** A level 1 build in the acceptance ruleset with every reachable answer given. */
const LEVEL_ONE_BUILD: Partial<CharacterDraftBuild> = {
  name: "Wren Halloway",
  level: 1,
  classId: ACCEPTANCE_IDS.class,
  speciesId: ACCEPTANCE_IDS.species,
  backgroundId: ACCEPTANCE_IDS.background,
  abilityMethod: "standard-array",
  abilityBaseScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
  abilityIncreases: { strength: 2, wisdom: 1 },
  abilityScores: { strength: 17, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 11, charisma: 8 },
  choiceSelections: {
    [ACCEPTANCE_CHOICES.classSkills]: [
      `option:${ACCEPTANCE_PROFICIENCIES.skillLedgerwork}`,
      `option:${ACCEPTANCE_PROFICIENCIES.skillStonecraft}`,
    ],
    [ACCEPTANCE_CHOICES.speciesTrait]: [`option:${ACCEPTANCE_PROFICIENCIES.skillCairnlore}`],
  },
  equipmentSelections: {
    [ACCEPTANCE_BUNDLES.classChoice]: ["equipment-option:eb-ledger-case"],
    [ACCEPTANCE_BUNDLES.backgroundChoice]: ["equipment-option:eb-ink-set"],
  },
};

async function commitAcceptanceCharacter(): Promise<CommitResult> {
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({
      draftId: "draft:membership",
      rulesetProfileId: ACCEPTANCE_RULESET_ID,
      level: 1,
      presentation: "guided",
    }),
  );
  const draft = expectOk<DraftSnapshot>(
    await harness.drafts.update({
      draftId: created.draft.id,
      expectedRevision: created.revision,
      patch: LEVEL_ONE_BUILD,
      lastStepId: "review",
    }),
  );
  return expectOk<CommitResult>(
    await harness.commit.commit({
      operationId: "operation:membership-1",
      draftId: draft.draft.id,
      expectedDraftRevision: draft.revision,
      characterId: "character:membership",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    }),
  );
}

describe("a character built before the update", () => {
  it("keeps its ruleset ID and resolves the newly installed entries at once", async () => {
    await importPack(acceptancePackJson(), { createRulesetForPackId: ACCEPTANCE_PACK_ID });
    const committed = await commitAcceptanceCharacter();
    const before = await harness.database.characters.get(committed.characterId);
    expect(before?.rulesetProfileId).toBe(ACCEPTANCE_RULESET_ID);

    await importPack(acceptancePackWithAdditionJson());

    // Same profile, same reference, larger membership.
    const after = await harness.database.characters.get(committed.characterId);
    expect(after?.rulesetProfileId).toBe(ACCEPTANCE_RULESET_ID);
    const scoped = await harness.query.contentForRuleset(ACCEPTANCE_RULESET_ID);
    expect(scoped.map(entry => entry.id)).toContain(ACCEPTANCE_ADDED_IDS.species);
    expect(scoped.map(entry => entry.id)).toContain(ACCEPTANCE_ADDED_IDS.feat);
    // The sheet still resolves against that ruleset.
    await expect(harness.query.sheet(committed.characterId)).resolves.toMatchObject({ name: "Wren Halloway" });
  });

  it("lets a new build in the same ruleset select and commit the new origin", async () => {
    await importPack(acceptancePackJson(), { createRulesetForPackId: ACCEPTANCE_PACK_ID });
    await commitAcceptanceCharacter();
    await importPack(acceptancePackWithAdditionJson());

    const created = expectOk<DraftSnapshot>(
      await harness.drafts.create({
        draftId: "draft:after-update",
        rulesetProfileId: ACCEPTANCE_RULESET_ID,
        level: 1,
        presentation: "guided",
      }),
    );
    const draft = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: created.draft.id,
        expectedRevision: created.revision,
        patch: {
          ...LEVEL_ONE_BUILD,
          name: "Sedge Marrick",
          // The origin that only exists because the pack was updated. Its own
          // trait choice does not apply, so only the class choice remains.
          speciesId: ACCEPTANCE_ADDED_IDS.species,
          choiceSelections: {
            [ACCEPTANCE_CHOICES.classSkills]: [
              `option:${ACCEPTANCE_PROFICIENCIES.skillLedgerwork}`,
              `option:${ACCEPTANCE_PROFICIENCIES.skillStonecraft}`,
            ],
          },
        },
        lastStepId: "review",
      }),
    );
    expect(draft.plan.steps.flatMap(step => step.issues.map(issue => issue.code))).toEqual([]);

    const committed = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "operation:membership-2",
        draftId: draft.draft.id,
        expectedDraftRevision: draft.revision,
        characterId: "character:after-update",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );
    await expect(harness.database.characters.get(committed.characterId)).resolves.toMatchObject({
      rulesetProfileId: ACCEPTANCE_RULESET_ID,
      speciesId: ACCEPTANCE_ADDED_IDS.species,
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The rules the repair is built on, stated directly                          */
/* -------------------------------------------------------------------------- */

describe("membership reconciliation as a value", () => {
  const proposal = (entryIds: readonly ID[]) =>
    proposeRulesetForPack(
      { id: MEMBERSHIP_PACK_ID, name: "Membership", sourceIds: ["source:one"] },
      entryIds.map(id => ({ id, sourceId: "source:one", category: "feat" }) as never),
    );

  const profile = (overrides: Partial<RulesetProfile> = {}): RulesetProfile => ({
    id: MEMBERSHIP_RULESET_ID,
    name: "Membership",
    activeSourceIds: ["source:one"],
    allowedEntryIds: ["feat:a", "feat:b"],
    editionPriority: [],
    allowedCategories: ["feat"],
    allowLegacy: false,
    allowDuplicateVersions: false,
    conflictResolution: "source-priority",
    allowCustomOverrides: true,
    requirementEnforcement: "soft",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  });

  it("reports no change, and keeps updatedAt, when the membership already matches", () => {
    const update = reconcileRulesetMembership(profile(), proposal(["feat:a", "feat:b"]), "2026-09-01T00:00:00.000Z");
    expect(update?.changed).toBe(false);
    expect(update?.profile.updatedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("preserves user exclusions and every policy field while advancing membership", () => {
    const existing = profile({ disallowedEntryIds: ["feat:b"], requirementEnforcement: "hard", name: "Renamed by hand" });
    const update = reconcileRulesetMembership(
      existing,
      proposal(["feat:a", "feat:b", "feat:c"]),
      "2026-09-01T00:00:00.000Z",
    );
    expect(update?.changed).toBe(true);
    expect(update?.profile.allowedEntryIds).toEqual(["feat:a", "feat:b", "feat:c"]);
    expect(update?.profile.disallowedEntryIds).toEqual(["feat:b"]);
    expect(update?.profile.requirementEnforcement).toBe("hard");
    expect(update?.profile.name).toBe("Renamed by hand");
    expect(update?.addedEntryIds).toEqual(["feat:c"]);
    expect(update?.removedEntryIds).toEqual([]);
  });

  /**
   * A source-scoped profile is never narrowed to an explicit set.
   *
   * It used to be declined outright. It is now advanced in the one respect that
   * a source scope does not already cover — the category filter layered on top
   * of it — and `tests/spell-category-reachability` states that half. What has
   * not changed, and is the point here, is that no `allowedEntryIds` is written:
   * replacing "everything from these sources" with a snapshot of one pack's
   * entries would silently drop everything else the profile reaches.
   */
  it("never narrows a source-scoped profile to an explicit set", () => {
    const sourceScoped = profile();
    delete sourceScoped.allowedEntryIds;
    const update = reconcileRulesetMembership(sourceScoped, proposal(["feat:a"]), "2026-09-01T00:00:00.000Z");
    expect(update?.profile.allowedEntryIds).toBeUndefined();
    expect(update?.addedEntryIds).toEqual([]);
    expect(update?.removedEntryIds).toEqual([]);
  });

  it("attributes a profile ID to a pack only when no other pack could claim it", () => {
    // `pack:x` also maps to the ID an earlier derivation produced for it, which
    // is the ID `x` maps to today. Neither may claim it.
    const ownership = rulesetProfileOwnership(["pack:x", "x", "pack:y"]);
    expect(ownership.get("ruleset:pack:x")).toBe("pack:x");
    expect(ownership.get("ruleset:x")).toBeUndefined();
    expect(ownership.get("ruleset:pack:y")).toBe("pack:y");
    expect(ownership.get("ruleset:y")).toBe("pack:y");
  });
});
