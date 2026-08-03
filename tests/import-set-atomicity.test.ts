import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ImportConfirmationError,
  confirmImport,
  confirmImportSet,
  previewContentPack,
  previewContentPackSet,
} from "@/src/import/content-pipeline";
import { LedgerDB } from "@/src/storage/db";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

/**
 * Confirmation-time revalidation of the complete import set. Every case changes the
 * installed database between preview and confirmation and asserts a typed outcome
 * plus a completely empty write.
 */
interface SyntheticDocument {
  schemaVersion: number;
  pack: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown>>;
}

let database: LedgerDB;
const open = (label: string) => (database = new LedgerDB(`${label}-${crypto.randomUUID()}`));
afterEach(async () => {
  vi.restoreAllMocks();
  if (database) {
    database.close();
    await database.delete();
  }
});

/** One synthetic pack whose pack, source and entry IDs all derive from `key`. */
function packDocument(key: string, mutate: (document: SyntheticDocument) => void = () => {}): SyntheticDocument {
  const document = JSON.parse(JSON.stringify(syntheticPack())) as SyntheticDocument;
  document.pack.id = `pack:${key}`;
  document.pack.name = `Synthetic ${key}`;
  document.sources[0].id = `source:${key}`;
  document.sources[0].name = `Synthetic source ${key}`;
  const entry = document.entries[0];
  entry.id = `rule:${key}`;
  entry.slug = `rule-${key}`;
  entry.name = `Synthetic rule ${key}`;
  entry.sourceId = `source:${key}`;
  entry.sourceLocator = { sourceId: `source:${key}`, page: "7", section: "Moon paths" };
  entry.conflict = { sourcePriority: 10, resolution: "source-priority" };
  mutate(document);
  return document;
}

const extraEntry = (
  document: SyntheticDocument,
  id: string,
  category: string,
  mechanics: Record<string, unknown>,
): Record<string, unknown> => ({
  ...document.entries[0],
  id,
  slug: id.replaceAll(":", "-"),
  name: `Synthetic ${id}`,
  category,
  mechanics,
  effects: [],
  choices: [],
  equipmentBundles: [],
  links: [],
  conflict: { sourcePriority: 10, resolution: "source-priority" },
});

const json = (document: SyntheticDocument) => JSON.stringify(document);

async function install(...documents: SyntheticDocument[]) {
  const preview = await previewContentPackSet(documents.map(json), database);
  expect(preview.issues.filter(issue => issue.severity === "error")).toEqual([]);
  await confirmImportSet(preview, database);
}

async function confirmationFailure(run: Promise<void>): Promise<ImportConfirmationError> {
  const outcome = await run.then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(outcome instanceof ImportConfirmationError))
    throw new Error(`Expected a typed confirmation failure, received ${String(outcome)}`);
  return outcome;
}

async function expectNothingWritten() {
  expect(await database.sources.count()).toBe(0);
  expect(await database.contentPacks.count()).toBe(0);
  expect(await database.contentEntries.count()).toBe(0);
  expect(await database.contentPackVersions.count()).toBe(0);
  expect(await database.contentEntryVersions.count()).toBe(0);
}

/** A class whose progression, saves and subclass list all point at the provider pack. */
function consumerClassDocument(): SyntheticDocument {
  return packDocument("consumer", document => {
    document.pack.dependencies = ["pack:provider"];
    document.entries = [
      extraEntry(document, "class:consumer", "class", {
        hitDie: 8,
        primaryAbilities: ["strength"],
        savingThrows: ["proficiency:save-one", "proficiency:save-two"],
        progression: [{ level: 1, proficiencyBonus: 2, featureIds: ["feature:anchor"], choiceIds: [], resourceChanges: {} }],
        subclassLevel: 3,
        subclassIds: [],
      }),
    ];
  });
}

function providerDocument(): SyntheticDocument {
  return packDocument("provider", document => {
    document.entries = [
      document.entries[0],
      extraEntry(document, "proficiency:save-one", "proficiency", { type: "save", key: "strength" }),
      extraEntry(document, "proficiency:save-two", "proficiency", { type: "save", key: "constitution" }),
      extraEntry(document, "feature:anchor", "class-feature", { classId: "class:consumer", level: 1, featureType: "core" }),
    ];
  });
}

describe("import-set confirmation revalidates the complete set", () => {
  it("rejects the set when a required dependency pack is removed after preview", async () => {
    open("dependency-removed");
    await install(providerDocument());
    const consumer = packDocument("consumer", document => {
      document.pack.dependencies = ["pack:provider"];
    });
    const preview = await previewContentPackSet([json(consumer)], database);
    expect(preview.canImport).toBe(true);
    await database.contentPacks.delete("pack:provider");

    const failure = await confirmationFailure(confirmImportSet(preview, database));
    expect(failure.code).toBe("SET_REVALIDATION_FAILED");
    expect(failure.issues.map(issue => issue.code)).toContain("MISSING_DEPENDENCY");
    expect(await database.contentPacks.get("pack:consumer")).toBeUndefined();
    expect(await database.contentEntries.get("rule:consumer")).toBeUndefined();
    expect(await database.sources.get("source:consumer")).toBeUndefined();
  });

  it("rejects the set when a required linked entry is removed after preview", async () => {
    open("link-removed");
    await install(providerDocument());
    const consumer = packDocument("consumer", document => {
      document.entries[0].links = [{ type: "feature", targetId: "rule:provider", required: true }];
    });
    const preview = await previewContentPackSet([json(consumer)], database);
    expect(preview.canImport).toBe(true);
    await database.contentEntries.delete("rule:provider");

    const failure = await confirmationFailure(confirmImportSet(preview, database));
    expect(failure.code).toBe("SET_REVALIDATION_FAILED");
    expect(failure.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_REFERENCE", recordId: "rule:consumer", targetId: "rule:provider" }),
    );
    expect(await database.contentPacks.get("pack:consumer")).toBeUndefined();
    expect(await database.contentEntries.get("rule:consumer")).toBeUndefined();
  });

  it("rejects the set when a class progression target is removed after preview", async () => {
    open("progression-removed");
    await install(providerDocument());
    const preview = await previewContentPackSet([json(consumerClassDocument())], database);
    expect(preview.canImport).toBe(true);
    await database.contentEntries.delete("feature:anchor");

    const failure = await confirmationFailure(confirmImportSet(preview, database));
    expect(failure.code).toBe("SET_REVALIDATION_FAILED");
    expect(failure.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_REFERENCE", recordId: "class:consumer", targetId: "feature:anchor" }),
    );
    expect(await database.contentEntries.get("class:consumer")).toBeUndefined();
  });

  it("rejects the set when a choice target is removed after preview", async () => {
    open("choice-target-removed");
    await install(providerDocument());
    const consumer = packDocument("consumer", document => {
      document.entries[0].choices = [
        {
          id: "choice:anchor",
          label: "Synthetic anchor choice",
          min: 1,
          max: 1,
          repeatable: false,
          options: [{ id: "option:anchor", label: "Synthetic anchor option", entryId: "rule:provider" }],
        },
      ];
    });
    const preview = await previewContentPackSet([json(consumer)], database);
    expect(preview.canImport).toBe(true);
    await database.contentEntries.delete("rule:provider");

    const failure = await confirmationFailure(confirmImportSet(preview, database));
    expect(failure.code).toBe("SET_REVALIDATION_FAILED");
    expect(failure.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_REFERENCE", recordId: "rule:consumer", targetId: "rule:provider" }),
    );
    expect(await database.contentEntries.get("rule:consumer")).toBeUndefined();
  });

  it("rejects the set when an installed conflict participant changes its policy after preview", async () => {
    open("conflict-policy-changed");
    await install(
      packDocument("provider", document => {
        document.entries[0].conflict = { sourcePriority: 10, conflictKey: "rule:collision", resolution: "source-priority" };
      }),
    );
    const consumer = packDocument("consumer", document => {
      document.entries[0].conflict = { sourcePriority: 20, conflictKey: "rule:collision", resolution: "source-priority" };
    });
    const preview = await previewContentPackSet([json(consumer)], database);
    expect(preview.canImport).toBe(true);
    const installed = await database.contentEntries.get("rule:provider");
    if (!installed) throw new Error("Synthetic provider entry is missing");
    // Same revision and timestamp: only the conflict policy moves, so nothing this
    // preview observed is stale and only set revalidation can catch it.
    await database.contentEntries.put({ ...installed, conflict: { ...installed.conflict, resolution: "newest-revision" } });

    const failure = await confirmationFailure(confirmImportSet(preview, database));
    expect(failure.code).toBe("SET_REVALIDATION_FAILED");
    expect(failure.issues).toContainEqual(
      expect.objectContaining({ code: "CONFLICT_POLICY_MISMATCH", recordId: "rule:collision" }),
    );
    expect(await database.contentEntries.get("rule:consumer")).toBeUndefined();
  });

  it("rolls back packs, sources, entries and history when a later file fails to write", async () => {
    open("later-file-failure");
    const first = packDocument("first");
    await install(first);
    const upgraded = packDocument("first", document => {
      document.pack.version = "1.1.0";
      document.entries[0].revision = 2;
      document.entries[0].version = "1.1.0";
    });
    const second = packDocument("second", document => {
      document.pack.dependencies = ["pack:first"];
    });
    const preview = await previewContentPackSet([json(upgraded), json(second)], database);
    expect(preview.canImport).toBe(true);
    database.contentEntries.hook("creating", (_key, record) => {
      if (record.id === "rule:second") throw new Error("Synthetic storage failure");
    });

    await expect(confirmImportSet(preview, database)).rejects.toThrow("Synthetic storage failure");
    expect(await database.contentPacks.get("pack:first")).toMatchObject({ version: "1.0.0" });
    expect(await database.contentEntries.get("rule:first")).toMatchObject({ revision: 1 });
    expect(await database.contentPacks.get("pack:second")).toBeUndefined();
    expect(await database.sources.get("source:second")).toBeUndefined();
    expect(await database.contentPackVersions.count()).toBe(0);
    expect(await database.contentEntryVersions.count()).toBe(0);
  });

  it("rolls back the complete set when confirmation is cancelled between files", async () => {
    open("abort-between-files");
    const controller = new AbortController();
    const preview = await previewContentPackSet(
      [json(packDocument("first")), json(packDocument("second", document => {
        document.pack.dependencies = ["pack:first"];
      }))],
      database,
    );
    expect(preview.canImport).toBe(true);
    database.contentPacks.hook("creating", () => {
      controller.abort();
    });

    await expect(confirmImportSet(preview, database, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expectNothingWritten();
  });

  it("commits a multi-file dependency set atomically inside one flat transaction", async () => {
    open("atomic-success");
    const provider = providerDocument();
    const consumer = consumerClassDocument();
    const preview = await previewContentPackSet([json(consumer), json(provider)], database);
    expect(preview.canImport).toBe(true);
    const transaction = vi.spyOn(database, "transaction");

    await confirmImportSet(preview, database);

    // No nested transaction: confirmation opens exactly one Dexie scope for the set.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await database.contentPacks.count()).toBe(2);
    expect(await database.sources.count()).toBe(2);
    expect(await database.contentEntries.count()).toBe(5);
    expect(await database.contentPacks.get("pack:consumer")).toMatchObject({ entryIds: ["class:consumer"] });
    expect(await database.contentEntries.get("feature:anchor")).toBeDefined();
  });
});

describe("single-file confirmation cannot bypass the set boundary", () => {
  it("revalidates a single file as a one-file set and writes nothing when a reference is unresolved", async () => {
    open("single-file-boundary");
    const secret = "PRIVATE-SYNTHETIC-NEVER-ECHO";
    const consumer = packDocument("consumer", document => {
      document.entries[0].fullText = secret;
      document.entries[0].links = [{ type: "feature", targetId: "rule:absent", required: true }];
    });
    const preview = await previewContentPack(json(consumer), database);
    // The per-document preview carries no cross-file reference guarantee.
    expect(preview.canImport).toBe(true);

    const failure = await confirmationFailure(confirmImport(preview, database));
    expect(failure.code).toBe("SET_REVALIDATION_FAILED");
    expect(failure.issues).toContainEqual(
      expect.objectContaining({ code: "MISSING_REFERENCE", recordId: "rule:consumer", targetId: "rule:absent" }),
    );
    expect(JSON.stringify(failure.issues)).not.toContain(secret);
    expect(failure.message).not.toContain(secret);
    await expectNothingWritten();
  });

  it("confirms a single file through the same one-transaction commit path", async () => {
    open("single-file-success");
    const preview = await previewContentPack(json(packDocument("solo")), database);
    const transaction = vi.spyOn(database, "transaction");

    await confirmImport(preview, database);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await database.contentEntries.get("rule:solo")).toBeDefined();
  });

  it("reports a stale preview as a typed outcome before writing", async () => {
    open("single-file-stale");
    const preview = await previewContentPack(json(packDocument("stale")), database);
    await database.sources.add({
      id: "source:stale",
      name: "Synthetic source stale",
      abbreviation: "SSS",
      edition: "homebrew",
      type: "homebrew",
      licenseType: "original",
      visibility: "private",
      priority: 10,
      enabledByDefault: true,
      campaignIds: [],
      version: "1.0.0",
      createdAt: "2026-08-03T09:00:00.000Z",
      updatedAt: "2026-08-03T09:00:00.000Z",
    });

    const failure = await confirmationFailure(confirmImport(preview, database));
    expect(failure.code).toBe("PREVIEW_STALE");
    expect(await database.contentPacks.count()).toBe(0);
    expect(await database.contentEntries.count()).toBe(0);
  });
});
