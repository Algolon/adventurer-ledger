import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import { validateContentPackJson } from "@/src/import/validate-pack";
import { LedgerDB } from "@/src/storage/db";
import { resolveContentRelations } from "@/src/domain/resolve-content";

const privatePackPath = process.env.ADVENTURER_LEDGER_PRIVATE_PACK;
const database = new LedgerDB(`private-local-${crypto.randomUUID()}`);
afterAll(async () => { database.close(); await database.delete(); });
describe.skipIf(!privatePackPath)("local private ingestion", () => {
  it("passes the production validator, preview and importer without printing content", async () => {
    if (!privatePackPath) throw new Error("Private pack path was not provided");
    const json = await readFile(privatePackPath, "utf8"), validation = validateContentPackJson(json);
    expect(validation.success).toBe(true);
    const preview = await previewContentPackSet([json], database);
    expect(preview.canImport).toBe(true);
    expect(preview.issues.map(issue => issue.code)).toContain("OPTIONAL_DEPENDENCY_MISSING");
    await confirmImportSet(preview, database);
    expect(await database.contentEntries.count()).toBe(validation.data?.entries.length);
    const relations = resolveContentRelations(await database.contentEntries.toArray());
    expect(relations.missingRequired).toEqual([]);
    const repeated = await previewContentPackSet([json], database);
    expect(repeated.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["PACK_VERSION_CONFLICT", "ENTRY_REVISION_CONFLICT"]));
  });
});
