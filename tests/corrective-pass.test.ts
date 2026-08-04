/**
 * The M2.1a corrective pass.
 *
 * Each block here is a defect the merge-readiness review found in the first
 * real-content foundation, expressed as the behaviour that has to hold instead.
 * They are grouped by the contract they belong to rather than by the module they
 * happen to touch, because several of them are only visible where two modules
 * meet: a ruleset switch that clears a selection but leaves the origin increase
 * it authorised, or a level the planner reports as uncovered and the commit
 * boundary then accepts anyway.
 *
 * All content is the original synthetic acceptance and density slices.
 */
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
  ACCEPTANCE_ENTRIES,
  ACCEPTANCE_IDS,
  ACCEPTANCE_PACK_ID,
  ACCEPTANCE_PROFICIENCIES,
  ACCEPTANCE_RULESET_ID,
  ACCEPTANCE_SOURCE_ID,
  COLLISION_CLASS_ID,
  acceptancePack,
  sourceCollisionPackJson,
} from "@/tests/fixtures/acceptance-ruleset";
import { SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry } from "@/src/domain/model";
import type { CommitResult, DraftSnapshot } from "@/src/services/character-services";
import type { RulesetChangePreview } from "@/src/services/ruleset-change";
import { reconcileAbilityAllocation } from "@/src/services/ability-allocation";
import { planActivation } from "@/src/services/choice-planner";
import { planBuild } from "@/src/services/build-planner";
import {
  equipmentGrantsFor,
  rulesetPrivacyFor,
  scopeEntriesToRuleset,
  selectedEquipmentFor,
} from "@/src/services/content-scope";
import {
  legacyRulesetIdsForPack,
  proposeRulesetForPack,
  rulesetIdForPack,
} from "@/src/services/ruleset-planner";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeHarnesses();
});

const scopedEntries = () => harness.query.contentForRuleset(ACCEPTANCE_RULESET_ID);

/** A level 5 Beaconkeeper with every reachable decision answered. */
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

/** Opens a draft in the acceptance ruleset and applies one patch. */
async function seedDraft(patch: Partial<CharacterDraftBuild>, draftId = "draft:corrective"): Promise<DraftSnapshot> {
  await installAcceptanceRuleset(harness);
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({
      draftId,
      rulesetProfileId: ACCEPTANCE_RULESET_ID,
      level: patch.level ?? 1,
      presentation: "guided",
    }),
  );
  return expectOk<DraftSnapshot>(
    await harness.drafts.update({ draftId, expectedRevision: created.revision, patch }),
  );
}

/** The acceptance entries with the main class's progression truncated. */
function entriesCoveringUpTo(maxLevel: number): ContentEntry[] {
  return ACCEPTANCE_ENTRIES.map(entry => {
    if (entry.id !== ACCEPTANCE_IDS.class) return entry;
    const mechanics = entry.mechanics as { progression: { level: number }[] };
    return {
      ...entry,
      mechanics: {
        ...mechanics,
        progression: mechanics.progression.filter(row => row.level <= maxLevel),
      },
    } as ContentEntry;
  });
}

/* -------------------------------------------------------------------------- */
/* Scope 1 — a ruleset switch is previewed, then cancelled or confirmed        */
/* -------------------------------------------------------------------------- */

describe("changing the ruleset is a two-phase decision", () => {
  it("previews the change without writing anything", async () => {
    const seeded = await seedDraft(completeBuild());
    const preview = expectOk<RulesetChangePreview>(
      await harness.drafts.previewRulesetChange(seeded.draft.id, SYNTHETIC_RULESET_ID),
    );

    expect(preview.currentRulesetId).toBe(ACCEPTANCE_RULESET_ID);
    expect(preview.proposedRulesetId).toBe(SYNTHETIC_RULESET_ID);
    // What goes, stated by field path, before anything is written.
    const clearedPaths = preview.cleared.map(field => field.fieldPath);
    expect(clearedPaths).toContain("classId");
    expect(clearedPaths).toContain("subclassId");
    expect(clearedPaths).toContain("speciesId");
    expect(clearedPaths).toContain("backgroundId");
    expect(clearedPaths.some(path => path.startsWith("choiceSelections."))).toBe(true);
    expect(clearedPaths.some(path => path.startsWith("equipmentSelections."))).toBe(true);
    // What stays.
    const retainedPaths = preview.retained.map(field => field.fieldPath);
    expect(retainedPaths).toContain("name");
    expect(retainedPaths).toContain("level");
    expect(retainedPaths).toContain("abilityBaseScores");
    // The origin increases are recomputed, not silently retained.
    expect(preview.recomputed.map(field => field.fieldPath)).toContain("abilityIncreases");

    // Nothing was written: the draft is byte-identical at the same revision.
    const after = await harness.drafts.get(seeded.draft.id);
    expect(after?.revision).toBe(seeded.revision);
    expect(after?.draft.build).toEqual(seeded.draft.build);
    expect(after?.draft.rulesetProfileId).toBe(ACCEPTANCE_RULESET_ID);
  });

  it("leaves the complete draft untouched when the preview is not confirmed", async () => {
    const seeded = await seedDraft(completeBuild());
    await harness.drafts.previewRulesetChange(seeded.draft.id, SYNTHETIC_RULESET_ID);
    await harness.drafts.previewRulesetChange(seeded.draft.id, SYNTHETIC_RULESET_ID);

    const after = await harness.drafts.get(seeded.draft.id);
    expect(after?.draft.build).toEqual(seeded.draft.build);
    expect(after?.revision).toBe(seeded.revision);
  });

  it("applies exactly the previewed change on confirmation", async () => {
    const seeded = await seedDraft(completeBuild());
    const preview = expectOk<RulesetChangePreview>(
      await harness.drafts.previewRulesetChange(seeded.draft.id, SYNTHETIC_RULESET_ID),
    );
    const applied = expectOk<DraftSnapshot>(
      await harness.drafts.changeRuleset(seeded.draft.id, preview.expectedRevision, SYNTHETIC_RULESET_ID),
    );
    const build = applied.draft.build;

    expect(applied.draft.rulesetProfileId).toBe(SYNTHETIC_RULESET_ID);
    expect(build.classId).toBeUndefined();
    expect(build.subclassId).toBeUndefined();
    expect(build.speciesId).toBeUndefined();
    expect(build.backgroundId).toBeUndefined();
    expect(build.choiceSelections).toEqual({});
    expect(build.equipmentSelections).toEqual({});
    // Ruleset-independent values survive.
    expect(build.name).toBe("Wren Halloway");
    expect(build.level).toBe(5);
    expect(build.abilityBaseScores).toEqual(seeded.draft.build.abilityBaseScores);
    // The origin that authorised the increases is gone, so they cannot remain,
    // and the final scores must fall back to the base scores.
    expect(build.abilityIncreases).toEqual({});
    expect(build.abilityScores.strength).toBe(15);
    expect(build.abilityScores.wisdom).toBe(10);
  });

  it("refuses a confirmation that carries a stale revision", async () => {
    const seeded = await seedDraft(completeBuild());
    const preview = expectOk<RulesetChangePreview>(
      await harness.drafts.previewRulesetChange(seeded.draft.id, SYNTHETIC_RULESET_ID),
    );
    // Something else touches the draft between preview and confirmation.
    await harness.drafts.update({
      draftId: seeded.draft.id,
      expectedRevision: preview.expectedRevision,
      patch: { name: "Renamed mid-flight" },
    });

    const outcome = await harness.drafts.changeRuleset(
      seeded.draft.id,
      preview.expectedRevision,
      SYNTHETIC_RULESET_ID,
    );
    expect(outcome.status).toBe("stale");
    const after = await harness.drafts.get(seeded.draft.id);
    expect(after?.draft.rulesetProfileId).toBe(ACCEPTANCE_RULESET_ID);
    expect(after?.draft.build.classId).toBe(ACCEPTANCE_IDS.class);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 2 — an origin increase cannot outlive the origin that authorised it   */
/* -------------------------------------------------------------------------- */

describe("origin ability increases are revalidated against the active pattern", () => {
  it("recomputes the final scores from base plus the valid allocation", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const allocation = reconcileAbilityAllocation(
      { ...(completeBuild() as CharacterDraftBuild) },
      entries,
    );
    expect(allocation.invalid).toEqual([]);
    expect(allocation.final.strength).toBe(17);
    expect(allocation.final.wisdom).toBe(11);
  });

  it("invalidates an increase in an ability the new origin cannot increase", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    // Charisma is not one of the background's offered abilities.
    const build = {
      ...(completeBuild() as CharacterDraftBuild),
      abilityIncreases: { charisma: 2, wisdom: 1 },
      abilityScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 11, charisma: 10 },
    };
    const allocation = reconcileAbilityAllocation(build, entries);

    expect(allocation.invalid.map(item => item.ability)).toContain("charisma");
    // The invalid increase is not quietly applied to the final score.
    expect(allocation.final.charisma).toBe(8);
    expect(allocation.final.wisdom).toBe(11);

    const plan = planBuild(build, entries, "guided");
    expect(plan.issues.map(issue => issue.code)).toContain("ORIGIN_INCREASE_NOT_AVAILABLE");
  });

  it("clears an increase the new background does not authorise when the background changes", async () => {
    const seeded = await seedDraft(completeBuild());
    // Move to a draft state whose stored increase the origin cannot justify.
    const withBadIncrease = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: seeded.draft.id,
        expectedRevision: seeded.revision,
        patch: {
          abilityIncreases: { charisma: 2, wisdom: 1 },
          abilityScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 11, charisma: 10 },
        },
      }),
    );
    // Removing the background removes the pattern entirely.
    const cleared = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: seeded.draft.id,
        expectedRevision: withBadIncrease.revision,
        patch: { backgroundId: undefined },
      }),
    );

    expect(cleared.draft.build.abilityIncreases).toEqual({});
    expect(cleared.draft.build.abilityScores.wisdom).toBe(10);
    expect(cleared.draft.build.abilityScores.charisma).toBe(8);
  });

  it("never commits a final score an invalid increase inflated", async () => {
    const seeded = await seedDraft(completeBuild());
    const staged = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: seeded.draft.id,
        expectedRevision: seeded.revision,
        patch: {
          abilityIncreases: { charisma: 2, wisdom: 1 },
          abilityScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 11, charisma: 10 },
        },
      }),
    );
    const outcome = await harness.commit.commit({
      operationId: "op:corrective-origin",
      draftId: seeded.draft.id,
      expectedDraftRevision: staged.revision,
      characterId: "character:corrective-origin",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    });
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid")
      expect(outcome.issues.map(issue => issue.code)).toContain("ORIGIN_INCREASE_NOT_AVAILABLE");
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 3 — level coverage is one contract across both modes                  */
/* -------------------------------------------------------------------------- */

describe("class level coverage", () => {
  it("does not claim coverage is valid when no class is selected", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const activation = planActivation(
      { ...(completeBuild() as CharacterDraftBuild), classId: undefined, subclassId: undefined },
      entries,
    );
    expect(activation.levelCoverage).toBe("no-class");
    expect(activation.levelCovered).toBe(false);
  });

  it("reports a level the ruleset's content does not reach", async () => {
    const entries = entriesCoveringUpTo(2);
    const plan = planBuild({ ...(completeBuild() as CharacterDraftBuild), level: 5 }, entries, "guided");
    expect(plan.maxLevel).toBe(2);
    expect(plan.levelCoverage).toBe("not-covered");
    expect(plan.issues.map(issue => issue.code)).toContain("LEVEL_NOT_COVERED_BY_CLASS");
  });

  it("reports a level the selected class does not reach", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const plan = planBuild(
      { ...(completeBuild() as CharacterDraftBuild), classId: ACCEPTANCE_IDS.shortClass, subclassId: undefined, level: 5 },
      entries,
      "guided",
    );
    expect(plan.classProgressionMax).toBe(3);
    expect(plan.maxLevel).toBe(3);
    expect(plan.levelCoverage).toBe("not-covered");
  });

  it("recomputes the supported range when the class changes", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const five = planBuild({ ...(completeBuild() as CharacterDraftBuild), level: 5 }, entries, "guided");
    expect(five.maxLevel).toBe(5);
    const three = planBuild(
      { ...(completeBuild() as CharacterDraftBuild), classId: ACCEPTANCE_IDS.shortClass, subclassId: undefined, level: 5 },
      entries,
      "guided",
    );
    // The selector must not be inflated back up to the stored level.
    expect(three.maxLevel).toBe(3);
    expect(three.maxLevel).toBeLessThan(five.maxLevel);
  });

  it("refuses the commit in guided mode", async () => {
    const seeded = await seedDraft({
      ...completeBuild(),
      classId: ACCEPTANCE_IDS.shortClass,
      subclassId: undefined,
      level: 5,
    });
    const outcome = await harness.commit.commit({
      operationId: "op:coverage-guided",
      draftId: seeded.draft.id,
      expectedDraftRevision: seeded.revision,
      characterId: "character:coverage-guided",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    });
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid")
      expect(outcome.issues.map(issue => issue.code)).toContain("LEVEL_NOT_COVERED_BY_CLASS");
  });

  it("refuses the commit in flexible mode, and cannot be acknowledged away", async () => {
    const seeded = await seedDraft({
      ...completeBuild(),
      classId: ACCEPTANCE_IDS.shortClass,
      subclassId: undefined,
      level: 5,
    });
    const flexible = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(seeded.draft.id, seeded.revision, "flexible"),
    );
    const outcome = await harness.commit.commit({
      operationId: "op:coverage-flexible",
      draftId: seeded.draft.id,
      expectedDraftRevision: flexible.revision,
      characterId: "character:coverage-flexible",
      intent: "create",
      // Even an explicit acknowledgement cannot buy a structurally impossible sheet.
      acknowledgedIssueCodes: ["LEVEL_NOT_COVERED_BY_CLASS"],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    });
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid")
      expect(outcome.issues.map(issue => issue.code)).toContain("LEVEL_NOT_COVERED_BY_CLASS");
    // Nothing was written.
    expect(await harness.query.sheet("character:coverage-flexible")).toBeUndefined();
  });

  it("still lets flexible mode save an incomplete but structurally supported draft", async () => {
    const seeded = await seedDraft({ ...completeBuild(3), choiceSelections: {} });
    const flexible = expectOk<DraftSnapshot>(
      await harness.drafts.changePresentation(seeded.draft.id, seeded.revision, "flexible"),
    );
    const outcome = await harness.commit.commit({
      operationId: "op:coverage-incomplete",
      draftId: seeded.draft.id,
      expectedDraftRevision: flexible.revision,
      characterId: "character:coverage-incomplete",
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
    });
    expect(outcome.status).toBe("ok");
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 4 and 8 — profile membership and profile identity                     */
/* -------------------------------------------------------------------------- */

describe("an imported pack's ruleset covers only that pack", () => {
  it("derives an explicit entry-identity membership set", () => {
    const pack = acceptancePack();
    const proposal = proposeRulesetForPack(
      { id: pack.pack.id, name: pack.pack.name, sourceIds: pack.sources.map(source => source.id) },
      pack.entries,
    );
    expect(proposal.activeEntryIds).toHaveLength(pack.entries.length);
    expect([...proposal.activeEntryIds].sort()).toEqual([...pack.entries.map(entry => entry.id)].sort());
  });

  it("does not activate an unrelated entry that reuses the same source ID", async () => {
    await installAcceptanceRuleset(harness);
    // An entry that already exists on the same source but belongs to no pack in
    // the import. Reusing a source ID must not widen the profile.
    const intruder: ContentEntry = {
      ...ACCEPTANCE_ENTRIES.find(item => item.id === ACCEPTANCE_IDS.shortClass)!,
      id: "class:eb-intruder",
      slug: "eb-intruder",
      name: "Intruder",
      sourceId: ACCEPTANCE_SOURCE_ID,
    };
    await harness.database.contentEntries.put(intruder);

    const scoped = await harness.query.contentForRuleset(ACCEPTANCE_RULESET_ID);
    expect(scoped.map(item => item.id)).not.toContain("class:eb-intruder");
    expect(scoped.map(item => item.id)).toContain(ACCEPTANCE_IDS.class);
  });

  it("refuses to widen an installed profile from a pack that reuses its source ID", async () => {
    await installAcceptanceRuleset(harness);
    // The adversarial pack is well-formed and importable; nothing about it is
    // rejected. Only explicit entry membership keeps it out of the other profile.
    const preview = await harness.install.preview([sourceCollisionPackJson()]);
    expect(preview.issues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(preview.canImport).toBe(true);
    expectOk(await harness.install.confirm(preview, {}));

    // It really did land on the installed source.
    const stored = await harness.database.contentEntries.get(COLLISION_CLASS_ID);
    expect(stored?.sourceId).toBe(ACCEPTANCE_SOURCE_ID);

    const scoped = await harness.query.contentForRuleset(ACCEPTANCE_RULESET_ID);
    expect(scoped.map(entry => entry.id)).toContain(ACCEPTANCE_IDS.class);
    expect(scoped.map(entry => entry.id)).not.toContain(COLLISION_CLASS_ID);

    // And the counts a user reads did not move either.
    const views = await harness.install.installedRulesets();
    expect(views.find(view => view.id === ACCEPTANCE_RULESET_ID)?.entryCount).toBe(
      acceptancePack().entries.length,
    );
  });

  it("matches preview membership to the profile it writes", async () => {
    const preview = await harness.install.preview([JSON.stringify(acceptancePack())]);
    const offer = preview.offers.find(item => item.packId === ACCEPTANCE_PACK_ID);
    expect(offer).toBeDefined();
    expectOk(await harness.install.confirm(preview, { createRulesetForPackIds: [ACCEPTANCE_PACK_ID] }));

    const profile = await harness.database.rulesetProfiles.get(offer!.rulesetId);
    expect([...(profile?.allowedEntryIds ?? [])].sort()).toEqual([...offer!.activeEntryIds].sort());
  });

  it("keeps an existing profile's source-scoped membership readable", async () => {
    const all = await harness.database.contentEntries.toArray();
    const legacy = await harness.database.rulesetProfiles.get(SYNTHETIC_RULESET_ID);
    expect(legacy).toBeDefined();
    expect(legacy?.allowedEntryIds).toBeUndefined();
    // With no explicit set, source scoping is still how the profile reads.
    expect(scopeEntriesToRuleset(all, legacy).length).toBeGreaterThan(0);
  });
});

describe("a pack's profile ID keeps the pack's complete identity", () => {
  it("does not collide across a stripped prefix", () => {
    expect(rulesetIdForPack("pack:x")).not.toBe(rulesetIdForPack("x"));
  });

  it("stays distinct for prefix-related and visually similar pack IDs", () => {
    const packIds = ["pack:alpha", "pack:alpha-beta", "alpha", "alpha-beta", "pack:pack:alpha", "pack:a1pha", "pack:alpha1"];
    const derived = packIds.map(rulesetIdForPack);
    expect(new Set(derived).size).toBe(packIds.length);
  });

  it("is deterministic", () => {
    expect(rulesetIdForPack(ACCEPTANCE_PACK_ID)).toBe(rulesetIdForPack(ACCEPTANCE_PACK_ID));
  });

  it("still recognises a profile installed under the earlier derivation", async () => {
    const legacyId = legacyRulesetIdsForPack(ACCEPTANCE_PACK_ID)[0];
    expect(legacyId).toBe("ruleset:emberline-acceptance");
    const now = "2026-08-04T08:00:00.000Z";
    await harness.database.rulesetProfiles.put({
      id: legacyId,
      name: "Previously installed",
      activeSourceIds: [ACCEPTANCE_SOURCE_ID],
      editionPriority: [],
      allowedCategories: [],
      allowLegacy: false,
      allowDuplicateVersions: false,
      conflictResolution: "source-priority",
      allowCustomOverrides: true,
      requirementEnforcement: "soft",
      createdAt: now,
      updatedAt: now,
    });

    const preview = await harness.install.preview([JSON.stringify(acceptancePack())]);
    const offer = preview.offers.find(item => item.packId === ACCEPTANCE_PACK_ID);
    // Recognised as already installed, so nothing is silently overwritten and no
    // duplicate profile is created under the new derivation.
    expect(offer?.alreadyInstalled).toBe(true);
    const outcome = await harness.install.confirm(preview, { createRulesetForPackIds: [ACCEPTANCE_PACK_ID] });
    expect(outcome.status).toBe("invalid");
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 5 — typed links and lineages join the traversal                       */
/* -------------------------------------------------------------------------- */

describe("activation follows typed content links", () => {
  it("activates a required link at its own level and not above the build level", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const atFive = planActivation(completeBuild(5) as CharacterDraftBuild, entries);
    const ids = atFive.entries.map(item => item.entry.id);
    expect(ids).toContain(ACCEPTANCE_IDS.linkedEcho);
    // The other link on the same entry is due at a level this build never reaches.
    expect(ids).not.toContain(ACCEPTANCE_IDS.linkedFarBeacon);

    const atFour = planActivation(completeBuild(4) as CharacterDraftBuild, entries);
    expect(atFour.entries.map(item => item.entry.id)).not.toContain(ACCEPTANCE_IDS.linkedEcho);
  });

  it("terminates on a link cycle and activates each entry once", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const activation = planActivation(completeBuild(5) as CharacterDraftBuild, entries);
    const ids = activation.entries.map(item => item.entry.id);
    expect(ids.filter(id => id === ACCEPTANCE_IDS.linkedCycleA)).toHaveLength(1);
    expect(ids.filter(id => id === ACCEPTANCE_IDS.linkedCycleB)).toHaveLength(1);
  });

  it("keeps the provenance of a linked activation", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const activation = planActivation(completeBuild(5) as CharacterDraftBuild, entries);
    const echo = activation.entries.find(item => item.entry.id === ACCEPTANCE_IDS.linkedEcho);
    expect(echo?.route).toBe("link");
    expect(echo?.viaLinkFromEntryId).toBe("feature:eb-second-beacon");
  });
});

describe("a lineage replaces the trait it declares it replaces", () => {
  const withLineage = (level = 5): CharacterDraftBuild => {
    const build = completeBuild(level) as CharacterDraftBuild;
    return {
      ...build,
      choiceSelections: { ...build.choiceSelections, [ACCEPTANCE_CHOICES.lineage]: ["option:eb-deepcairn"] },
    };
  };

  it("activates the lineage's own trait", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const ids = planActivation(withLineage(), entries).entries.map(item => item.entry.id);
    expect(ids).toContain(ACCEPTANCE_IDS.lineage);
    expect(ids).toContain(ACCEPTANCE_IDS.lineageTrait);
  });

  it("does not leave the replaced species trait active as well", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const activation = planActivation(withLineage(), entries);
    expect(activation.entries.map(item => item.entry.id)).not.toContain(ACCEPTANCE_IDS.traitPlain);
    expect(activation.replacedTraitIds).toContain(ACCEPTANCE_IDS.traitPlain);
  });

  it("leaves the species trait alone when no lineage is taken", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const activation = planActivation(completeBuild(5) as CharacterDraftBuild, entries);
    expect(activation.entries.map(item => item.entry.id)).toContain(ACCEPTANCE_IDS.traitPlain);
    expect(activation.replacedTraitIds).toEqual([]);
  });

  it("activates a legacy race origin's traits by the same rules", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const activation = planActivation(
      { ...(completeBuild(5) as CharacterDraftBuild), speciesId: ACCEPTANCE_IDS.legacyRace },
      entries,
    );
    const ids = activation.entries.map(item => item.entry.id);
    expect(ids).toContain(ACCEPTANCE_IDS.legacyRace);
    expect(ids).toContain(ACCEPTANCE_IDS.traitPlain);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 6 — one bundle, granted twice, is shown once                          */
/* -------------------------------------------------------------------------- */

describe("equipment granted by two entries is not doubled", () => {
  /** Level 5 with the feat that grants the background's own bundle. */
  const sharedBundleBuild = (): CharacterDraftBuild => {
    const build = completeBuild(5) as CharacterDraftBuild;
    return {
      ...build,
      choiceSelections: {
        ...build.choiceSelections,
        [ACCEPTANCE_CHOICES.boon]: ["option:eb-stonewise"],
        [ACCEPTANCE_CHOICES.featFocus]: [],
      },
    };
  };

  it("lists the resulting items once", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const plan = planBuild(sharedBundleBuild(), entries, "guided");
    const items = selectedEquipmentFor(plan.equipmentGrants, sharedBundleBuild().equipmentSelections);
    const tallySticks = items.filter(item => item.itemId === "item:eb-tally-sticks");
    expect(tallySticks).toHaveLength(1);
    expect(tallySticks[0].quantity).toBe(1);
    const inkSets = items.filter(item => item.itemId === "item:eb-ink-set");
    expect(inkSets).toHaveLength(1);
  });

  it("keeps both sources visible on the one bundle", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const plan = planBuild(sharedBundleBuild(), entries, "guided");
    const satchels = plan.equipmentGrants.filter(grant => grant.bundleId === ACCEPTANCE_BUNDLES.backgroundKit);
    expect(satchels).toHaveLength(1);
    expect(satchels[0].grantedBy.map(source => source.entryId).sort()).toEqual(
      [ACCEPTANCE_IDS.background, ACCEPTANCE_IDS.featPlain].sort(),
    );
  });

  it("still shows genuinely distinct class and background bundles separately", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    const plan = planBuild(completeBuild(5) as CharacterDraftBuild, entries, "guided");
    const bundleIds = plan.equipmentGrants.map(grant => grant.bundleId);
    expect(bundleIds).toContain(ACCEPTANCE_BUNDLES.classKit);
    expect(bundleIds).toContain(ACCEPTANCE_BUNDLES.backgroundKit);
  });

  it("adds quantities when two different bundles hold the same item", () => {
    const grants = equipmentGrantsFor(
      [
        {
          ...ACCEPTANCE_ENTRIES[0],
          id: "entry:a",
          effects: [{ id: "e:a", type: "grantEquipmentBundle", bundleId: "bundle:a" }],
          equipmentBundles: [
            { id: "bundle:a", label: "A", entries: [{ type: "item", itemId: "item:x", quantity: 1, status: "carried" }] },
          ],
        } as ContentEntry,
        {
          ...ACCEPTANCE_ENTRIES[0],
          id: "entry:b",
          effects: [{ id: "e:b", type: "grantEquipmentBundle", bundleId: "bundle:b" }],
          equipmentBundles: [
            { id: "bundle:b", label: "B", entries: [{ type: "item", itemId: "item:x", quantity: 2, status: "carried" }] },
          ],
        } as ContentEntry,
      ],
      [
        {
          ...ACCEPTANCE_ENTRIES[0],
          id: "entry:a",
          equipmentBundles: [
            { id: "bundle:a", label: "A", entries: [{ type: "item", itemId: "item:x", quantity: 1, status: "carried" }] },
          ],
        } as ContentEntry,
        {
          ...ACCEPTANCE_ENTRIES[0],
          id: "entry:b",
          equipmentBundles: [
            { id: "bundle:b", label: "B", entries: [{ type: "item", itemId: "item:x", quantity: 2, status: "carried" }] },
          ],
        } as ContentEntry,
      ],
    );
    const items = selectedEquipmentFor(grants, {});
    expect(items.filter(item => item.itemId === "item:x")).toHaveLength(1);
    expect(items.find(item => item.itemId === "item:x")?.quantity).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 7 — a ruleset says whether it reaches private content                 */
/* -------------------------------------------------------------------------- */

describe("ruleset privacy is derived from metadata", () => {
  it("reports a public-only profile", async () => {
    await installAcceptanceRuleset(harness);
    const entries = await scopedEntries();
    expect(rulesetPrivacyFor(entries)).toBe("public-only");
  });

  it("reports a profile that reaches private or export-restricted content", () => {
    const restricted = ACCEPTANCE_ENTRIES.map(entry => ({ ...entry, private: true, exportRestricted: true }));
    expect(rulesetPrivacyFor(restricted)).toBe("restricted");
  });

  it("reports a mixed profile", () => {
    const mixed = ACCEPTANCE_ENTRIES.map((entry, index) =>
      index === 0 ? { ...entry, exportRestricted: true } : entry,
    );
    expect(rulesetPrivacyFor(mixed)).toBe("mixed");
  });

  it("surfaces the signal on the installed ruleset view without any content text", async () => {
    await installAcceptanceRuleset(harness);
    const views = await harness.install.installedRulesets();
    const view = views.find(item => item.id === ACCEPTANCE_RULESET_ID);
    expect(view?.privacy).toBe("public-only");
    // The signal is a classification, never a quotation of the content.
    expect(JSON.stringify(view)).not.toContain("Beaconkeeper");
  });

  it("does not prefer a private profile when resolving a starting ruleset", async () => {
    await installAcceptanceRuleset(harness);
    const selection = await harness.install.resolveStartingRuleset();
    // Two usable profiles and no activation is genuinely ambiguous, whatever
    // their privacy is; nothing may quietly pick the private one.
    expect(selection.kind).toBe("ambiguous");
  });
});

/* -------------------------------------------------------------------------- */
/* Scope 9 — the value that survives is the latest one                         */
/* -------------------------------------------------------------------------- */

describe("a delayed or out-of-order save cannot resurrect an older value", () => {
  it("keeps the newest name after a burst of sequential updates", async () => {
    const seeded = await seedDraft({ name: "" });
    let revision = seeded.revision;
    const words = ["Wren", "Wren H", "Wren Hal", "Wren Hallo", "Wren Halloway"];
    for (const value of words) {
      const applied = expectOk<DraftSnapshot>(
        await harness.drafts.update({ draftId: seeded.draft.id, expectedRevision: revision, patch: { name: value } }),
      );
      revision = applied.revision;
    }
    const stored = await harness.drafts.get(seeded.draft.id);
    expect(stored?.draft.build.name).toBe("Wren Halloway");
  });

  it("refuses a late write that carries an already-spent revision", async () => {
    const seeded = await seedDraft({ name: "First" });
    const applied = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: seeded.draft.id,
        expectedRevision: seeded.revision,
        patch: { name: "Second" },
      }),
    );
    // A save that was in flight while "Second" landed must not overwrite it.
    const late = await harness.drafts.update({
      draftId: seeded.draft.id,
      expectedRevision: seeded.revision,
      patch: { name: "Stale first" },
    });
    expect(late.status).toBe("stale");
    const stored = await harness.drafts.get(seeded.draft.id);
    expect(stored?.draft.build.name).toBe("Second");
    expect(stored?.revision).toBe(applied.revision);
  });

  it("carries the latest name through to the committed record", async () => {
    const seeded = await seedDraft(completeBuild());
    const renamed = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: seeded.draft.id,
        expectedRevision: seeded.revision,
        patch: { name: "Wren Halloway of the Low Crossing" },
      }),
    );
    const result = expectOk<CommitResult>(
      await harness.commit.commit({
        operationId: "op:corrective-name",
        draftId: seeded.draft.id,
        expectedDraftRevision: renamed.revision,
        characterId: "character:corrective-name",
        intent: "create",
        acknowledgedIssueCodes: [],
        expectedContentFingerprint: await harness.query.contentFingerprint(ACCEPTANCE_RULESET_ID),
      }),
    );
    const sheet = await harness.query.sheet(result.characterId);
    expect(sheet?.name).toBe("Wren Halloway of the Low Crossing");
  });
});
