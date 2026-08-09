import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describePackRemoval,
  describeSourceRemoval,
  describeSourceSaveFailure,
  validateSourceForm,
} from "@/src/content/source-management";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import { ContentOperationError } from "@/src/storage/content-operation-error";
import { SourceRepository } from "@/src/storage/content-repositories";
import { LedgerDB } from "@/src/storage/db";
import { LARGE_SOURCE_ID, largeImportJson } from "@/tests/fixtures/large-import-fixture";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

/**
 * The pilot's Save-source failure, and the removal confusion beside it.
 *
 * "The operation could not be completed. Check IDs, versions, and required
 * fields." was the answer to every one of these. The point of these tests is
 * that each refusal now has its own reason, that the reason is the true one, and
 * that no legitimate refusal became a success on the way.
 */
let database: LedgerDB;
let sources: SourceRepository;
beforeEach(() => {
  database = new LedgerDB(`test-${crypto.randomUUID()}`);
  sources = new SourceRepository(database);
});
afterEach(async () => {
  database.close();
  await database.delete();
});

const source = (id: string) => ({
  id,
  name: "Synthetic Local Source",
  abbreviation: "SYN",
  edition: "homebrew" as const,
  type: "homebrew" as const,
  licenseType: "original" as const,
  visibility: "private" as const,
  priority: 100,
  enabledByDefault: true,
  campaignIds: [],
  version: "1.0.0",
  createdAt: "2026-08-09T09:00:00.000Z",
  updatedAt: "2026-08-09T09:00:00.000Z",
});

const form = (overrides: Partial<Parameters<typeof validateSourceForm>[0]> = {}) => ({
  id: "source:synthetic-local",
  name: "Synthetic local source",
  abbreviation: "SYN",
  version: "1.0.0",
  ...overrides,
});

describe("the repository says why it refused, not merely that it did", () => {
  it("reports a duplicate source ID as a duplicate, against the ID field", async () => {
    await sources.create(source("source:synthetic-local"));

    const failure = await sources.create(source("source:synthetic-local")).catch(error => error);

    expect(failure).toBeInstanceOf(ContentOperationError);
    expect(failure.code).toBe("SOURCE_ALREADY_EXISTS");
    expect(failure.recordId).toBe("source:synthetic-local");
    const problem = describeSourceSaveFailure(failure);
    expect(problem.reason).toBe("duplicate-id");
    expect(problem.field).toBe("id");
    expect(problem.message).toMatch(/already on this device/i);
    expect(problem.message).not.toMatch(/could not be completed/i);
  });

  it("reports an update to a source that is gone as exactly that", async () => {
    const failure = await sources.update("source:absent", { name: "x" }).catch(error => error);

    expect(failure.code).toBe("SOURCE_NOT_FOUND");
    expect(describeSourceSaveFailure(failure).reason).toBe("unknown-source");
  });

  it("carries the dependency count out of a blocked removal", async () => {
    const preview = await previewContentPackSet([largeImportJson({ entryCount: 5, reviewCount: 2 })], database);
    await confirmImportSet(preview, database);

    expect(await sources.dependentEntryCount(LARGE_SOURCE_ID)).toBe(5);
    const failure = await sources.delete(LARGE_SOURCE_ID).catch(error => error);

    expect(failure).toBeInstanceOf(ContentOperationError);
    expect(failure.code).toBe("SOURCE_REFERENCED");
    expect(failure.referencingEntryCount).toBe(5);
    expect(describeSourceSaveFailure(failure).message).toMatch(/5 installed entries/);
  });

  it("still refuses the deletion — the reason is louder, the rule is unchanged", async () => {
    const preview = await previewContentPackSet([JSON.stringify(syntheticPack())], database);
    await confirmImportSet(preview, database);

    await expect(sources.delete("source:synthetic-moon")).rejects.toThrow(/still referenced/);
    await expect(database.sources.get("source:synthetic-moon")).resolves.toBeDefined();
  });

  it("removes a source nothing depends on", async () => {
    await sources.create(source("source:unused-local"));
    await sources.delete("source:unused-local");
    await expect(database.sources.get("source:unused-local")).resolves.toBeUndefined();
  });

  it("falls back to a persistence message it can stand behind", () => {
    const problem = describeSourceSaveFailure(new Error("QuotaExceededError"));
    expect(problem.reason).toBe("persistence");
    expect(problem.message).toMatch(/nothing was changed/i);
    // Never the internal text.
    expect(problem.message).not.toMatch(/QuotaExceeded/);
  });
});

describe("the form is checked before the write, so the fixable is named first", () => {
  it("names a duplicate ID against the ID field", () => {
    const check = validateSourceForm(form(), { mode: "create", existingIds: ["source:synthetic-local"] });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problem.reason).toBe("duplicate-id");
    expect(check.problem.field).toBe("id");
  });

  it("names a malformed ID and says what one looks like", () => {
    const check = validateSourceForm(form({ id: "My Source" }), { mode: "create", existingIds: [] });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problem.reason).toBe("invalid-id");
    expect(check.problem.message).toMatch(/source:my-source/);
  });

  it("names a malformed version and quotes the value back", () => {
    const check = validateSourceForm(form({ version: "one" }), { mode: "create", existingIds: [] });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problem.reason).toBe("invalid-version");
    expect(check.problem.field).toBe("version");
    expect(check.problem.message).toMatch(/one/);
  });

  it("names a missing required field", () => {
    const check = validateSourceForm(form({ name: "  " }), { mode: "create", existingIds: [] });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problem.reason).toBe("missing-field");
    expect(check.problem.field).toBe("name");
  });

  it("accepts a well-formed new source, and an edit of one that is installed", () => {
    expect(validateSourceForm(form(), { mode: "create", existingIds: [] }).ok).toBe(true);
    expect(
      validateSourceForm(form(), { mode: "edit", existingIds: ["source:synthetic-local"] }).ok,
    ).toBe(true);
  });

  it("refuses an edit of a source that is no longer installed", () => {
    const check = validateSourceForm(form(), { mode: "edit", existingIds: [] });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.problem.reason).toBe("unknown-source");
  });
});

describe("removal is described before it is performed", () => {
  it("distinguishes cannot-remove from can-remove-with-consequences", () => {
    const blocked = describeSourceRemoval({
      sourceName: "Lantern Observatory Handbook",
      sourceId: LARGE_SOURCE_ID,
      referencingEntryCount: 600,
    });
    expect(blocked.kind).toBe("blocked");
    expect(blocked.title).toMatch(/cannot be removed/i);
    expect(blocked.explanation).toMatch(/600 installed entries/);
    // It says what to do, not only that it failed.
    expect(blocked.explanation).toMatch(/Remove the packs that own them first/);

    const removable = describeSourceRemoval({
      sourceName: "Unused Source",
      sourceId: "source:unused",
      referencingEntryCount: 0,
    });
    expect(removable.kind).toBe("removable");
    expect(removable.title).toMatch(/^Remove /);
    expect(removable.explanation).toMatch(/cannot be undone/i);
  });

  it("says what removing a pack takes with it", () => {
    const removal = describePackRemoval({ packName: "Lantern Observatory Drills", entryCount: 600 });
    expect(removal.title).toMatch(/^Remove Lantern Observatory Drills\?$/);
    expect(removal.explanation).toMatch(/600 entries/);
    expect(removal.explanation).toMatch(/ruleset/i);
  });
});
