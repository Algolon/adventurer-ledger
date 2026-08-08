/**
 * A ruleset gains a category its pack has started shipping.
 *
 * A profile's `allowedCategories` is derived from the pack it was created from,
 * and every builder and resolver read is filtered through it. A ruleset created
 * before the pack shipped any spell therefore holds a category list without
 * `spell` in it, and a later version that adds spells installs them into content
 * that ruleset cannot see: the import reports success, the entries are on the
 * device, and nothing can reach them.
 *
 * Nothing here is about spells in particular. The pack is synthetic, the
 * category that appears is `spell` only because that is the case that surfaced
 * it, and the same assertions hold for `rule` and `spell-list`, which version 2
 * of the fixture also introduces. What is pinned is the generic rule: a profile
 * an installed pack owns reaches the categories that pack currently ships.
 *
 * The production install and update services are used throughout — a schema-only
 * test would pass while a device stayed broken.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import { scopeEntriesToRuleset } from "@/src/services/content-scope";
import { planBuild } from "@/src/services/build-planner";
import {
  SPELLCASTING_RULE_ID,
  SPELL_IDS,
  SPELL_LIST_IDS,
  SPELL_PACK_ID,
  SPELL_RULESET_ID,
  SPELL_V1_IDS,
  SPELL_V2_ADDED_IDS,
  spellPackV1Json,
  spellPackV2Json,
} from "@/tests/fixtures/spell-foundation-pack";
import { tidecallerDraft } from "@/tests/fixtures/spell-foundation-character";
import { SYNTHETIC_ENTRIES, SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import type { Category, ID, RulesetProfile } from "@/src/domain/model";
import type { InstallResult } from "@/src/services/content-install-service";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeHarnesses();
});

/** Version 1's categories: five entries, none of them spell-shaped. */
const V1_CATEGORIES: Category[] = ["background", "class", "feat", "proficiency", "species"];
/** What version 2 adds on top of them. */
const V2_ADDED_CATEGORIES: Category[] = ["rule", "spell", "spell-list"];

/** Imports one pack the way the UI does, optionally creating its ruleset. */
async function importPack(json: string, options: { createRuleset?: boolean } = {}): Promise<InstallResult> {
  const preview = await harness.install.preview([json]);
  if (!preview.canImport)
    throw new Error(`The fixture pack did not validate: ${preview.issues.map(issue => issue.code).join(", ")}`);
  return expectOk<InstallResult>(
    await harness.install.confirm(preview, {
      ...(options.createRuleset ? { createRulesetForPackIds: [SPELL_PACK_ID] } : {}),
    }),
  );
}

const profile = async (id: ID = SPELL_RULESET_ID) => harness.context.repositories.content.getRuleset(id);

/** The entries a profile actually activates, by the same rule every reader uses. */
async function reachableEntries(id: ID = SPELL_RULESET_ID) {
  const [entries, ruleset] = await Promise.all([
    harness.context.repositories.content.listEntries(),
    profile(id),
  ]);
  return scopeEntriesToRuleset(entries, ruleset);
}

const reachableIds = async (id?: ID) => (await reachableEntries(id)).map(entry => entry.id).sort();

describe("a fresh install of a pack that ships spells reaches them", () => {
  beforeEach(async () => {
    await importPack(spellPackV2Json(), { createRuleset: true });
  });

  it("puts every category the pack ships in the profile's scope", async () => {
    expect((await profile())?.allowedCategories).toEqual(
      [...V1_CATEGORIES, ...V2_ADDED_CATEGORIES].sort(),
    );
  });

  it("makes the spell entries themselves reachable", async () => {
    const reachable = await reachableIds();
    for (const id of Object.values(SPELL_IDS)) expect(reachable).toContain(id);
    expect(reachable).toContain(SPELL_LIST_IDS.litany);
    expect(reachable).toContain(SPELLCASTING_RULE_ID);
  });

  it("reports the ruleset as usable, with the spell content counted", async () => {
    const [view] = (await harness.install.installedRulesets()).filter(item => item.id === SPELL_RULESET_ID);
    expect(view.usable).toBe(true);
    expect(view.entryCount).toBe((await reachableIds()).length);
  });

  it("lets the builder offer the list's spells from the installed content", async () => {
    const plan = planBuild(tidecallerDraft(), await reachableEntries(), "guided");
    expect(plan.spellAvailability.spells.map(spell => spell.id)).toContain(SPELL_IDS.saltWard);
  });
});

describe("updating a spell-less installation to a spell-bearing one", () => {
  let before: RulesetProfile | undefined;
  let entriesBefore: ReadonlyMap<ID, { revision: number; updatedAt: string }>;
  let update: InstallResult;

  beforeEach(async () => {
    await importPack(spellPackV1Json(), { createRuleset: true });
    await harness.install.activate(SPELL_RULESET_ID);
    before = await profile();
    entriesBefore = new Map(
      (await harness.context.repositories.content.listEntries()).map(entry => [
        entry.id,
        { revision: entry.revision, updatedAt: entry.updatedAt },
      ]),
    );
    harness.tick();
    update = await importPack(spellPackV2Json());
  });

  it("starts from a profile that genuinely has no spell category", () => {
    expect(before?.allowedCategories).toEqual(V1_CATEGORIES);
    expect(before?.allowedCategories).not.toContain("spell");
  });

  it("advances the same profile rather than creating a second one", async () => {
    expect(update.createdRulesetIds).toEqual([]);
    expect(update.updatedRulesetIds).toEqual([SPELL_RULESET_ID]);
    const all = await harness.context.repositories.content.listRulesets();
    expect(all.filter(item => item.id.includes(SPELL_PACK_ID))).toHaveLength(1);
    expect((await profile())?.createdAt).toBe(before?.createdAt);
  });

  it("makes the spell category reachable", async () => {
    expect((await profile())?.allowedCategories).toContain("spell");
    const reachable = await reachableIds();
    for (const id of Object.values(SPELL_IDS)) expect(reachable).toContain(id);
  });

  it("keeps every category it already allowed", async () => {
    const after = (await profile())?.allowedCategories ?? [];
    for (const category of V1_CATEGORIES) expect(after).toContain(category);
  });

  it("adds every new category, not only the one that prompted this", async () => {
    const after = (await profile())?.allowedCategories ?? [];
    for (const category of V2_ADDED_CATEGORIES) expect(after).toContain(category);
  });

  it("keeps the active selection on the same profile", async () => {
    expect(await harness.install.activeRulesetId()).toBe(SPELL_RULESET_ID);
    const selection = await harness.install.resolveStartingRuleset();
    expect(selection).toMatchObject({ kind: "resolved", rulesetId: SPELL_RULESET_ID, reason: "active" });
  });

  it("adds exactly the new entries to the profile's membership", async () => {
    const after = await profile();
    for (const id of SPELL_V2_ADDED_IDS) expect(after?.allowedEntryIds).toContain(id);
    for (const id of Object.values(SPELL_V1_IDS)) expect(after?.allowedEntryIds).toContain(id);
  });

  it("does not rewrite an entry the update left alone", async () => {
    const entries = await harness.context.repositories.content.listEntries();
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    for (const id of [
      SPELL_V1_IDS.species,
      SPELL_V1_IDS.background,
      SPELL_V1_IDS.feat,
      SPELL_V1_IDS.saveInsight,
      SPELL_V1_IDS.saveResolve,
    ]) {
      expect(byId.get(id)?.revision).toBe(entriesBefore.get(id)?.revision);
      expect(byId.get(id)?.updatedAt).toBe(entriesBefore.get(id)?.updatedAt);
    }
    // The class genuinely changed, so it is the one record that did move.
    expect(byId.get(SPELL_V1_IDS.class)?.revision).toBe(2);
  });
});

describe("a profile scoped by source, from before explicit membership existed", () => {
  /*
   * A device that installed this pack under the earlier derivation holds a
   * profile with no `allowedEntryIds` at all: its scope is its active sources,
   * and its category list was frozen when it was written. New entries published
   * against the same source are already inside its source scope — so the *only*
   * thing standing between that device and its new spells is the category
   * filter. The profile is written directly because that is the state such a
   * device is in; everything after it goes through the production services.
   */
  const LEGACY_ID = SPELL_RULESET_ID;

  async function installLegacyProfile(categories: Category[]) {
    await importPack(spellPackV1Json());
    await harness.context.repositories.rulesets.put({
      id: LEGACY_ID,
      name: "Tidecall foundation slice",
      activeSourceIds: ["source:tidecall-foundation"],
      editionPriority: [],
      allowedCategories: categories,
      allowLegacy: false,
      allowDuplicateVersions: false,
      conflictResolution: "source-priority",
      allowCustomOverrides: true,
      requirementEnforcement: "soft",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    await harness.install.activate(LEGACY_ID);
  }

  it("has the new spells both installed and in scope, not one without the other", async () => {
    await installLegacyProfile([...V1_CATEGORIES]);
    await importPack(spellPackV2Json());
    const entries = await harness.context.repositories.content.listEntries();
    // Installing them was never the broken half; reaching them was.
    expect(entries.map(entry => entry.id)).toContain(SPELL_IDS.saltWard);
    expect(await reachableIds(LEGACY_ID)).toContain(SPELL_IDS.saltWard);
  });

  it("gains the category through the ordinary update path", async () => {
    await installLegacyProfile([...V1_CATEGORIES]);
    harness.tick();
    await importPack(spellPackV2Json());
    expect((await profile(LEGACY_ID))?.allowedCategories).toContain("spell");
    expect(await reachableIds(LEGACY_ID)).toContain(SPELL_IDS.saltWard);
  });

  it("keeps its source scoping rather than being narrowed to an entry set", async () => {
    await installLegacyProfile([...V1_CATEGORIES]);
    await importPack(spellPackV2Json());
    // Writing an explicit membership here would *narrow* a profile whose whole
    // contract is "everything from these sources".
    expect((await profile(LEGACY_ID))?.allowedEntryIds ?? []).toEqual([]);
  });

  it("is repaired in place by the settings inspection, with nothing reinstalled", async () => {
    await installLegacyProfile([...V1_CATEGORIES]);
    await importPack(spellPackV2Json());
    const { views } = await harness.install.inspectInstalledRulesets();
    expect(views.some(view => view.id === LEGACY_ID)).toBe(true);
    expect((await profile(LEGACY_ID))?.allowedCategories).toContain("spell");
    expect((await profile(LEGACY_ID))?.createdAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("leaves a profile that allows every category exactly as it is", async () => {
    // An empty list means "no category filter". Filling it in would introduce a
    // restriction where the profile deliberately has none.
    await installLegacyProfile([]);
    harness.tick();
    await importPack(spellPackV2Json());
    expect((await profile(LEGACY_ID))?.allowedCategories).toEqual([]);
    expect(await reachableIds(LEGACY_ID)).toContain(SPELL_IDS.saltWard);
  });

  it("keeps a category the pack no longer ships, because the scope is not the pack's", async () => {
    await installLegacyProfile([...V1_CATEGORIES, "item"]);
    await importPack(spellPackV2Json());
    const after = (await profile(LEGACY_ID))?.allowedCategories ?? [];
    expect(after).toContain("item");
    expect(after).toContain("spell");
  });
});

/**
 * A hand-written category list is the defect, wherever it appears.
 *
 * Writing this contract found one that had already gone stale: the seeded
 * `SYNTHETIC_RULESET` omitted `lineage` while the pack it seeds ships a lineage
 * entry, so that entry had been installed and unreachable since the seed was
 * written. That is the spell defect exactly, in a category nobody was looking
 * at, which is the argument for the advancement being generic rather than a
 * spell special case.
 *
 * The seed itself is now correct, and this keeps it so: it compares the declared
 * list against what the pack actually ships, rather than against a copy of the
 * list.
 */
describe("the seeded ruleset declares every category its own pack ships", () => {
  it("has nothing left for the advancement to repair", async () => {
    const seeded = await profile(SYNTHETIC_RULESET_ID);
    for (const category of new Set(SYNTHETIC_ENTRIES.map(entry => entry.category)))
      expect(seeded?.allowedCategories).toContain(category);

    const repairs = await harness.install.reconcileInstalledRulesets();
    expect(repairs.filter(repair => repair.rulesetId === SYNTHETIC_RULESET_ID)).toEqual([]);
  });

  it("is never given an entry membership it did not have", async () => {
    await harness.install.reconcileInstalledRulesets();
    expect((await profile(SYNTHETIC_RULESET_ID))?.allowedEntryIds ?? []).toEqual([]);
  });
});

describe("reimporting the same content changes nothing", () => {
  it("reports no ruleset update and moves no timestamp", async () => {
    await importPack(spellPackV2Json(), { createRuleset: true });
    const before = await profile();
    harness.tick();

    const preview = await harness.install.preview([spellPackV2Json()]);
    // The same version is already installed, so the import is refused as such.
    expect(preview.verdict).toBe("already-current");

    const repairs = await harness.install.reconcileInstalledRulesets();
    expect(repairs.filter(repair => repair.rulesetId === SPELL_RULESET_ID)).toEqual([]);
    expect(await profile()).toEqual(before);

    // And a second pass finds nothing at all, including for any profile the
    // first pass did repair.
    expect(await harness.install.reconcileInstalledRulesets()).toEqual([]);
  });

  it("produces no second profile and no category churn", async () => {
    await importPack(spellPackV2Json(), { createRuleset: true });
    const before = await profile();
    await harness.install.inspectInstalledRulesets();
    await harness.install.inspectInstalledRulesets();
    expect((await harness.context.repositories.content.listRulesets()).filter(item => item.id === SPELL_RULESET_ID))
      .toHaveLength(1);
    expect((await profile())?.allowedCategories).toEqual(before?.allowedCategories);
    expect((await profile())?.updatedAt).toBe(before?.updatedAt);
  });
});

describe("content that has no spells is unaffected", () => {
  it("installs a spell-less pack and scopes it to exactly its own categories", async () => {
    await importPack(spellPackV1Json(), { createRuleset: true });
    expect((await profile())?.allowedCategories).toEqual(V1_CATEGORIES);
    expect((await profile())?.allowedCategories).not.toContain("spell");
  });

  it("leaves the seeded ruleset alone when an unrelated pack gains a category", async () => {
    const seeded = await profile(SYNTHETIC_RULESET_ID);
    await importPack(spellPackV2Json(), { createRuleset: true });
    expect(await profile(SYNTHETIC_RULESET_ID)).toEqual(seeded);
  });

  it("keeps a non-caster build free of any spell step", async () => {
    await importPack(spellPackV2Json(), { createRuleset: true });
    const plan = planBuild({ ...tidecallerDraft(), classId: undefined }, await reachableEntries(), "guided");
    expect(plan.spellAvailability.spells).toEqual([]);
  });
});
