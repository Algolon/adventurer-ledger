import "fake-indexeddb/auto";
import { afterAll, describe, expect, it } from "vitest";
import type { ContentPackDocument } from "@/src/domain/content-pack";
import {
  confirmImport,
  previewContentPack,
} from "@/src/import/content-pipeline";
import { LedgerDB } from "@/src/storage/db";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";
const database = new LedgerDB(`benchmark-${crypto.randomUUID()}`);
afterAll(async () => {
  database.close();
  await database.delete();
});
describe("25k compact-entry benchmark", () => {
  it("reports synthetic import, stored payload, and indexed search timings", async () => {
    const base = syntheticPack(),
      entry = base.entries[0],
      document: ContentPackDocument = {
        ...base,
        entries: Array.from({ length: 25000 }, (_, index) => ({
          ...entry,
          id: `rule:benchmark-${index}`,
          slug: `benchmark-${index}`,
          name: `Synthetic Entry ${String(index).padStart(5, "0")}`,
          fullText: undefined,
          summary: undefined,
          effects: [],
          tags: ["synthetic-benchmark"],
        })),
      };
    const json = JSON.stringify(document),
      started = performance.now(),
      preview = await previewContentPack(json, database);
    expect(preview.canImport).toBe(true);
    await confirmImport(preview, database);
    const importMs = performance.now() - started,
      stored = await database.contentEntries.toArray(),
      storedBytes = new TextEncoder().encode(JSON.stringify(stored)).byteLength,
      searchStarted = performance.now(),
      found = await database.contentEntries
        .where("name")
        .startsWithIgnoreCase("Synthetic Entry 2499")
        .toArray(),
      searchMs = performance.now() - searchStarted;
    expect(stored).toHaveLength(25000);
    expect(found.length).toBeGreaterThan(0);
    process.stdout.write(
      `\n[synthetic-25k] import=${importMs.toFixed(1)}ms storedPayload=${storedBytes}B search=${searchMs.toFixed(1)}ms matches=${found.length}\n`,
    );
  }, 60000);
});
