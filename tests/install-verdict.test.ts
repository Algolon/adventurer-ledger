import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { acceptancePack, ACCEPTANCE_PACK_ID } from "@/tests/fixtures/acceptance-ruleset";
import { createHarness, closeHarnesses, type Harness } from "@/tests/fixtures/service-harness";

/**
 * An import preview says which of four things it would do.
 *
 * The issue list is the machine contract and is asserted elsewhere. What is
 * pinned here is the derived verdict, because "blocked" was previously doing the
 * work of a first install, an upgrade, a re-import of what was already there and
 * an attempt to install something older — and the middle two are not failures.
 * Collapsing them is what made an ordinary repeat import read as a broken app.
 *
 * Every fixture is original synthetic content; only declared version and
 * revision metadata is varied.
 */
let harness: Harness;

afterEach(async () => {
  await closeHarnesses();
});

/** The acceptance pack at a chosen version, with entry revisions to match. */
function packAt(version: string, revision: number): string {
  const document = acceptancePack();
  return JSON.stringify({
    ...document,
    pack: { ...document.pack, version },
    entries: document.entries.map(entry => ({ ...entry, revision })),
  });
}

/** Installs a pack and creates its ruleset, as the import screen does. */
async function install(json: string) {
  const preview = await harness.install.preview([json]);
  expect(preview.canImport).toBe(true);
  const outcome = await harness.install.confirm(preview, {
    createRulesetForPackIds: [ACCEPTANCE_PACK_ID],
  });
  expect(outcome.status).toBe("ok");
}

describe("install verdicts", () => {
  it("reports a first install as an install", async () => {
    harness = await createHarness();
    const preview = await harness.install.preview([packAt("1.0.0", 1)]);
    expect(preview.verdict).toBe("install");
    expect(preview.canImport).toBe(true);
    expect(preview.usableExistingRulesets).toEqual([]);
  });

  it("reports a newer version as an update", async () => {
    harness = await createHarness();
    await install(packAt("1.0.0", 1));
    const preview = await harness.install.preview([packAt("1.1.0", 2)]);
    expect(preview.verdict).toBe("update");
    expect(preview.canImport).toBe(true);
  });

  it("reports an identical re-import as already current, not as a failure", async () => {
    harness = await createHarness();
    await install(packAt("1.0.0", 1));
    const preview = await harness.install.preview([packAt("1.0.0", 1)]);

    expect(preview.verdict).toBe("already-current");
    // Nothing may be written; that part is unchanged.
    expect(preview.canImport).toBe(false);
    // And the refusal knows the content is still there and still usable.
    expect(preview.usableExistingRulesets.map(view => view.id)).toContain(
      `ruleset:${ACCEPTANCE_PACK_ID}`,
    );
  });

  it("names both versions when the incoming pack is older", async () => {
    harness = await createHarness();
    await install(packAt("2.0.0", 2));
    const preview = await harness.install.preview([packAt("1.0.0", 1)]);

    expect(preview.verdict).toBe("older-than-installed");
    expect(preview.canImport).toBe(false);
    const version = preview.issues.find(issue => issue.code === "PACK_VERSION_CONFLICT");
    expect(version?.installedVersion).toBe("2.0.0");
    expect(version?.incomingVersion).toBe("1.0.0");
    // The downgrade is refused, and what remains is reported as usable.
    expect(preview.usableExistingRulesets).toHaveLength(1);
  });

  it("distinguishes a revision conflict from an unchanged version", async () => {
    harness = await createHarness();
    // Installed entries are ahead; the pack version is not, so only the entry
    // revisions can refuse this.
    await install(packAt("1.0.0", 5));
    const preview = await harness.install.preview([packAt("1.1.0", 2)]);

    expect(preview.verdict).toBe("revision-conflict");
    expect(preview.canImport).toBe(false);
    const conflict = preview.issues.find(issue => issue.code === "ENTRY_REVISION_CONFLICT");
    expect(conflict?.installedRevision).toBe(5);
    expect(conflict?.incomingRevision).toBe(2);
    // The existing profile is untouched and still selectable.
    expect(preview.usableExistingRulesets).toHaveLength(1);
  });

  it("names a record by ID and revision only, never by its content", async () => {
    harness = await createHarness();
    await install(packAt("1.0.0", 5));
    const preview = await harness.install.preview([packAt("1.1.0", 2)]);

    /*
     * The refusal must be actionable without quoting the record. Entry names,
     * summaries and any full text stay out of the message; an ID and two
     * declared integers are enough to identify and repair it.
     */
    const names = acceptancePack().entries.map(entry => entry.name);
    for (const issue of preview.issues)
      for (const name of names) expect(issue.message).not.toContain(name);
  });
});
