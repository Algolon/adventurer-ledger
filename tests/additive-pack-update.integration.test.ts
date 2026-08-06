import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentPackDocument } from "@/src/domain/content-pack";
type DocumentEntry = ContentPackDocument["entries"][number];
import { confirmImport, previewContentPack } from "@/src/import/content-pipeline";
import { LedgerDB } from "@/src/storage/db";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

let database: LedgerDB;
beforeEach(() => {
  database = new LedgerDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  database.close();
  await database.delete();
});

/**
 * A pack whose entries are named A/B/C so the three dispositions an additive
 * update must distinguish -- unchanged, revised and new -- can be asserted
 * independently. Entirely original synthetic content.
 */
const entry = (id: string, revision: number, overrides: Record<string, unknown> = {}): DocumentEntry => {
  const base = syntheticPack().entries[0];
  return {
    ...base,
    id,
    slug: id.split(":")[1],
    name: `Synthetic ${id.split(":")[1]}`,
    revision,
    conflict: { ...base.conflict, conflictKey: id },
    ...overrides,
  } as DocumentEntry;
};

const packWith = (version: string, entries: readonly DocumentEntry[]): ContentPackDocument => {
  const document = syntheticPack({ packVersion: version });
  return { ...document, entries: [...entries] };
};

const A = "rule:synthetic-alpha", B = "rule:synthetic-beta", C = "rule:synthetic-gamma";

/** Install v1 with A and B, both at revision 1. */
async function installBaseline() {
  const preview = await previewContentPack(
    JSON.stringify(packWith("1.0.0", [entry(A, 1), entry(B, 1)])),
    database,
  );
  expect(preview.canImport).toBe(true);
  await confirmImport(preview, database);
}

const errorCodes = (issues: readonly { severity: string; code: string }[]) =>
  issues.filter(issue => issue.severity === "error").map(issue => issue.code);

describe("additive content pack updates", () => {
  it("accepts a mixed update: A unchanged, B revised, C new", async () => {
    await installBaseline();
    const preview = await previewContentPack(
      JSON.stringify(packWith("1.1.0", [
        entry(A, 1),
        entry(B, 2, { summary: "Revised synthetic navigation rule." }),
        entry(C, 1),
      ])),
      database,
    );
    expect(errorCodes(preview.issues)).toEqual([]);
    expect(preview.canImport).toBe(true);
    expect(preview.plan.entries.add).toEqual([C]);
    expect(preview.plan.entries.update).toEqual([B]);
    expect(preview.plan.entries.add).not.toContain(A);
    expect(preview.plan.entries.update).not.toContain(A);
    expect(preview.plan.packs.update).toEqual(["pack:synthetic-moon"]);
  });

  it("leaves an unchanged entry untouched: no rewrite, no updatedAt change, no history row", async () => {
    await installBaseline();
    const before = await database.contentEntries.get(A);
    expect(before).toBeDefined();

    const preview = await previewContentPack(
      JSON.stringify(packWith("1.1.0", [
        entry(A, 1),
        entry(B, 2, { summary: "Revised synthetic navigation rule." }),
        entry(C, 1),
      ])),
      database,
    );
    await confirmImport(preview, database);

    const after = await database.contentEntries.get(A);
    expect(after).toEqual(before);
    expect(after?.createdAt).toBe(before?.createdAt);
    expect(after?.updatedAt).toBe(before?.updatedAt);

    // The unchanged record produces no history; the revised one produces exactly one.
    await expect(database.contentEntryVersions.where("entryId").equals(A).count()).resolves.toBe(0);
    await expect(database.contentEntryVersions.where("entryId").equals(B).count()).resolves.toBe(1);
    await expect(database.contentEntries.get(C)).resolves.toMatchObject({ id: C, revision: 1 });
    await expect(database.contentPacks.get("pack:synthetic-moon")).resolves.toMatchObject({ version: "1.1.0" });
  });

  it("blocks an equal revision whose deeply nested content changed", async () => {
    await installBaseline();
    const mutated = entry(A, 1, {
      // One nested effect target differs; the revision is deliberately unchanged.
      effects: [{ id: "effect:synthetic-marker", type: "addAdvantage", target: "synthetic-navigation-altered" }],
    });
    const preview = await previewContentPack(
      JSON.stringify(packWith("1.1.0", [mutated, entry(B, 1)])),
      database,
    );
    expect(preview.canImport).toBe(false);
    expect(errorCodes(preview.issues)).toContain("ENTRY_REVISION_CONFLICT");
    const issue = preview.issues.find(i => i.code === "ENTRY_REVISION_CONFLICT");
    expect(issue).toMatchObject({ recordId: A, installedRevision: 1, incomingRevision: 1 });
    expect(issue?.message).toMatch(/revision/i);

    await expect(confirmImport(preview, database)).rejects.toThrow();
    await expect(database.contentEntries.get(A)).resolves.toMatchObject({
      effects: [{ id: "effect:synthetic-marker", type: "addAdvantage", target: "synthetic-navigation" }],
    });
  });

  it("blocks a downgrade and keeps the installed newer record", async () => {
    const first = await previewContentPack(
      JSON.stringify(packWith("1.1.0", [entry(A, 3)])),
      database,
    );
    await confirmImport(first, database);

    const preview = await previewContentPack(
      JSON.stringify(packWith("1.2.0", [entry(A, 2)])),
      database,
    );
    expect(preview.canImport).toBe(false);
    expect(preview.issues).toContainEqual(
      expect.objectContaining({ code: "ENTRY_REVISION_CONFLICT", recordId: A, installedRevision: 3, incomingRevision: 2 }),
    );
    await expect(database.contentEntries.get(A)).resolves.toMatchObject({ revision: 3 });
    await expect(database.contentEntryVersions.where("entryId").equals(A).count()).resolves.toBe(0);
  });

  it("updates a newer pack whose entries are all semantically unchanged", async () => {
    await installBaseline();
    const before = await database.contentEntries.bulkGet([A, B]);

    const preview = await previewContentPack(
      JSON.stringify(packWith("2.0.0", [entry(A, 1), entry(B, 1)])),
      database,
    );
    expect(errorCodes(preview.issues)).toEqual([]);
    expect(preview.canImport).toBe(true);
    expect(preview.plan.entries.add).toEqual([]);
    expect(preview.plan.entries.update).toEqual([]);
    expect(preview.plan.packs.update).toEqual(["pack:synthetic-moon"]);

    await confirmImport(preview, database);
    await expect(database.contentPacks.get("pack:synthetic-moon")).resolves.toMatchObject({
      version: "2.0.0",
      entryIds: [A, B],
    });
    await expect(database.contentEntries.bulkGet([A, B])).resolves.toEqual(before);
    await expect(database.contentEntryVersions.count()).resolves.toBe(0);
  });

  it("blocks the whole import atomically when one entry reuses a revision", async () => {
    await installBaseline();
    const preview = await previewContentPack(
      JSON.stringify(packWith("1.1.0", [
        entry(A, 1, { summary: "Changed without a revision bump." }),
        entry(B, 2, { summary: "Legitimately revised." }),
        entry(C, 1),
      ])),
      database,
    );
    expect(preview.canImport).toBe(false);
    await expect(confirmImport(preview, database)).rejects.toThrow();

    // Neither the valid update nor the valid add may land.
    await expect(database.contentEntries.get(C)).resolves.toBeUndefined();
    await expect(database.contentEntries.get(B)).resolves.toMatchObject({ revision: 1 });
    await expect(database.contentEntryVersions.count()).resolves.toBe(0);
    await expect(database.contentPacks.get("pack:synthetic-moon")).resolves.toMatchObject({ version: "1.0.0" });
  });

  it("refuses confirmation when an entry seen as unchanged changes before commit", async () => {
    await installBaseline();
    const preview = await previewContentPack(
      JSON.stringify(packWith("1.1.0", [entry(A, 1), entry(B, 1), entry(C, 1)])),
      database,
    );
    expect(preview.canImport).toBe(true);

    // The installed record moves on after the preview was taken.
    const installed = await database.contentEntries.get(A);
    await database.contentEntries.put({
      ...installed!,
      revision: 5,
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    await expect(confirmImport(preview, database)).rejects.toThrow();
    await expect(database.contentEntries.get(C)).resolves.toBeUndefined();
    await expect(database.contentEntries.get(A)).resolves.toMatchObject({ revision: 5 });
  });
});
