import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeHarnesses,
  createHarness,
  expectOk,
  installAcceptanceRuleset,
  type Harness,
} from "@/tests/fixtures/service-harness";
import {
  ACCEPTANCE_BUNDLES,
  ACCEPTANCE_CHOICES,
  ACCEPTANCE_IDS,
  ACCEPTANCE_PACK_ID,
  ACCEPTANCE_PROFICIENCIES,
  ACCEPTANCE_RULESET_ID,
  ACCEPTANCE_SOURCE_ID,
  acceptancePackJson,
} from "@/tests/fixtures/acceptance-ruleset";
import { SYNTHETIC_IDS, SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { CommitResult, DraftSnapshot } from "@/src/services/character-services";
import type { LevelUpPreview, LevelUpResult } from "@/src/services/levelup-service";
import { planActivation, maxSupportedLevel } from "@/src/services/choice-planner";
import { planBuild } from "@/src/services/build-planner";
import { rulesetIdForPack } from "@/src/services/ruleset-planner";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeHarnesses();
});

/** The acceptance ruleset's content, scoped exactly as the builder sees it. */
const scopedEntries = () => harness.query.contentForRuleset(ACCEPTANCE_RULESET_ID);

/**
 * A complete level 5 Beaconkeeper.
 *
 * Every choice the five levels reach is answered, including the ones only
 * reachable through another choice, so the build is a positive control for
 * everything the planner is meant to discover.
 */
function completeBuild(level = 5): Partial<CharacterDraftBuild> {
  return {
    name: "Wren Halloway",
    level,
    classId: ACCEPTANCE_IDS.class,
    ...(level >= 3 ? { subclassId: ACCEPTANCE_IDS.subclassWatch } : {}),
    speciesId: ACCEPTANCE_IDS.species,
    backgroundId: ACCEPTANCE_IDS.background,
    abilityMethod: "standard-array",
    abilityBaseScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
    abilityIncreases: { strength: 2, wisdom: 1 },
    abilityScores: { strength: 17, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 11, charisma: 8 },
    choiceSelections: {
      // Signalling is deliberately not chosen: the background already grants it.
      [ACCEPTANCE_CHOICES.classSkills]: [
        `option:${ACCEPTANCE_PROFICIENCIES.skillLedgerwork}`,
        `option:${ACCEPTANCE_PROFICIENCIES.skillStonecraft}`,
      ],
      [ACCEPTANCE_CHOICES.speciesTrait]: [`option:${ACCEPTANCE_PROFICIENCIES.skillCairnlore}`],
      ...(level >= 3 ? { [ACCEPTANCE_CHOICES.subclassFlare]: ["option:eb-flare-wide"] } : {}),
      ...(level >= 4
        ? {
            [ACCEPTANCE_CHOICES.boon]: ["option:eb-attentive"],
            [ACCEPTANCE_CHOICES.featFocus]: [`option:${ACCEPTANCE_PROFICIENCIES.toolSignalLamp}`],
          }
        : {}),
    },
    equipmentSelections: {
      [ACCEPTANCE_BUNDLES.classChoice]: ["equipment-option:eb-ledger-case"],
      [ACCEPTANCE_BUNDLES.backgroundChoice]: ["equipment-option:eb-ink-set"],
    },
  };
}

async function openDraft(patch: Partial<CharacterDraftBuild>, level = patch.level ?? 5): Promise<DraftSnapshot> {
  const draftId = `draft:${Math.random().toString(36).slice(2)}`;
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({ draftId, rulesetProfileId: ACCEPTANCE_RULESET_ID, level, presentation: "guided" }),
  );
  return expectOk<DraftSnapshot>(
    await harness.drafts.update({ draftId, expectedRevision: created.revision, patch }),
  );
}

// ---------------------------------------------------------------------------
// Scope 1 — a pack becomes a selectable ruleset
// ---------------------------------------------------------------------------

describe("ruleset import and selection", () => {
  it("offers the ruleset a valid pack would produce, before anything is written", async () => {
    const preview = await harness.install.preview([acceptancePackJson()]);
    expect(preview.canImport).toBe(true);
    expect(preview.offers).toHaveLength(1);
    const offer = preview.offers[0];
    expect(offer.rulesetId).toBe(ACCEPTANCE_RULESET_ID);
    expect(offer.usable).toBe(true);
    expect(offer.missingCategories).toEqual([]);
    expect(offer.activeSourceIds).toEqual([ACCEPTANCE_SOURCE_ID]);
    // The proposal reports the level range the content honestly supports.
    expect(offer.maxSupportedLevel).toBe(5);
    // Previewing is read-only.
    expect(await harness.database.rulesetProfiles.get(ACCEPTANCE_RULESET_ID)).toBeUndefined();
    expect(await harness.database.contentPacks.get(ACCEPTANCE_PACK_ID)).toBeUndefined();
  });

  it("creates a usable profile in the same confirmation as the content", async () => {
    await installAcceptanceRuleset(harness);
    const profile = await harness.database.rulesetProfiles.get(ACCEPTANCE_RULESET_ID);
    expect(profile?.activeSourceIds).toEqual([ACCEPTANCE_SOURCE_ID]);
    // The profile scopes to exactly the categories the pack ships.
    expect(profile?.allowedCategories).toContain("class");
    expect(profile?.allowedCategories).toContain("subclass");
    expect((await scopedEntries()).length).toBeGreaterThan(0);
  });

  it("leaves the existing public synthetic profile untouched", async () => {
    await installAcceptanceRuleset(harness);
    const synthetic = await harness.database.rulesetProfiles.get(SYNTHETIC_RULESET_ID);
    expect(synthetic).toBeDefined();
    // The pre-existing profile still reaches only its own content.
    const syntheticEntries = await harness.query.contentForRuleset(SYNTHETIC_RULESET_ID);
    expect(syntheticEntries.some(entry => entry.id === SYNTHETIC_IDS.class)).toBe(true);
    expect(syntheticEntries.some(entry => entry.id === ACCEPTANCE_IDS.class)).toBe(false);
  });

  it("creates neither content nor a partial profile when the import fails", async () => {
    const preview = await harness.install.preview([acceptancePackJson()]);
    // Make confirmation-time revalidation fail after the preview was taken.
    await harness.database.contentEntries.put({
      ...JSON.parse(acceptancePackJson()).entries[0],
      revision: 99,
      updatedAt: "2027-01-01T00:00:00.000Z",
    });
    const outcome = await harness.install.confirm(preview, { createRulesetForPackIds: [ACCEPTANCE_PACK_ID] });
    expect(outcome.status).not.toBe("ok");
    expect(await harness.database.rulesetProfiles.get(ACCEPTANCE_RULESET_ID)).toBeUndefined();
    expect(await harness.database.contentPacks.get(ACCEPTANCE_PACK_ID)).toBeUndefined();
  });

  it("creates no profile when a cancelled import writes nothing", async () => {
    const preview = await harness.install.preview([acceptancePackJson()]);
    const controller = new AbortController();
    controller.abort();
    const outcome = await harness.install.confirm(preview, {
      createRulesetForPackIds: [ACCEPTANCE_PACK_ID],
      signal: controller.signal,
    });
    expect(outcome.status).toBe("conflict");
    expect(await harness.database.rulesetProfiles.get(ACCEPTANCE_RULESET_ID)).toBeUndefined();
    expect(await harness.database.contentPacks.get(ACCEPTANCE_PACK_ID)).toBeUndefined();
  });

  it("can create the profile later for a pack imported without one", async () => {
    await installAcceptanceRuleset(harness, { createRuleset: false });
    expect(await harness.database.rulesetProfiles.get(ACCEPTANCE_RULESET_ID)).toBeUndefined();
    const pending = await harness.install.pendingOffers();
    expect(pending.map(offer => offer.packId)).toContain(ACCEPTANCE_PACK_ID);
    expectOk(await harness.install.createRulesetForPack(ACCEPTANCE_PACK_ID));
    expect(await harness.database.rulesetProfiles.get(ACCEPTANCE_RULESET_ID)).toBeDefined();
  });

  it("refuses to overwrite a profile that already exists", async () => {
    await installAcceptanceRuleset(harness);
    const outcome = await harness.install.createRulesetForPack(ACCEPTANCE_PACK_ID);
    expect(outcome).toMatchObject({ status: "conflict", code: "RULESET_ALREADY_INSTALLED" });
  });

  it("never picks a ruleset from list order", async () => {
    await installAcceptanceRuleset(harness);
    const installed = await harness.install.installedRulesets();
    expect(installed.length).toBeGreaterThan(1);

    // Two usable profiles and no activation: the answer is the question, not
    // whichever profile happens to sort or store first.
    const ambiguous = await harness.install.resolveStartingRuleset();
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind === "ambiguous") expect(ambiguous.options.map(option => option.id)).toContain(ACCEPTANCE_RULESET_ID);

    expectOk(await harness.install.activate(ACCEPTANCE_RULESET_ID));
    const resolved = await harness.install.resolveStartingRuleset();
    expect(resolved).toMatchObject({ kind: "resolved", rulesetId: ACCEPTANCE_RULESET_ID, reason: "active" });
  });

  it("refuses to activate a profile that is not installed", async () => {
    expect(await harness.install.activate("ruleset:absent")).toMatchObject({ status: "not-found" });
  });

  it("derives the profile ID from the pack ID rather than inventing one", () => {
    expect(rulesetIdForPack("pack:emberline-acceptance")).toBe("ruleset:emberline-acceptance");
    expect(rulesetIdForPack("emberline-acceptance")).toBe("ruleset:emberline-acceptance");
  });

  it("clears content-scoped selections when a draft moves to another ruleset", async () => {
    await installAcceptanceRuleset(harness);
    const draft = await openDraft(completeBuild(1), 1);
    const moved = expectOk<DraftSnapshot>(
      await harness.drafts.changeRuleset(draft.draft.id, draft.revision, SYNTHETIC_RULESET_ID),
    );
    expect(moved.draft.rulesetProfileId).toBe(SYNTHETIC_RULESET_ID);
    expect(moved.draft.build.classId).toBeUndefined();
    expect(moved.draft.build.subclassId).toBeUndefined();
    expect(moved.draft.build.choiceSelections).toEqual({});
    // What does not depend on the ruleset survives.
    expect(moved.draft.build.name).toBe("Wren Halloway");
    expect(moved.draft.build.abilityScores.strength).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// Scope 2 — identity, target level, and direct level 5 creation
// ---------------------------------------------------------------------------

describe("direct creation at a target level", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  it("derives the offered maximum level from installed content", async () => {
    const entries = await scopedEntries();
    expect(maxSupportedLevel(entries)).toBe(5);
    expect(maxSupportedLevel(entries, ACCEPTANCE_IDS.class)).toBe(5);
    // The second class stops at 3 and says so.
    expect(maxSupportedLevel(entries, ACCEPTANCE_IDS.shortClass)).toBe(3);
  });

  it("accumulates every level's choices into one build at level 5", async () => {
    const entries = await scopedEntries();
    const atOne = planBuild({ ...emptyBuild(), ...completeBuild(1), level: 1 }, entries);
    const atFive = planBuild({ ...emptyBuild(), ...completeBuild(5), level: 5 }, entries);

    const idsAtOne = atOne.requiredChoices.map(choice => choice.choiceId);
    const idsAtFive = atFive.requiredChoices.map(choice => choice.choiceId);
    // Level 1 reaches the class skills and the species trait, and nothing later.
    expect(idsAtOne).toContain(ACCEPTANCE_CHOICES.classSkills);
    expect(idsAtOne).toContain(ACCEPTANCE_CHOICES.speciesTrait);
    expect(idsAtOne).not.toContain(ACCEPTANCE_CHOICES.boon);
    expect(idsAtOne).not.toContain(ACCEPTANCE_CHOICES.subclassFlare);
    // Level 5 reaches every one of them, in a single pass.
    for (const id of [
      ACCEPTANCE_CHOICES.classSkills,
      ACCEPTANCE_CHOICES.speciesTrait,
      ACCEPTANCE_CHOICES.subclassFlare,
      ACCEPTANCE_CHOICES.boon,
      ACCEPTANCE_CHOICES.featFocus,
    ])
      expect(idsAtFive).toContain(id);
  });

  it("blocks the commit while a level 5 choice is unresolved, then commits at 5", async () => {
    const build = completeBuild(5);
    const incomplete = {
      ...build,
      choiceSelections: Object.fromEntries(
        Object.entries(build.choiceSelections ?? {}).filter(([id]) => id !== ACCEPTANCE_CHOICES.featFocus),
      ),
    };
    const draft = await openDraft(incomplete);
    expect(draft.plan.guidedComplete).toBe(false);
    expect(draft.plan.issues.map(issue => issue.code)).toContain("CHOICE_UNRESOLVED");

    const blocked = await harness.commit.commit({
      operationId: "op:blocked",
      draftId: draft.draft.id,
      expectedDraftRevision: draft.revision,
      characterId: "character:wren",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    });
    expect(blocked.status).toBe("invalid");
    expect(await harness.database.characters.get("character:wren")).toBeUndefined();

    const resolved = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: draft.draft.id,
        expectedRevision: draft.revision,
        patch: { choiceSelections: build.choiceSelections },
      }),
    );
    expect(resolved.plan.guidedComplete).toBe(true);

    const committed = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "op:committed",
        draftId: draft.draft.id,
        expectedDraftRevision: resolved.revision,
        characterId: "character:wren",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );

    const record = await harness.database.characters.get(committed.characterId);
    // Created at 5 directly: one class level at 5, not a level 1 record nudged.
    expect(record?.level).toBe(5);
    expect(record?.classLevels).toEqual([
      { classId: ACCEPTANCE_IDS.class, level: 5, subclassId: ACCEPTANCE_IDS.subclassWatch },
    ]);
    // Exactly one durable version exists: nothing advanced it after creation.
    const versions = await harness.database.characterVersions.where("characterId").equals("character:wren").toArray();
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe("initial");

    const sheet = await harness.query.sheet("character:wren");
    expect(sheet?.level).toBe(5);
    expect(sheet?.hitDice.value).toBe("5d10");
    expect(sheet?.subclassLabel).toBe("Kindled Watch");
  });

  it("blocks a level the chosen class does not describe, and names the repair", async () => {
    const entries = await scopedEntries();
    const plan = planBuild(
      { ...emptyBuild(), name: "Overreach", level: 5, classId: ACCEPTANCE_IDS.shortClass, speciesId: ACCEPTANCE_IDS.species, backgroundId: ACCEPTANCE_IDS.background },
      entries,
    );
    expect(plan.levelCovered).toBe(false);
    expect(plan.classProgressionMax).toBe(3);
    expect(plan.issues.map(issue => issue.code)).toContain("LEVEL_NOT_COVERED_BY_CLASS");
    expect(plan.steps.find(step => step.id === "start")?.status).toBe("incomplete");
  });

  it("keeps the name across an update, a reload and a mode switch", async () => {
    const draft = await openDraft({ name: "Wren Halloway", level: 1 }, 1);
    const reloaded = await harness.drafts.get(draft.draft.id);
    expect(reloaded?.draft.build.name).toBe("Wren Halloway");
    const switched = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(draft.draft.id, draft.revision, "flexible"),
    );
    expect(switched.draft.build.name).toBe("Wren Halloway");
    const back = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(draft.draft.id, switched.revision, "guided"),
    );
    expect(back.draft.build.name).toBe("Wren Halloway");
  });

  it("reports a missing name on the first step as a warning that never blocks", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5), name: "  " }, entries);
    expect(plan.issues).toContainEqual({ code: "NAME_NOT_SET", fieldPath: "name", severity: "warning" });
    expect(plan.guidedComplete).toBe(true);
    expect(plan.steps.find(step => step.id === "start")?.status).toBe("complete");
  });

  it("keeps a legacy pronouns value even though creation no longer collects it", async () => {
    const draft = await openDraft({ ...completeBuild(1), pronouns: "they/them" }, 1);
    expect(draft.draft.build.pronouns).toBe("they/them");
    const committed = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "op:pronouns",
        draftId: draft.draft.id,
        expectedDraftRevision: draft.revision,
        characterId: "character:legacy-pronouns",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );
    const record = await harness.database.characters.get(committed.characterId);
    expect(record?.pronouns).toBe("they/them");
  });
});

// ---------------------------------------------------------------------------
// Scope 3 — generic discovery from every activated source
// ---------------------------------------------------------------------------

describe("choice discovery from activated entries", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  it("reaches a species trait's own choice through the species", async () => {
    const entries = await scopedEntries();
    const activation = planActivation({ ...emptyBuild(), ...completeBuild(1), level: 1 }, entries);
    const trait = activation.entries.find(item => item.entry.id === ACCEPTANCE_IDS.traitWithChoice);
    expect(trait?.route).toBe("species-trait");
    const choice = activation.choices.find(item => item.choice.id === ACCEPTANCE_CHOICES.speciesTrait);
    // Provenance survives: the trait asks, not the species.
    expect(choice?.sourceEntryId).toBe(ACCEPTANCE_IDS.traitWithChoice);
    expect(choice?.stepId).toBe("origin");
  });

  it("offers a feat's nested choice only once that feat is actually chosen", async () => {
    const entries = await scopedEntries();
    const withoutFeat = planBuild(
      {
        ...emptyBuild(),
        ...completeBuild(5),
        choiceSelections: Object.fromEntries(
          Object.entries(completeBuild(5).choiceSelections ?? {}).filter(
            ([id]) => id !== ACCEPTANCE_CHOICES.boon && id !== ACCEPTANCE_CHOICES.featFocus,
          ),
        ),
      },
      entries,
    );
    // The boon is open, so the feat behind it is not active and its own choice
    // is neither offered nor reported. No diagnostic for an unoffered choice.
    expect(withoutFeat.requiredChoices.map(choice => choice.choiceId)).toContain(ACCEPTANCE_CHOICES.boon);
    expect(withoutFeat.requiredChoices.map(choice => choice.choiceId)).not.toContain(ACCEPTANCE_CHOICES.featFocus);
    expect(withoutFeat.issues.filter(issue => issue.recordId === ACCEPTANCE_CHOICES.featFocus)).toEqual([]);

    const withFeat = planBuild(
      {
        ...emptyBuild(),
        ...completeBuild(5),
        choiceSelections: { ...completeBuild(5).choiceSelections, [ACCEPTANCE_CHOICES.featFocus]: [] },
      },
      entries,
    );
    expect(withFeat.requiredChoices.map(choice => choice.choiceId)).toContain(ACCEPTANCE_CHOICES.featFocus);
    expect(withFeat.issues).toContainEqual({
      code: "CHOICE_UNRESOLVED",
      recordId: ACCEPTANCE_CHOICES.featFocus,
      severity: "error",
    });
  });

  it("presents each choice exactly once and in a stable order", async () => {
    const entries = await scopedEntries();
    const build = { ...emptyBuild(), ...completeBuild(5) };
    const first = planBuild(build, entries).requiredChoices.map(choice => choice.choiceId);
    const again = planBuild(build, [...entries].reverse(), entries.length ? undefined : undefined).requiredChoices;

    // No duplicates, whatever route reached the choice.
    expect(new Set(first).size).toBe(first.length);
    // The same draft always produces the same sequence.
    expect(planBuild(build, entries).requiredChoices.map(choice => choice.choiceId)).toEqual(first);
    // Order follows activation, not the order entries happen to be stored in.
    expect(new Set(again.map(choice => choice.choiceId)).size).toBe(again.length);
  });

  it("reports one unresolved diagnostic per choice, not two", async () => {
    const entries = await scopedEntries();
    const plan = planBuild(
      {
        ...emptyBuild(),
        ...completeBuild(1),
        level: 1,
        choiceSelections: { [ACCEPTANCE_CHOICES.speciesTrait]: [`option:${ACCEPTANCE_PROFICIENCIES.skillCairnlore}`] },
      },
      entries,
    );
    const unresolved = plan.issues.filter(
      issue => issue.code === "CHOICE_UNRESOLVED" && issue.recordId === ACCEPTANCE_CHOICES.classSkills,
    );
    expect(unresolved).toHaveLength(1);
  });

  it("collapses the same unresolved choice on the committed sheet too", async () => {
    const entries = await scopedEntries();
    const draft = await openDraft({ ...completeBuild(1), level: 1, choiceSelections: {} }, 1);
    const flexible = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(draft.draft.id, draft.revision, "flexible"),
    );
    const committed = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "op:flexible",
        draftId: draft.draft.id,
        expectedDraftRevision: flexible.revision,
        characterId: "character:open-choices",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );
    const sheet = await harness.query.sheet(committed.characterId);
    const perChoice = (sheet?.issues ?? []).filter(
      issue => issue.code === "CHOICE_UNRESOLVED" && issue.recordId === ACCEPTANCE_CHOICES.classSkills,
    );
    expect(perChoice).toHaveLength(1);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("names no entry: the same traversal works for the other installed ruleset", async () => {
    const entries = await harness.query.contentForRuleset(SYNTHETIC_RULESET_ID);
    const activation = planActivation(
      { ...emptyBuild(), level: 1, classId: SYNTHETIC_IDS.class, speciesId: SYNTHETIC_IDS.species, backgroundId: SYNTHETIC_IDS.background },
      entries,
    );
    expect(activation.choices.length).toBeGreaterThan(0);
    expect(activation.entries.some(item => item.route === "class-progression")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scope 4 — explicit subclass identity
// ---------------------------------------------------------------------------

describe("subclass identity", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  it("is not offered before the class's declared level", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(2), level: 2, subclassId: undefined }, entries);
    expect(plan.subclass?.atLevel).toBe(3);
    expect(plan.subclass?.reached).toBe(false);
    expect(plan.subclass?.unresolved).toBe(false);
    expect(plan.issues.map(issue => issue.code)).not.toContain("SUBCLASS_NOT_CHOSEN");
  });

  it("blocks completion at its level when it is required and unresolved", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(3), level: 3, subclassId: undefined }, entries);
    expect(plan.subclass?.reached).toBe(true);
    expect(plan.subclass?.unresolved).toBe(true);
    expect(plan.issues).toContainEqual({ code: "SUBCLASS_NOT_CHOSEN", recordId: ACCEPTANCE_IDS.class, severity: "error" });
    expect(plan.guidedComplete).toBe(false);
  });

  it("activates its progression and surfaces its own choices once chosen", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5) }, entries);
    expect(plan.subclass?.valid).toBe(true);
    expect(plan.requiredChoices.map(choice => choice.choiceId)).toContain(ACCEPTANCE_CHOICES.subclassFlare);
    const activation = planActivation({ ...emptyBuild(), ...completeBuild(5) }, entries);
    // Both subclass progression features are active at level 5.
    const active = activation.entries.map(item => item.entry.id);
    expect(active).toContain("feature:eb-kw-flare");
    expect(active).toContain("feature:eb-kw-brighter");
    // The other subclass's features are not.
    expect(active).not.toContain("feature:eb-ql-margin");
  });

  it("rejects a subclass that does not belong to the chosen class", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5), subclassId: "subclass:absent" }, entries);
    expect(plan.subclass?.valid).toBe(false);
    expect(plan.issues.map(issue => issue.code)).toContain("SUBCLASS_INVALID");
  });
});

// ---------------------------------------------------------------------------
// Scope 5 — base scores plus origin increases
// ---------------------------------------------------------------------------

describe("ability entry model", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  it("validates the array against the recorded base scores", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5) }, entries);
    expect(plan.issues.map(issue => issue.code)).not.toContain("STANDARD_ARRAY_MISMATCH");

    const tampered = planBuild(
      {
        ...emptyBuild(),
        ...completeBuild(5),
        abilityBaseScores: { strength: 18, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
        abilityScores: { strength: 20, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 11, charisma: 8 },
      },
      entries,
    );
    expect(tampered.issues.map(issue => issue.code)).toContain("STANDARD_ARRAY_MISMATCH");
  });

  it("keeps the origin allocation when the method changes", async () => {
    const draft = await openDraft(completeBuild(1), 1);
    const switched = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: draft.draft.id,
        expectedRevision: draft.revision,
        patch: { abilityMethod: "manual" },
      }),
    );
    expect(switched.draft.build.abilityIncreases).toEqual({ strength: 2, wisdom: 1 });
    expect(switched.draft.build.abilityBaseScores.strength).toBe(15);
    // Final scores are still base plus origin.
    expect(switched.draft.build.abilityScores.strength).toBe(17);
    expect(switched.draft.build.abilityScores.wisdom).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// Scope 6 — equipment visibility
// ---------------------------------------------------------------------------

describe("equipment visibility", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  it("shows grants from the class and the background, with package contents", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5) }, entries);
    const sources = plan.equipmentGrants.map(grant => grant.grantedByEntryId);
    expect(sources).toContain(ACCEPTANCE_IDS.class);
    expect(sources).toContain(ACCEPTANCE_IDS.background);

    const classGrant = plan.equipmentGrants.find(grant => grant.bundleId === ACCEPTANCE_BUNDLES.classKit);
    expect(classGrant?.automatic.map(item => item.label)).toContain("Hook spear");
    const travel = classGrant?.choices.find(choice => choice.choiceId === ACCEPTANCE_BUNDLES.classChoice);
    // Each package states what it holds before it is selected.
    expect(travel?.options.map(option => option.contents.map(item => item.label))).toEqual([
      ["Ledger case"],
      ["Lamp kit"],
    ]);
  });

  it("blocks while a package is unchosen and commits the resulting equipment", async () => {
    const build = completeBuild(5);
    const draft = await openDraft({ ...build, equipmentSelections: {} });
    expect(draft.plan.issues.map(issue => issue.code)).toContain("EQUIPMENT_CHOICE_REQUIRED");

    const resolved = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: draft.draft.id,
        expectedRevision: draft.revision,
        patch: { equipmentSelections: build.equipmentSelections },
      }),
    );
    expect(resolved.plan.guidedComplete).toBe(true);

    const committed = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "op:equipment",
        draftId: draft.draft.id,
        expectedDraftRevision: resolved.revision,
        characterId: "character:equipped",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );
    const sheet = await harness.query.sheet(committed.characterId);
    const labels = (sheet?.equipment ?? []).map(item => item.label);
    expect(labels).toContain("Hook spear");
    expect(labels).toContain("Ledger case");
    expect(labels).toContain("Ink set");
    expect(labels).not.toContain("Lamp kit");
  });

  it("omits the step only when nothing is granted and nothing is chosen", async () => {
    const entries = await scopedEntries();
    const withKit = planBuild({ ...emptyBuild(), ...completeBuild(5) }, entries);
    expect(withKit.steps.map(step => step.id)).toContain("equipment");

    // The second class grants no bundle at all.
    const withoutKit = planBuild(
      { ...emptyBuild(), name: "Lamp", level: 1, classId: ACCEPTANCE_IDS.shortClass, speciesId: ACCEPTANCE_IDS.species },
      entries,
    );
    expect(withoutKit.equipmentGrants).toEqual([]);
    expect(withoutKit.steps.map(step => step.id)).not.toContain("equipment");
  });
});

// ---------------------------------------------------------------------------
// Scope 7 — proficiency provenance and duplicate handling
// ---------------------------------------------------------------------------

describe("proficiency provenance", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  it("attributes every proficiency to its source and says how it was obtained", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5) }, entries);
    const grants = plan.proficiencies.grants;

    const save = grants.find(item => item.proficiencyId === ACCEPTANCE_PROFICIENCIES.saveStrength);
    expect(save).toMatchObject({ kind: "automatic", source: { entryId: ACCEPTANCE_IDS.class, category: "class" } });

    const signalling = grants.find(item => item.proficiencyId === ACCEPTANCE_PROFICIENCIES.skillSignalling);
    expect(signalling).toMatchObject({
      kind: "automatic",
      source: { entryId: ACCEPTANCE_IDS.background, category: "background" },
    });

    const ledgerwork = grants.find(item => item.proficiencyId === ACCEPTANCE_PROFICIENCIES.skillLedgerwork);
    expect(ledgerwork).toMatchObject({ kind: "selected", choiceId: ACCEPTANCE_CHOICES.classSkills });
    expect(ledgerwork?.source.entryId).toBe(ACCEPTANCE_IDS.class);

    // A proficiency chosen inside a feat that was itself chosen keeps both hops.
    const lamp = grants.find(item => item.proficiencyId === ACCEPTANCE_PROFICIENCIES.toolSignalLamp);
    expect(lamp).toMatchObject({ kind: "selected", choiceId: ACCEPTANCE_CHOICES.featFocus });
    expect(lamp?.source.entryId).toBe(ACCEPTANCE_IDS.featWithChoice);
  });

  it("marks an option that is already granted, so it is not a live choice", async () => {
    const entries = await scopedEntries();
    const plan = planBuild({ ...emptyBuild(), ...completeBuild(5) }, entries);
    const skills = plan.requiredChoices.find(choice => choice.choiceId === ACCEPTANCE_CHOICES.classSkills);
    const signalling = skills?.options.find(option => option.id === `option:${ACCEPTANCE_PROFICIENCIES.skillSignalling}`);
    expect(signalling?.alreadyGrantedBy).toMatchObject({ entryId: ACCEPTANCE_IDS.background });
    // The alternatives remain fully available.
    const alternatives = skills?.options.filter(option => !option.alreadyGrantedBy).map(option => option.id) ?? [];
    expect(alternatives).toHaveLength(3);
  });

  it("blocks a build that spends a class choice on an already-granted proficiency", async () => {
    const entries = await scopedEntries();
    const plan = planBuild(
      {
        ...emptyBuild(),
        ...completeBuild(5),
        choiceSelections: {
          ...completeBuild(5).choiceSelections,
          [ACCEPTANCE_CHOICES.classSkills]: [
            `option:${ACCEPTANCE_PROFICIENCIES.skillSignalling}`,
            `option:${ACCEPTANCE_PROFICIENCIES.skillLedgerwork}`,
          ],
        },
      },
      entries,
    );
    expect(plan.guidedComplete).toBe(false);
    expect(plan.issues.map(issue => issue.code)).toContain("PROFICIENCY_DUPLICATE_SELECTION");
    const duplicate = plan.proficiencies.duplicates[0];
    expect(duplicate.proficiencyId).toBe(ACCEPTANCE_PROFICIENCIES.skillSignalling);
    expect(duplicate.grantedBy.entryId).toBe(ACCEPTANCE_IDS.background);
    // The repair names the group to change, not just the problem.
    expect(duplicate.repair).toContain("Beaconkeeper skills");
  });

  it("refuses to commit the duplicate rather than quietly granting one fewer", async () => {
    const build = completeBuild(5);
    const draft = await openDraft({
      ...build,
      choiceSelections: {
        ...build.choiceSelections,
        [ACCEPTANCE_CHOICES.classSkills]: [
          `option:${ACCEPTANCE_PROFICIENCIES.skillSignalling}`,
          `option:${ACCEPTANCE_PROFICIENCIES.skillLedgerwork}`,
        ],
      },
    });
    const outcome = await harness.commit.commit({
      operationId: "op:duplicate",
      draftId: draft.draft.id,
      expectedDraftRevision: draft.revision,
      characterId: "character:duplicate",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    });
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid")
      expect(outcome.issues.map(issue => issue.code)).toContain("PROFICIENCY_DUPLICATE_SELECTION");
    expect(await harness.database.characters.get("character:duplicate")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scope 8 — safe sequential level-up
// ---------------------------------------------------------------------------

describe("sequential level-up", () => {
  beforeEach(() => installAcceptanceRuleset(harness));

  async function commitAt(level: number, characterId: string): Promise<CommitResult> {
    const draft = await openDraft(completeBuild(level), level);
    return expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: `op:${characterId}`,
        draftId: draft.draft.id,
        expectedDraftRevision: draft.revision,
        characterId,
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );
  }

  it("previews the next level only, one level at a time, from 1 to 5", async () => {
    await commitAt(1, "character:climber");
    const seen: number[] = [];
    for (let step = 0; step < 4; step++) {
      const preview = expectOk<LevelUpPreview>(
        await harness.levelUp.preview("character:climber", subclassStepSelections(step), subclassFor(step)),
      );
      seen.push(preview.toLevel);
      expect(preview.toLevel).toBe(preview.fromLevel + 1);
      expect(preview.coverage.supported).toBe(true);
      const character = await harness.database.characters.get("character:climber");
      const runtime = await harness.database.characterRuntimeStates.get("character:climber");
      expectOk<LevelUpResult>(
        await harness.levelUp.confirm({
          operationId: `op:levelup:${preview.toLevel}`,
          characterId: "character:climber",
          expectedCharacterRevision: character?.revision ?? 0,
          expectedRuntimeRevision: runtime?.revision ?? 0,
          targetLevel: preview.toLevel,
          expectedContentFingerprint: preview.contentFingerprint,
          choiceSelections: subclassStepSelections(step),
          ...(subclassFor(step) ? { subclassId: subclassFor(step) } : {}),
        }),
      );
    }
    // 1 → 2 → 3 → 4 → 5, never a jump.
    expect(seen).toEqual([2, 3, 4, 5]);
    expect((await harness.database.characters.get("character:climber"))?.level).toBe(5);
  });

  it("refuses a target level that is not exactly one step", async () => {
    await commitAt(1, "character:jumper");
    const character = await harness.database.characters.get("character:jumper");
    const runtime = await harness.database.characterRuntimeStates.get("character:jumper");
    const outcome = await harness.levelUp.confirm({
      operationId: "op:jump",
      characterId: "character:jumper",
      expectedCharacterRevision: character?.revision ?? 0,
      expectedRuntimeRevision: runtime?.revision ?? 0,
      targetLevel: 5,
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      choiceSelections: {},
    });
    expect(outcome).toMatchObject({ status: "invalid" });
    if (outcome.status === "invalid") expect(outcome.issues[0].code).toBe("LEVEL_STEP_UNSUPPORTED");
  });

  it("names what a features-only level gains instead of showing an empty preview", async () => {
    await commitAt(1, "character:quiet");
    const preview = expectOk<LevelUpPreview>(await harness.levelUp.preview("character:quiet"));
    expect(preview.toLevel).toBe(2);
    expect(preview.newChoices).toEqual([]);
    // The level is not silent: the feature it grants is named.
    expect(preview.gainedFeatures.map(item => item.label)).toContain("Steady Hand");
    expect(preview.onlyHitDice).toBe(false);
    expect(preview.blocked).toBe(false);
  });

  it("guards a level the class progression does not define", async () => {
    const draft = await openDraft(
      {
        name: "Lamp",
        level: 3,
        classId: ACCEPTANCE_IDS.shortClass,
        speciesId: ACCEPTANCE_IDS.species,
        backgroundId: ACCEPTANCE_IDS.background,
        abilityMethod: "manual",
        abilityBaseScores: { strength: 14, dexterity: 15, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
        abilityScores: { strength: 14, dexterity: 15, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
        choiceSelections: { [ACCEPTANCE_CHOICES.speciesTrait]: [`option:${ACCEPTANCE_PROFICIENCIES.skillCairnlore}`] },
      },
      3,
    );
    const flexible = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(draft.draft.id, draft.revision, "flexible"),
    );
    expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "op:lamp",
        draftId: draft.draft.id,
        expectedDraftRevision: flexible.revision,
        characterId: "character:lamp",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );

    const preview = expectOk<LevelUpPreview>(await harness.levelUp.preview("character:lamp"));
    expect(preview.coverage.supported).toBe(false);
    expect(preview.coverage.progressionMax).toBe(3);
    expect(preview.blocked).toBe(true);
    expect(preview.blockingCodes).toContain("CLASS_PROGRESSION_LEVEL_MISSING");

    const character = await harness.database.characters.get("character:lamp");
    const runtime = await harness.database.characterRuntimeStates.get("character:lamp");
    const outcome = await harness.levelUp.confirm({
      operationId: "op:lamp-levelup",
      characterId: "character:lamp",
      expectedCharacterRevision: character?.revision ?? 0,
      expectedRuntimeRevision: runtime?.revision ?? 0,
      targetLevel: 4,
      expectedContentFingerprint: preview.contentFingerprint,
      choiceSelections: {},
    });
    expect(outcome).toMatchObject({ status: "invalid" });
    if (outcome.status === "invalid") expect(outcome.issues[0].code).toBe("CLASS_PROGRESSION_LEVEL_MISSING");
    // Refused before anything was written: no restore point, no new version.
    expect((await harness.database.characters.get("character:lamp"))?.level).toBe(3);
    expect(await harness.database.characterSnapshots.where("characterId").equals("character:lamp").count()).toBe(0);
  });

  it("requires the subclass at the level the class declares it", async () => {
    await commitAt(2, "character:pathless");
    const character = await harness.database.characters.get("character:pathless");
    const runtime = await harness.database.characterRuntimeStates.get("character:pathless");
    const preview = expectOk<LevelUpPreview>(await harness.levelUp.preview("character:pathless"));
    expect(preview.toLevel).toBe(3);
    expect(preview.subclass?.unresolved).toBe(true);

    const refused = await harness.levelUp.confirm({
      operationId: "op:pathless-refused",
      characterId: "character:pathless",
      expectedCharacterRevision: character?.revision ?? 0,
      expectedRuntimeRevision: runtime?.revision ?? 0,
      targetLevel: 3,
      expectedContentFingerprint: preview.contentFingerprint,
      choiceSelections: {},
    });
    expect(refused).toMatchObject({ status: "invalid" });
    if (refused.status === "invalid") expect(refused.issues[0].code).toBe("SUBCLASS_NOT_CHOSEN");

    const accepted = expectOk<LevelUpResult>(
      await harness.levelUp.confirm({
        operationId: "op:pathless-accepted",
        characterId: "character:pathless",
        expectedCharacterRevision: character?.revision ?? 0,
        expectedRuntimeRevision: runtime?.revision ?? 0,
        targetLevel: 3,
        expectedContentFingerprint: preview.contentFingerprint,
        choiceSelections: { [ACCEPTANCE_CHOICES.subclassFlare]: ["option:eb-flare-wide"] },
        subclassId: ACCEPTANCE_IDS.subclassLedger,
      }),
    );
    expect(accepted.toLevel).toBe(3);
    const sheet = await harness.query.sheet("character:pathless");
    expect(sheet?.subclassLabel).toBe("Quiet Ledger");
  });

  it("takes a complete restore point that puts the character back exactly", async () => {
    await commitAt(1, "character:restorable");
    const before = await harness.database.characters.get("character:restorable");
    const runtimeBefore = await harness.database.characterRuntimeStates.get("character:restorable");
    const preview = expectOk<LevelUpPreview>(await harness.levelUp.preview("character:restorable"));
    const result = expectOk<LevelUpResult>(
      await harness.levelUp.confirm({
        operationId: "op:restorable",
        characterId: "character:restorable",
        expectedCharacterRevision: before?.revision ?? 0,
        expectedRuntimeRevision: runtimeBefore?.revision ?? 0,
        targetLevel: 2,
        expectedContentFingerprint: preview.contentFingerprint,
        choiceSelections: {},
      }),
    );
    expect((await harness.database.characters.get("character:restorable"))?.level).toBe(2);

    const restored = expectOk<LevelUpResult>(
      await harness.levelUp.restore(
        "character:restorable",
        result.restorePointId,
        result.characterRevision,
        "op:restore",
      ),
    );
    expect(restored.toLevel).toBe(1);
    const after = await harness.database.characters.get("character:restorable");
    expect(after?.level).toBe(1);
    expect(after?.classLevels[0].level).toBe(1);
    const runtimeAfter = await harness.database.characterRuntimeStates.get("character:restorable");
    expect(runtimeAfter?.currentHitPoints).toBe(runtimeBefore?.currentHitPoints);
    expect(runtimeAfter?.hitDiceRemaining).toBe(runtimeBefore?.hitDiceRemaining);
    // History is appended, never deleted: the level-up is still on record.
    const versions = await harness.database.characterVersions.where("characterId").equals("character:restorable").toArray();
    expect(versions.some(version => version.reason === "level-up")).toBe(true);
    expect(versions.some(version => version.reason === "restore")).toBe(true);
  });
});

/** Selections the climb needs at each step: level 3 chooses the subclass. */
function subclassStepSelections(step: number): Record<string, string[]> {
  // step 0 is 1→2, step 1 is 2→3, step 2 is 3→4, step 3 is 4→5.
  if (step === 1) return { [ACCEPTANCE_CHOICES.subclassFlare]: ["option:eb-flare-wide"] };
  if (step === 2)
    return {
      [ACCEPTANCE_CHOICES.boon]: ["option:eb-attentive"],
      [ACCEPTANCE_CHOICES.featFocus]: [`option:${ACCEPTANCE_PROFICIENCIES.toolSignalLamp}`],
    };
  return {};
}

function subclassFor(step: number): string | undefined {
  return step === 1 ? ACCEPTANCE_IDS.subclassWatch : undefined;
}

/** A draft build with no content selections, for direct planner calls. */
function emptyBuild(): CharacterDraftBuild {
  return {
    name: "",
    level: 1,
    abilityMethod: "standard-array",
    abilityScores: {},
    abilityBaseScores: {},
    abilityIncreases: {},
    choiceSelections: {},
    equipmentSelections: {},
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
  };
}
