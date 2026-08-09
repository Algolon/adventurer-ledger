import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import {
  GROUP_RECORD_SAMPLE,
  summariseImportIssues,
  summariseImportOutcome,
} from "@/src/import/issue-presentation";
import { LedgerDB } from "@/src/storage/db";
import { largeImportJson, largeImportUpdateJson } from "@/tests/fixtures/large-import-fixture";

/**
 * The pilot's import, reproduced from public synthetic content, and the bound
 * that has to hold over it.
 *
 * The complaint was never that the warnings were wrong. It was that a successful
 * import produced a result surface proportional to the number of warnings —
 * hundreds of same-priority rows, all styled as errors — with no answer to "did
 * this work?" anywhere near the top. So these tests assert the two things that
 * fix that: the primary surface is bounded by the number of *kinds* of issue,
 * and a non-blocking notice is a different kind of thing from a blocking one at
 * the level of the data, not merely of the stylesheet.
 */
let database: LedgerDB;
beforeEach(() => {
  database = new LedgerDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  database.close();
  await database.delete();
});

/*
 * A 600-entry document is parsed, validated and — in the update case — written
 * twice here. That is the point of the fixture, and it is slower than the
 * default per-test budget under a loaded suite, so the budget is stated rather
 * than left to produce an intermittent failure that says nothing.
 */
describe("the large synthetic import reproduces the pilot's shape", { timeout: 60_000 }, () => {
  it("imports cleanly while raising hundreds of review notices", async () => {
    const preview = await previewContentPackSet([largeImportJson()], database);

    expect(preview.canImport).toBe(true);
    const review = preview.issues.filter(issue => issue.code === "EFFECT_REVIEW_REQUIRED");
    expect(review.length).toBe(480);
    expect(review.every(issue => issue.severity === "warning")).toBe(true);
    expect(preview.issues.filter(issue => issue.severity === "error")).toEqual([]);
    expect(preview.plan.entries.add.length).toBe(600);
  });

  it("collapses those notices into a surface bounded by issue kind, not issue count", async () => {
    const preview = await previewContentPackSet([largeImportJson()], database);
    const summary = summariseImportIssues(preview.issues);

    // The whole contract: hundreds of issues, a handful of rows.
    expect(preview.issues.length).toBeGreaterThan(480);
    expect(summary.groups.length).toBeLessThanOrEqual(4);
    expect(summary.blocking).toEqual([]);
    expect(summary.warningCount).toBe(preview.issues.length);

    const effects = summary.advisory.find(group => group.code === "EFFECT_REVIEW_REQUIRED");
    expect(effects?.count).toBe(480);
    // Detail survives the collapse, and is itself bounded.
    expect(effects?.recordIds.length).toBe(480);
    expect(effects?.listedRecordIds.length).toBe(GROUP_RECORD_SAMPLE);
    expect(effects?.hiddenRecordCount).toBe(480 - GROUP_RECORD_SAMPLE);
  });

  it("keeps the number of groups flat as the number of warnings grows", async () => {
    const small = summariseImportIssues(
      (await previewContentPackSet([largeImportJson({ entryCount: 40, reviewCount: 20 })], database)).issues,
    );
    const large = summariseImportIssues((await previewContentPackSet([largeImportJson()], database)).issues);

    expect(large.warningCount).toBeGreaterThan(small.warningCount * 10);
    expect(large.groups.length).toBe(small.groups.length);
  });

  it("reports a completed import with warnings as completed, not as a failure", async () => {
    const preview = await previewContentPackSet([largeImportJson()], database);
    const outcome = summariseImportOutcome({ plan: preview.plan, issues: preview.issues, applied: true });

    expect(outcome.tone).toBe("review");
    expect(outcome.headline).toMatch(/completed/i);
    expect(outcome.headline).not.toMatch(/fail/i);
    expect(outcome.counts.added).toBe(600);
    expect(outcome.counts.processed).toBe(600);
    expect(outcome.issues.errorCount).toBe(0);
    // What a screen reader is handed has to carry the same answer as the screen.
    expect(outcome.announcement).toMatch(/No errors/);
    expect(outcome.announcement).toMatch(/items to review/);
  });

  it("separates a genuine blocking error from the advisory noise around it", async () => {
    const preview = await previewContentPackSet([largeImportJson({ withBlockingError: true })], database);
    const outcome = summariseImportOutcome({ plan: preview.plan, issues: preview.issues, applied: false });

    expect(preview.canImport).toBe(false);
    expect(outcome.tone).toBe("failure");
    expect(outcome.issues.blocking.map(group => group.code)).toContain("MISSING_REFERENCE");
    expect(outcome.issues.blocking.every(group => group.severity === "error")).toBe(true);
    expect(outcome.issues.advisory.map(group => group.code)).toContain("EFFECT_REVIEW_REQUIRED");
    expect(outcome.issues.advisory.every(group => group.severity === "warning")).toBe(true);
    // Blocking groups are met first, whatever their count.
    expect(outcome.issues.groups[0].severity).toBe("error");
  });

  it("describes a second import as the additive update it is", async () => {
    const first = await previewContentPackSet([largeImportJson()], database);
    await confirmImportSet(first, database);

    const second = await previewContentPackSet([largeImportUpdateJson()], database);
    const outcome = summariseImportOutcome({ plan: second.plan, issues: second.issues, applied: true });

    expect(second.canImport).toBe(true);
    expect(outcome.counts.updated).toBe(1);
    expect(outcome.counts.added).toBe(0);
    expect(outcome.counts.unchanged).toBe(599);
    expect(outcome.counts.processed).toBe(600);
  });
});

describe("issue grouping", () => {
  it("orders groups blocking first, then by how many records they touch", () => {
    const summary = summariseImportIssues([
      { code: "EFFECT_REVIEW_REQUIRED", severity: "warning", message: "a", recordId: "entry:1" },
      { code: "EFFECT_REVIEW_REQUIRED", severity: "warning", message: "b", recordId: "entry:2" },
      { code: "ALIAS_CONFLICT", severity: "warning", message: "c", recordId: "entry:3" },
      { code: "MISSING_SOURCE", severity: "error", message: "d", recordId: "entry:4" },
    ]);

    expect(summary.groups.map(group => group.code)).toEqual([
      "MISSING_SOURCE",
      "EFFECT_REVIEW_REQUIRED",
      "ALIAS_CONFLICT",
    ]);
    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(3);
  });

  it("counts every issue but lists each affected record once", () => {
    const summary = summariseImportIssues([
      { code: "EFFECT_REVIEW_REQUIRED", severity: "warning", message: "a", recordId: "entry:1" },
      { code: "EFFECT_REVIEW_REQUIRED", severity: "warning", message: "b", recordId: "entry:1" },
    ]);

    expect(summary.groups[0].count).toBe(2);
    expect(summary.groups[0].recordIds).toEqual(["entry:1"]);
  });

  it("gives every code a user-facing label rather than leaving the code to speak", () => {
    const summary = summariseImportIssues([
      { code: "EFFECT_REVIEW_REQUIRED", severity: "warning", message: "a", recordId: "entry:1" },
    ]);

    expect(summary.groups[0].label).not.toMatch(/_/);
    expect(summary.groups[0].explanation).toMatch(/import/i);
  });
});

describe("outcome copy", () => {
  const onePlan = {
    sources: { add: [], update: [] },
    packs: { add: [], update: [] },
    entries: { add: ["entry:1"], update: [], unchanged: [] },
  };

  it("says nothing needs attention when there is nothing to review", () => {
    const outcome = summariseImportOutcome({ plan: onePlan, issues: [], applied: true });
    expect(outcome.tone).toBe("success");
    expect(outcome.detail).toMatch(/nothing needs your attention/i);
  });

  it("says nothing was written when the set was refused", () => {
    const outcome = summariseImportOutcome({
      plan: onePlan,
      issues: [{ code: "MISSING_SOURCE", severity: "error", message: "x", recordId: "entry:1" }],
      applied: false,
    });
    expect(outcome.tone).toBe("failure");
    expect(outcome.detail).toMatch(/nothing was written/i);
    expect(outcome.detail).toMatch(/unchanged/i);
  });
});
