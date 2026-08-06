import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import {
  CharacterMigrationError,
  migrateLegacyCharacter,
  migrateLegacySnapshot,
  migrateLegacyVersion,
} from "@/src/migrations/character-m2-1";
import { isAllowedTargetPath } from "@/src/domain/character-record";
import { LedgerDB } from "@/src/storage/db";
import { createCharacterRepositories } from "@/src/storage/character-repositories";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";
import { characterFixture, runtimeFixture, versionFixture } from "@/tests/fixtures/character-records";

const databases: LedgerDB[] = [];
function openDatabase(name: string) {
  const database = new LedgerDB(name);
  databases.push(database);
  return database;
}

afterEach(async () => {
  while (databases.length) {
    const database = databases.pop();
    database?.close();
  }
});

/** Recreates the pre-M2.1 schema so the version 4 → 5 upgrade can be exercised for real. */
class LegacyDB extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      characters: "id,name,level,status,kind,rulesetProfileId,updatedAt,*tags",
      characterVersions: "id,characterId,sequence",
      characterSnapshots: "id,characterId,characterVersionId",
      sources: "id,name,edition,priority,visibility,enabledByDefault",
      contentPacks: "id,name,version,schemaVersion,visibility,exportRestricted",
      contentEntries: "id,slug,name,category,rulesEdition,sourceId,visibility,legacy,private,exportRestricted,*aliases,*tags",
      rulesetProfiles: "id,name,*activeSourceIds",
      validationIssues: "id,characterId,severity,code,resolvedAt",
      overrideDecisions: "id,validationIssueId,characterId",
      migrationRecords: "id,area,fromVersion,toVersion,status",
    });
    this.version(2).stores({ contentPackVersions: "id,packId,sequence,updatedAt", contentEntryVersions: "id,entryId,revision,updatedAt" });
    this.version(3).stores({
      contentEntries: "id,slug,name,category,rulesEdition,sourceId,visibility,reviewStatus,legacy,private,exportRestricted,*aliases,*tags",
      contentPacks: "id,name,version,schemaVersion,visibility,exportRestricted,*dependencies,*optionalDependencies",
    });
    this.version(4).stores({ contentPacks: "id,name,version,schemaVersion,coverage,visibility,exportRestricted,*dependencies,*optionalDependencies" });
  }
}

const legacyCharacterRow = {
  id: "character:legacy-1",
  name: "Legacy synthetic record",
  level: 2,
  advancement: "milestone",
  classLevels: [{ classId: "class:vanguard", level: 2 }],
  speciesId: "species:riverborn",
  backgroundId: "background:caravan-warden",
  rulesetProfileId: "ruleset:runefolio-2024-synthetic",
  abilities: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 13, charisma: 8 },
  baseHitPoints: 12,
  currentHitPoints: 7,
  temporaryHitPoints: 3,
  exhaustion: 1,
  deathSaves: { successes: 1, failures: 0 },
  selections: [],
  biography: { backstory: "private narrative text" },
  tags: ["synthetic"],
  status: "active",
  kind: "player-character",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

describe("pure legacy character migration", () => {
  it("separates durable build state from runtime play state", () => {
    const { character, runtime } = migrateLegacyCharacter(legacyCharacterRow);

    expect(character.revision).toBe(1);
    expect(character.level).toBe(2);
    expect(character.classLevels).toEqual([{ classId: "class:vanguard", level: 2 }]);
    expect(character.abilityScores.strength).toBe(16);
    expect(character.contentFingerprint).toBe("legacy:unverified");
    // Runtime values must no longer be part of the durable record.
    expect(character).not.toHaveProperty("currentHitPoints");
    expect(character).not.toHaveProperty("temporaryHitPoints");
    expect(character).not.toHaveProperty("deathSaves");

    expect(runtime.characterId).toBe("character:legacy-1");
    expect(runtime.revision).toBe(1);
    expect(runtime.currentHitPoints).toBe(7);
    expect(runtime.maximumHitPointsAtLastSync).toBe(12);
    expect(runtime.temporaryHitPoints).toBe(3);
    expect(runtime.exhaustion).toBe(1);
    expect(runtime.deathSaves).toEqual({ successes: 1, failures: 0 });
  });

  it("is deterministic across repeated runs", () => {
    expect(migrateLegacyCharacter(legacyCharacterRow)).toEqual(migrateLegacyCharacter(legacyCharacterRow));
  });

  it("leaves an unparseable ability unknown instead of defaulting it to zero", () => {
    const { character } = migrateLegacyCharacter({
      ...legacyCharacterRow,
      abilities: { strength: 16, dexterity: "unset", constitution: 14 },
    });
    expect(character.abilityScores.strength).toBe(16);
    expect(character.abilityScores.dexterity).toBeUndefined();
    expect("dexterity" in character.abilityScores).toBe(false);
    expect(character.abilityScores.intelligence).toBeUndefined();
  });

  it("preserves a deceased legacy status as an archived record with a marker tag", () => {
    const { character } = migrateLegacyCharacter({ ...legacyCharacterRow, status: "deceased" });
    expect(character.status).toBe("archived");
    expect(character.tags).toContain("legacy:deceased");
  });

  it("reports a sanitized error that names the field path but no private value", () => {
    const attempt = () => migrateLegacyCharacter({ ...legacyCharacterRow, id: undefined });
    expect(attempt).toThrow(CharacterMigrationError);
    try {
      attempt();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("id");
      expect(message).not.toContain("private narrative text");
      expect(message).not.toContain("Legacy synthetic record");
    }
  });

  it("rejects an unexpected abilities container by field path only", () => {
    try {
      migrateLegacyCharacter({ ...legacyCharacterRow, abilities: "private" });
      throw new Error("expected a migration error");
    } catch (error) {
      expect(error).toBeInstanceOf(CharacterMigrationError);
      expect((error as CharacterMigrationError).fieldPath).toBe("abilities");
      expect((error as Error).message).not.toContain("private narrative text");
    }
  });

  it("converts legacy versions and snapshots without losing sequence or label", () => {
    const version = migrateLegacyVersion({
      id: "character:legacy-1@1",
      characterId: "character:legacy-1",
      sequence: 3,
      reason: "level-up",
      snapshot: legacyCharacterRow,
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(version.sequence).toBe(3);
    expect(version.reason).toBe("level-up");
    expect(version.operationId).toBe("migration:v5:character:legacy-1@1");
    expect(version.snapshot.revision).toBe(1);

    const snapshot = migrateLegacySnapshot({
      id: "snapshot:legacy-1",
      characterId: "character:legacy-1",
      label: "Before the session",
      characterVersionId: "character:legacy-1@1",
      runtimeState: { currentHitPoints: 4, temporaryHitPoints: 0, baseHitPoints: 12 },
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(snapshot.kind).toBe("explicit-session");
    expect(snapshot.label).toBe("Before the session");
    expect(snapshot.runtimeState.currentHitPoints).toBe(4);
  });
});

describe("database version 4 to 5 upgrade", () => {
  it("migrates characters while preserving content, packs and sources", async () => {
    const name = `ledger-upgrade-${Math.random().toString(36).slice(2)}`;
    const pack = syntheticPack();
    const legacy = new LegacyDB(name);
    await legacy.open();
    await legacy.table("characters").add(legacyCharacterRow);
    await legacy.table("characterVersions").add({
      id: "character:legacy-1@1",
      characterId: "character:legacy-1",
      sequence: 1,
      reason: "manual",
      snapshot: legacyCharacterRow,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await legacy.table("contentPacks").add({ ...pack.pack, sourceIds: [], entryIds: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    await legacy.table("sources").add({ ...pack.sources[0], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
    await legacy.table("contentEntries").add(pack.entries[0]);
    legacy.close();

    const upgraded = openDatabase(name);
    await upgraded.open();
    expect(upgraded.verno).toBe(6);

    // Content survives the character migration untouched.
    expect(await upgraded.contentPacks.count()).toBe(1);
    expect(await upgraded.sources.count()).toBe(1);
    const entry = await upgraded.contentEntries.get(pack.entries[0].id);
    expect(entry?.name).toBe(pack.entries[0].name);

    const character = await upgraded.characters.get("character:legacy-1");
    expect(character?.revision).toBe(1);
    expect(character).not.toHaveProperty("currentHitPoints");
    const runtime = await upgraded.characterRuntimeStates.get("character:legacy-1");
    expect(runtime?.currentHitPoints).toBe(7);
    expect(runtime?.revision).toBe(1);
    const version = await upgraded.characterVersions.get("character:legacy-1@1");
    expect(version?.operationId).toBe("migration:v5:character:legacy-1@1");

    // The new tables exist and start empty.
    expect(await upgraded.characterDrafts.count()).toBe(0);
    expect(await upgraded.characterActions.count()).toBe(0);
    expect(await upgraded.characterOverrides.count()).toBe(0);
    expect(await upgraded.characterDerivedSnapshots.count()).toBe(0);
    // Version 6 is additive: an explicit ruleset decision has simply not been made yet.
    expect(await upgraded.appPreferences.count()).toBe(0);
  });

  it("opens a fresh database directly at the current version with empty character tables", async () => {
    const database = openDatabase(`ledger-fresh-${Math.random().toString(36).slice(2)}`);
    await database.open();
    expect(database.verno).toBe(6);
    expect(await database.characters.count()).toBe(0);
    expect(await database.characterRuntimeStates.count()).toBe(0);
  });
});

describe("character repositories", () => {
  async function withRepositories() {
    const database = openDatabase(`ledger-repo-${Math.random().toString(36).slice(2)}`);
    await database.open();
    return { database, repositories: createCharacterRepositories(database) };
  }

  it("applies a compare-and-swap write and refuses a stale revision", async () => {
    const { repositories } = await withRepositories();
    const character = characterFixture();
    await repositories.characters.add(character);

    const accepted = await repositories.characters.replace({ ...character, revision: 2, name: "Renamed" }, 1);
    expect(accepted).toBe(true);

    const stale = await repositories.characters.replace({ ...character, revision: 2, name: "Ignored" }, 1);
    expect(stale).toBe(false);
    const stored = await repositories.characters.get(character.id);
    expect(stored?.name).toBe("Renamed");
    expect(stored?.revision).toBe(2);
  });

  it("refuses a second character with the same stable ID", async () => {
    const { repositories } = await withRepositories();
    await repositories.characters.add(characterFixture());
    await expect(repositories.characters.add(characterFixture())).rejects.toThrow();
  });

  it("rejects a duplicate version sequence and a duplicate operation ID", async () => {
    const { repositories } = await withRepositories();
    const character = characterFixture();
    await repositories.characters.add(character);
    await repositories.versions.append(versionFixture(character, 1, "operation:one"));

    await expect(repositories.versions.append(versionFixture(character, 1, "operation:two"))).rejects.toThrow(/sequence 1 already exists/);
    await expect(repositories.versions.append(versionFixture(character, 2, "operation:one"))).rejects.toThrow(/operation .* already exists/);
    expect(await repositories.versions.latestSequence(character.id)).toBe(1);
  });

  it("applies a compare-and-swap write to runtime state independently of the character", async () => {
    const { repositories } = await withRepositories();
    const character = characterFixture();
    await repositories.characters.add(character);
    await repositories.runtime.put(runtimeFixture(character.id));

    expect(await repositories.runtime.replace({ ...runtimeFixture(character.id), revision: 2, currentHitPoints: 5 }, 1)).toBe(true);
    expect(await repositories.runtime.replace({ ...runtimeFixture(character.id), revision: 3, currentHitPoints: 1 }, 1)).toBe(false);

    const runtime = await repositories.runtime.get(character.id);
    expect(runtime?.currentHitPoints).toBe(5);
    // The durable record is untouched by runtime writes.
    expect((await repositories.characters.get(character.id))?.revision).toBe(1);
  });

  it("rolls back every table when one write inside the transaction fails", async () => {
    const { database, repositories } = await withRepositories();
    const character = characterFixture();

    await expect(
      database.transaction("rw", database.characters, database.characterVersions, database.characterRuntimeStates, async () => {
        await repositories.characters.add(character);
        await repositories.runtime.put(runtimeFixture(character.id));
        await repositories.versions.append(versionFixture(character, 1, "operation:one"));
        // A late failure must discard the character, runtime and version together.
        await repositories.versions.append(versionFixture(character, 1, "operation:three"));
      }),
    ).rejects.toThrow();

    expect(await database.characters.count()).toBe(0);
    expect(await database.characterVersions.count()).toBe(0);
    expect(await database.characterRuntimeStates.count()).toBe(0);
  });
});

describe("override target path allow-list", () => {
  it("accepts the documented derived paths", () => {
    for (const path of [
      "proficiencyBonus",
      "hitPoints.maximum",
      "armorClass",
      "initiative",
      "speed",
      "abilityScore.strength",
      "abilityModifier.dexterity",
      "savingThrow.proficiency:save-strength",
      "check.proficiency:skill-watchcraft",
      "resource.resource:rallying-breath.maximum",
      "attack.action:longblade-strike.attackBonus",
    ])
      expect(isAllowedTargetPath(path)).toBe(true);
  });

  it("rejects unknown paths, traversal and expression-like input without evaluating them", () => {
    for (const path of [
      "",
      "abilityScore.luck",
      "__proto__",
      "constructor.prototype",
      "hitPoints.maximum; drop",
      "resource.../../secret",
      "attack.${process.env.HOME}",
      "eval(1)",
      "biography.backstory",
    ])
      expect(isAllowedTargetPath(path)).toBe(false);
  });
});
