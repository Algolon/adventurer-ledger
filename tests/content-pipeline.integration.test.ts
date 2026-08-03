import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { savePackEntry } from "@/src/content/save-pack-entry";
import {
  createContentExport,
  RestrictedExportConfirmationError,
} from "@/src/export/content-export";
import {
  confirmImport,
  previewContentPack,
} from "@/src/import/content-pipeline";
import { validateContentPackJson } from "@/src/import/validate-pack";
import { LedgerDB } from "@/src/storage/db";
import {
  ContentEntryRepository,
  ContentPackRepository,
  SourceRepository,
} from "@/src/storage/content-repositories";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

let database: LedgerDB;
beforeEach(() => {
  database = new LedgerDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  database.close();
  await database.delete();
});

describe("private content pipeline", () => {
  it("imports a valid pack atomically and makes the entry discoverable", async () => {
    const preview = await previewContentPack(
      JSON.stringify(syntheticPack()),
      database,
    );
    expect(preview.canImport).toBe(true);
    expect(preview.plan.entries.add).toEqual(["rule:synthetic-moon-path"]);
    await confirmImport(preview, database);
    await expect(
      database.contentPacks.get("pack:synthetic-moon"),
    ).resolves.toMatchObject({ entryIds: ["rule:synthetic-moon-path"] });
    await expect(
      database.contentEntries.get("rule:synthetic-moon-path"),
    ).resolves.toMatchObject({ name: "Synthetic Moon Path", revision: 1 });
  });
  it.each(["pilot", "partial"] as const)("keeps %s coverage explicit in preview, storage, and diagnostics", async (coverage) => {
    const document = syntheticPack({ coverage });
    document.pack.id = `private-synthetic-moon-${coverage}`;
    document.pack.name = `Synthetic Moon ${coverage}`;
    const preview = await previewContentPack(JSON.stringify(document), database);
    expect(preview.canImport).toBe(true);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: "PACK_INCOMPLETE", severity: "warning", recordId: document.pack.id }));
    expect(JSON.stringify(preview.issues)).toContain("not a complete source");
    await confirmImport(preview, database);
    await expect(database.contentPacks.get(document.pack.id)).resolves.toMatchObject({ coverage });
  });
  it("previews and applies the deterministic v0 to v2 migration", async () => {
    const legacy = { ...syntheticPack(), schemaVersion: 0 };
    const preview = await previewContentPack(JSON.stringify(legacy), database);
    expect(preview.canImport).toBe(true);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MIGRATION_APPLIED" }),
      ]),
    );
    await confirmImport(preview, database);
    await expect(
      database.contentPacks.get("pack:synthetic-moon"),
    ).resolves.toMatchObject({ schemaVersion: 2, dependencies: [] });
  });
  it("does not mutate the database for an invalid pack", async () => {
    const invalid = {
      ...syntheticPack(),
      unexpectedPrivateField: "SECRET-NEVER-ECHO",
    };
    const preview = await previewContentPack(JSON.stringify(invalid), database);
    expect(preview.canImport).toBe(false);
    await expect(confirmImport(preview, database)).rejects.toThrow(
      "blocking issues",
    );
    expect(await database.sources.count()).toBe(0);
    expect(await database.contentPacks.count()).toBe(0);
    expect(await database.contentEntries.count()).toBe(0);
    expect(JSON.stringify(preview.issues)).not.toContain("SECRET-NEVER-ECHO");
  });
  it("revalidates original input and ignores mutated preview content", async () => {
    const original = syntheticPack(),
      preview = await previewContentPack(JSON.stringify(original), database);
    if (!preview.document) throw new Error("Expected a valid preview");
    preview.document.entries[0].fullText =
      "<img src=x onerror=PRIVATE_SYNTHETIC_EXECUTION()>";
    await confirmImport(preview, database);
    expect(
      (await database.contentEntries.get("rule:synthetic-moon-path"))?.fullText,
    ).toBe(original.entries[0].fullText);
    const forged = { ...preview };
    await expect(confirmImport(forged, database)).rejects.toThrow("invalid");
  });
  it("rejects stale previews before writing any import records", async () => {
    const document = syntheticPack(),
      preview = await previewContentPack(JSON.stringify(document), database),
      stamp = "2026-08-03T09:00:00.000Z";
    await database.sources.add({
      ...document.sources[0],
      createdAt: stamp,
      updatedAt: stamp,
    });
    await expect(confirmImport(preview, database)).rejects.toThrow(
      "stale for source source:synthetic-moon",
    );
    expect(await database.contentPacks.count()).toBe(0);
    expect(await database.contentEntries.count()).toBe(0);
    expect(await database.sources.count()).toBe(1);
  });
  it("reports duplicate IDs and revision conflicts during preview", async () => {
    const duplicate = syntheticPack();
    duplicate.entries.push({ ...duplicate.entries[0] });
    const duplicatePreview = await previewContentPack(
      JSON.stringify(duplicate),
      database,
    );
    expect(duplicatePreview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_ID",
          recordId: "rule:synthetic-moon-path",
        }),
      ]),
    );
    const initial = await previewContentPack(
      JSON.stringify(syntheticPack()),
      database,
    );
    await confirmImport(initial, database);
    const conflict = await previewContentPack(
      JSON.stringify(syntheticPack({ packVersion: "1.1.0", revision: 1 })),
      database,
    );
    expect(conflict.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ENTRY_REVISION_CONFLICT" }),
      ]),
    );
    expect(conflict.canImport).toBe(false);
  });
  it("rolls back an aborted import without partial records", async () => {
    const preview = await previewContentPack(
      JSON.stringify(syntheticPack()),
      database,
    );
    const controller = new AbortController();
    const confirmation = confirmImport(preview, database, controller.signal);
    controller.abort();
    await expect(confirmation).rejects.toMatchObject({ name: "AbortError" });
    expect(await database.sources.count()).toBe(0);
    expect(await database.contentPacks.count()).toBe(0);
    expect(await database.contentEntries.count()).toBe(0);
  });
  it("recovers the previous state when storage closes during confirmation", async () => {
    const preview = await previewContentPack(
        JSON.stringify(syntheticPack()),
        database,
      ),
      confirmation = confirmImport(preview, database);
    database.close();
    await expect(confirmation).rejects.toBeDefined();
    await database.open();
    expect(await database.sources.count()).toBe(0);
    expect(await database.contentPacks.count()).toBe(0);
    expect(await database.contentEntries.count()).toBe(0);
  });
  it("versions packs and entries when a newer import replaces them", async () => {
    await confirmImport(
      await previewContentPack(JSON.stringify(syntheticPack()), database),
      database,
    );
    await confirmImport(
      await previewContentPack(
        JSON.stringify(syntheticPack({ packVersion: "1.1.0", revision: 2 })),
        database,
      ),
      database,
    );
    await expect(database.contentPackVersions.toArray()).resolves.toHaveLength(
      1,
    );
    await expect(database.contentEntryVersions.toArray()).resolves.toHaveLength(
      1,
    );
    await expect(
      database.contentEntries.get("rule:synthetic-moon-path"),
    ).resolves.toMatchObject({ revision: 2, version: "1.1.0" });
  });
  it("excludes restricted content by default and requires explicit confirmation", async () => {
    const pack = syntheticPack({ entryRestricted: true });
    await confirmImport(
      await previewContentPack(JSON.stringify(pack), database),
      database,
    );
    const standard = await createContentExport(database);
    expect(standard).toHaveLength(1);
    expect(standard[0]?.pack.coverage).toBe("complete");
    expect(standard[0]?.entries).toEqual([]);
    expect(validateContentPackJson(JSON.stringify(standard[0])).success).toBe(
      true,
    );
    await expect(
      createContentExport(database, { includeRestricted: true }),
    ).rejects.toBeInstanceOf(RestrictedExportConfirmationError);
    const confirmed = await createContentExport(database, {
      includeRestricted: true,
      confirmedRestrictedExport: true,
    });
    expect(confirmed[0]?.entries).toHaveLength(1);
    const whollyRestricted = syntheticPack({
      packRestricted: true,
      packVersion: "2.0.0",
      revision: 2,
    });
    await confirmImport(
      await previewContentPack(JSON.stringify(whollyRestricted), database),
      database,
    );
    expect(await createContentExport(database)).toEqual([]);
  });
  it("never logs private imported text or returns it in validation issues", async () => {
    const secret = "PRIVATE-SYNTHETIC-NEVER-LOG";
    const log = vi.spyOn(console, "log").mockImplementation(() => {}),
      error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pack = syntheticPack();
    pack.entries[0].fullText = secret.repeat(50000);
    const preview = await previewContentPack(JSON.stringify(pack), database);
    expect(preview.canImport).toBe(false);
    expect(JSON.stringify(preview.issues)).not.toContain(secret);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });
});

describe("content repositories", () => {
  it("supports local CRUD and preserves immutable edit/delete history", async () => {
    const document = syntheticPack();
    const stamp = "2026-08-03T08:00:00.000Z";
    const source = {
      ...document.sources[0],
      createdAt: stamp,
      updatedAt: stamp,
    };
    const entry = { ...document.entries[0] };
    const pack = {
      ...document.pack,
      schemaVersion: 1,
      sourceIds: [source.id],
      entryIds: [entry.id],
      createdAt: stamp,
      updatedAt: stamp,
    };
    const sourceRepo = new SourceRepository(database),
      packRepo = new ContentPackRepository(database),
      entryRepo = new ContentEntryRepository(database);
    await sourceRepo.create(source);
    await packRepo.create(pack);
    await entryRepo.create(entry);
    await sourceRepo.update(source.id, { name: "Renamed synthetic source" });
    await packRepo.update(pack.id, { name: "Renamed synthetic pack" });
    await entryRepo.update(entry.id, { name: "Renamed synthetic entry" });
    expect((await sourceRepo.get(source.id))?.name).toBe(
      "Renamed synthetic source",
    );
    expect(await packRepo.versions(pack.id)).toHaveLength(1);
    expect(await entryRepo.versions(entry.id)).toHaveLength(1);
    await entryRepo.delete(entry.id);
    await packRepo.delete(pack.id);
    expect(await entryRepo.versions(entry.id)).toHaveLength(2);
    expect(await packRepo.versions(pack.id)).toHaveLength(2);
    await expect(entryRepo.create(entry)).rejects.toThrow("archived");
    await expect(packRepo.create(pack)).rejects.toThrow("archived");
    await sourceRepo.delete(source.id);
    expect(await sourceRepo.list()).toEqual([]);
  });
  it("rolls back the editor slice when the pack write fails", async () => {
    const document = syntheticPack(),
      stamp = "2026-08-03T08:00:00.000Z",
      source = { ...document.sources[0], createdAt: stamp, updatedAt: stamp },
      existingPack = {
        ...document.pack,
        schemaVersion: 1,
        sourceIds: [source.id],
        entryIds: [],
        createdAt: stamp,
        updatedAt: stamp,
      },
      sourceRepo = new SourceRepository(database),
      packRepo = new ContentPackRepository(database);
    await sourceRepo.create(source);
    await packRepo.create(existingPack);
    await expect(
      savePackEntry(database, {
        entry: document.entries[0],
        pack: { ...existingPack, entryIds: [document.entries[0].id] },
      }),
    ).rejects.toThrow("already exists");
    expect(await database.contentEntries.count()).toBe(0);
    expect((await packRepo.get(existingPack.id))?.entryIds).toEqual([]);
  });
  it("rejects complete coverage for a pilot identity at the editor service boundary", async () => {
    const document = syntheticPack(), stamp = "2026-08-03T08:00:00.000Z";
    const source = { ...document.sources[0], createdAt: stamp, updatedAt: stamp };
    await new SourceRepository(database).create(source);
    const pack = {
      ...document.pack,
      id: "pack:synthetic-editor-pilot",
      name: "Synthetic Editor Pilot",
      coverage: "complete" as const,
      schemaVersion: 2,
      sourceIds: [source.id],
      entryIds: [document.entries[0].id],
      createdAt: stamp,
      updatedAt: stamp,
    };
    await expect(savePackEntry(database, { entry: document.entries[0], pack })).rejects.toThrow("inconsistent coverage metadata");
    expect(await database.contentEntries.count()).toBe(0);
    expect(await database.contentPacks.count()).toBe(0);
  });
});
