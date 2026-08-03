import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { contentEntrySchema, effectSchema } from "@/src/domain/content-pack";
import { validateContentPackJson } from "@/src/import/validate-pack";
import { resolveContentRelations } from "@/src/domain/resolve-content";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import { LedgerDB } from "@/src/storage/db";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

const literal = { kind: "literal" as const, value: 1 };
const base = { id: "effect:test" };
const effects = [
  { ...base, type: "grantProficiency", proficiencyId: "proficiency:test" }, { ...base, type: "grantExpertise", proficiencyId: "proficiency:test" },
  { ...base, type: "grantFeature", featureId: "feature:test" }, { ...base, type: "replaceFeature", featureId: "feature:old", replacementId: "feature:new" }, { ...base, type: "disableFeature", featureId: "feature:test" }, { ...base, type: "grantChoice", choiceId: "choice:test" },
  { ...base, type: "modifyAbility", ability: "strength", operation: "add", value: literal }, { ...base, type: "modifyAbilityMaximum", ability: "strength", operation: "add", value: literal },
  { ...base, type: "modifySkill", target: "skill:test", operation: "add", value: literal }, { ...base, type: "modifySavingThrow", target: "save:test", operation: "add", value: literal },
  ...["modifyArmorClass", "modifyInitiative", "modifySpeed", "modifyCriticalRange"].map(type => ({ ...base, type, operation: "add", value: literal })),
  { ...base, type: "modifyAttack", selector: { kind: "melee" }, operation: "add", value: literal }, { ...base, type: "modifyDamage", selector: { kind: "melee" }, operation: "add", value: literal },
  { ...base, type: "addSpell", spellId: "spell:test" }, { ...base, type: "addSpellList", spellListId: "spell-list:test" },
  { ...base, type: "addResource", resource: { id: "resource:test", name: "Synthetic resource", maximum: literal, recharge: "short-rest" } },
  ...["addAttack", "addAction", "addBonusAction", "addReaction"].map(type => ({ ...base, type, definitionId: "definition:test" })),
  ...["setMinimum", "setMaximum", "setCalculation"].map(type => ({ ...base, type, target: "value:test", value: literal })),
  { ...base, type: "addAdvantage", target: "test" }, { ...base, type: "addDisadvantage", target: "test" },
  { ...base, type: "rechargeOnShortRest", resourceId: "resource:test" }, { ...base, type: "rechargeOnLongRest", resourceId: "resource:test" },
  { ...base, type: "unlockAtLevel", level: 2, effect: { ...base, id: "effect:nested", type: "grantFeature", featureId: "feature:test" } },
  { ...base, type: "scaleAtLevel", levels: { "5": literal }, target: "value:test" },
  ...["addWeaponMastery", "grantFightingStyle", "grantManeuver", "grantInvocation", "grantMetamagic"].map(type => ({ ...base, type, optionId: "option:test" })),
];

describe("schema v2", () => {
  it("fully validates every declarative effect variant", () => {
    for (const effect of effects) expect(effectSchema.safeParse(effect).success, String(effect.type)).toBe(true);
    expect(effectSchema.safeParse({ id: "effect:bad", type: "addResource" }).success).toBe(false);
    expect(effectSchema.safeParse({ id: "effect:bad", type: "modifyAbility", ability: "strength", operation: "execute", value: literal }).success).toBe(false);
  });
  it("uses category-discriminated mechanics", () => {
    const entry = syntheticPack().entries[0];
    expect(contentEntrySchema.safeParse(entry).success).toBe(true);
    expect(contentEntrySchema.safeParse({ ...entry, category: "spell" }).success).toBe(false);
    expect(contentEntrySchema.safeParse({ ...entry, category: "monster", mechanics: { armorClass: 10 } }).success).toBe(false);
  });
  it("migrates v1 without losing synthetic text", () => {
    const current = syntheticPack(), entry = current.entries[0], pack = current.pack;
    const { sourceLocator: _locator, reviewStatus: _review, links: _links, mechanics: _mechanics, conflict: _conflict, editionRelations: _relations, ...legacyEntry } = entry;
    const { dependencies: _dependencies, optionalDependencies: _optional, ...legacyPack } = pack;
    const result = validateContentPackJson(JSON.stringify({ ...current, schemaVersion: 1, pack: legacyPack, entries: [legacyEntry] }));
    expect(result.success).toBe(true);
    expect(result.data?.entries[0]).toMatchObject({ fullText: entry.fullText, summary: entry.summary, reviewStatus: "extracted" });
  });
  it("resolves source conflicts deterministically without copying text", () => {
    const entry = syntheticPack().entries[0], lower = { ...entry, id: "rule:lower", conflict: { ...entry.conflict, sourcePriority: 1, conflictKey: "rule:shared" } }, higher = { ...entry, id: "rule:higher", fullText: "Synthetic private marker", conflict: { ...entry.conflict, sourcePriority: 20, conflictKey: "rule:shared" } };
    const resolution = resolveContentRelations([lower, higher]);
    expect(resolution.conflicts[0]?.winner.id).toBe("rule:higher");
    expect(JSON.stringify(resolution.conflicts.map(conflict => ({ key: conflict.key, winner: conflict.winner.id })))).not.toContain("Synthetic private marker");
  });
});

let database: LedgerDB;
afterEach(async () => { if (database) { database.close(); await database.delete(); } });
describe("multi-file dependency imports", () => {
  it("resolves references across packs and confirms them atomically", async () => {
    database = new LedgerDB(`set-${crypto.randomUUID()}`);
    const dependency = syntheticPack(), dependent = syntheticPack();
    dependency.pack.id = "pack:dependency"; dependency.pack.name = "Synthetic dependency";
    dependency.sources[0].id = "source:dependency"; dependency.entries[0].id = "rule:dependency"; dependency.entries[0].sourceId = "source:dependency"; dependency.entries[0].sourceLocator.sourceId = "source:dependency";
    dependent.pack.id = "pack:dependent"; dependent.pack.name = "Synthetic dependent"; dependent.pack.dependencies = ["pack:dependency"];
    dependent.sources[0].id = "source:dependent"; dependent.entries[0].id = "rule:dependent"; dependent.entries[0].sourceId = "source:dependent"; dependent.entries[0].sourceLocator.sourceId = "source:dependent";
    dependent.entries[0].links = [{ type: "feature", targetId: "rule:dependency", required: true }];
    const preview = await previewContentPackSet([JSON.stringify(dependent), JSON.stringify(dependency)], database);
    expect(preview.canImport).toBe(true);
    await confirmImportSet(preview, database);
    await expect(database.contentPacks.count()).resolves.toBe(2);
    const repeated = await previewContentPackSet([JSON.stringify(dependent), JSON.stringify(dependency)], database);
    expect(repeated.canImport).toBe(false);
    expect(repeated.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["PACK_VERSION_CONFLICT", "ENTRY_REVISION_CONFLICT"]));
  });
  it("rolls back every pack when a later write fails", async () => {
    database = new LedgerDB(`rollback-set-${crypto.randomUUID()}`);
    const first = syntheticPack(), second = syntheticPack();
    first.pack.id = "pack:first"; first.sources[0].id = "source:first"; first.entries[0].id = "rule:first"; first.entries[0].sourceId = "source:first"; first.entries[0].sourceLocator.sourceId = "source:first";
    second.pack.id = "pack:second"; second.sources[0].id = "source:second"; second.entries[0].id = "rule:second"; second.entries[0].sourceId = "source:second"; second.entries[0].sourceLocator.sourceId = "source:second"; second.pack.dependencies = ["pack:first"];
    const preview = await previewContentPackSet([JSON.stringify(first), JSON.stringify(second)], database);
    database.contentEntries.hook("creating", (_key, record) => { if (record.id === "rule:second") throw new Error("Synthetic storage failure"); });
    await expect(confirmImportSet(preview, database)).rejects.toThrow("Synthetic storage failure");
    expect(await database.contentPacks.count()).toBe(0);
    expect(await database.contentEntries.count()).toBe(0);
  });
  it("blocks dependency cycles and cross-file source duplicates during preview", async () => {
    database = new LedgerDB(`invalid-set-${crypto.randomUUID()}`);
    const first = syntheticPack(), second = syntheticPack();
    first.pack.id = "pack:first"; first.pack.dependencies = ["pack:second"]; first.entries[0].id = "rule:first";
    second.pack.id = "pack:second"; second.pack.dependencies = ["pack:first"]; second.entries[0].id = "rule:second";
    const preview = await previewContentPackSet([JSON.stringify(first), JSON.stringify(second)], database);
    expect(preview.canImport).toBe(false);
    expect(preview.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["DEPENDENCY_CYCLE", "DUPLICATE_ID"]));
  });
  it("upgrades stored v1 records transactionally", async () => {
    const name = `migration-${crypto.randomUUID()}`, current = syntheticPack(), entry = current.entries[0], pack = current.pack;
    const { sourceLocator: _locator, reviewStatus: _review, links: _links, mechanics: _mechanics, conflict: _conflict, editionRelations: _relations, ...legacyEntry } = entry;
    const { dependencies: _dependencies, optionalDependencies: _optional, ...legacyPack } = pack;
    const legacy = new Dexie(name);
    legacy.version(1).stores({ contentEntries: "id", contentPacks: "id" });
    legacy.version(2).stores({ contentEntries: "id", contentPacks: "id" });
    await legacy.table("contentEntries").add(legacyEntry);
    await legacy.table("contentPacks").add({ ...legacyPack, schemaVersion: 1, sourceIds: [], entryIds: [entry.id], createdAt: entry.createdAt, updatedAt: entry.updatedAt });
    legacy.close();
    database = new LedgerDB(name);
    const migratedEntry = await database.contentEntries.get(entry.id), migratedPack = await database.contentPacks.get(pack.id);
    expect(migratedEntry).toMatchObject({ fullText: entry.fullText, reviewStatus: "extracted", mechanics: { kind: "rule" } });
    expect(migratedPack).toMatchObject({ schemaVersion: 2, dependencies: [], optionalDependencies: [] });
  });
});
