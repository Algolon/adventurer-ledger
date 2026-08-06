import { describe, expect, it } from "vitest";
import type { ContentEntry } from "@/src/domain/model";
import { classifyEntry, isSemanticallyIdentical } from "@/src/import/entry-disposition";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

const base = (overrides: Record<string, unknown> = {}): ContentEntry =>
  ({ ...syntheticPack().entries[0], ...overrides }) as unknown as ContentEntry;

describe("entry disposition", () => {
  it("treats install-managed audit fields as not part of the pack payload", () => {
    const installed = base({ createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z" });
    const incoming = base({ createdAt: "2026-05-05T00:00:00.000Z", updatedAt: "2026-06-06T00:00:00.000Z" });
    expect(isSemanticallyIdentical(incoming, installed)).toBe(true);
    expect(classifyEntry(incoming, installed)).toBe("unchanged");
  });

  it("is insensitive to key order but sensitive to array order", () => {
    const installed = base({ tags: ["alpha", "beta"] });
    const reordered = JSON.parse(JSON.stringify({ ...installed })) as ContentEntry;
    expect(isSemanticallyIdentical(reordered, installed)).toBe(true);
    // Array order is content: a reordered list is a change, not a no-op.
    expect(isSemanticallyIdentical(base({ tags: ["beta", "alpha"] }), installed)).toBe(false);
  });

  it.each([
    ["mechanics", { mechanics: { kind: "navigation-rule", data: { altered: true } } }],
    ["summary", { summary: "Different summary." }],
    ["visibility", { visibility: "private-summary" }],
    ["aliases", { aliases: ["another-name"] }],
    ["links", { links: [{ type: "feature", targetId: "rule:other", required: true }] }],
    ["conflict metadata", { conflict: { sourcePriority: 99, conflictKey: "rule:synthetic-moon-path", resolution: "source-priority" } }],
    ["sourceId", { sourceId: "source:different" }],
    ["nested effect", { effects: [{ id: "effect:synthetic-marker", type: "addAdvantage", target: "changed" }] }],
    ["nested choice option", { choices: [{ id: "choice:x", label: "X", min: 1, max: 1, repeatable: false, options: [{ id: "option:x", label: "X" }] }] }],
  ])("detects a change in %s at an equal revision", (_label, overrides) => {
    const installed = base();
    const incoming = base(overrides);
    expect(isSemanticallyIdentical(incoming, installed)).toBe(false);
    expect(classifyEntry(incoming, installed)).toBe("revision-reuse");
  });

  it("classifies add, update and downgrade by revision", () => {
    const installed = base({ revision: 2 });
    expect(classifyEntry(base(), undefined)).toBe("add");
    expect(classifyEntry(base({ revision: 3, summary: "changed" }), installed)).toBe("update");
    expect(classifyEntry(base({ revision: 1 }), installed)).toBe("downgrade");
  });

  it("prefers update over content comparison when the revision rises", () => {
    // A higher revision is an update even if the payload happens to match:
    // the pack is the authority on its own revisions.
    const installed = base({ revision: 1 });
    expect(classifyEntry(base({ revision: 2 }), installed)).toBe("update");
  });
});
