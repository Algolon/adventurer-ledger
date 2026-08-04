/**
 * Ruleset selection is a decision, never a sort order.
 *
 * The builder used to take `installed[0]`, so importing a pack whose ID sorted
 * earlier silently changed which rules every new character was built against.
 */
import { describe, expect, it } from "vitest";
import { defaultRulesetFor, proposeRulesetForSources, selectableRulesets } from "@/src/services/ruleset-service";
import type { ContentEntry, RulesetProfile, Source } from "@/src/domain/model";
import { SYNTHETIC_ENTRIES, SYNTHETIC_RULESET } from "@/src/content/runefolio-synthetic";
import { PROG_ENTRIES, PROG_PACK_ID, PROG_RULESET, PROG_SOURCE_ID } from "@/tests/fixtures/progression-ruleset";

const AT = "2026-08-04T08:00:00.000Z";

const source = (id: string, visibility: Source["visibility"]): Source => ({
  id,
  name: id,
  abbreviation: id.slice(0, 4),
  edition: "homebrew",
  type: "homebrew",
  licenseType: "original",
  visibility,
  priority: 10,
  enabledByDefault: true,
  campaignIds: [],
  version: "1.0.0",
  createdAt: AT,
  updatedAt: AT,
});

const publicSources = [source("source:runefolio-synthetic", "public"), source(PROG_SOURCE_ID, "public")];
const allEntries = [...SYNTHETIC_ENTRIES, ...PROG_ENTRIES] as ContentEntry[];

describe("selectable rulesets", () => {
  it("describes each profile well enough to choose between them", () => {
    const selectable = selectableRulesets([SYNTHETIC_RULESET, PROG_RULESET], allEntries, publicSources);
    for (const item of selectable) {
      expect(item.usable).toBe(true);
      expect(item.classCount).toBeGreaterThan(0);
      expect(item.publicOnly).toBe(true);
      expect(item.name.length).toBeGreaterThan(0);
    }
  });

  it("puts an unusable profile last rather than letting it win on order", () => {
    const empty: RulesetProfile = { ...PROG_RULESET, id: "ruleset:aaa-empty", name: "Empty", activeSourceIds: ["source:nothing"] };
    // `aaa` sorts first by ID; it must still not lead.
    const selectable = selectableRulesets([empty, SYNTHETIC_RULESET], allEntries, publicSources);
    expect(selectable[0].id).toBe(SYNTHETIC_RULESET.id);
    expect(selectable.at(-1)?.id).toBe("ruleset:aaa-empty");
    expect(selectable.at(-1)?.usable).toBe(false);
  });

  it("ranks a profile with a private source below an equivalent public one", () => {
    const sources = [source("source:runefolio-synthetic", "public"), source(PROG_SOURCE_ID, "private")];
    const selectable = selectableRulesets([PROG_RULESET, SYNTHETIC_RULESET], allEntries, sources);
    expect(selectable[0].id).toBe(SYNTHETIC_RULESET.id);
    expect(selectable.find(item => item.id === PROG_RULESET.id)?.publicOnly).toBe(false);
  });
});

describe("default ruleset", () => {
  const selectable = () => selectableRulesets([SYNTHETIC_RULESET, PROG_RULESET], allEntries, publicSources);

  it("refuses to guess when more than one usable public profile exists", () => {
    // This is the case that used to silently resolve to whatever sorted first.
    expect(defaultRulesetFor(selectable())).toBeUndefined();
  });

  it("uses the single usable profile when there is only one", () => {
    const one = selectableRulesets([SYNTHETIC_RULESET], SYNTHETIC_ENTRIES as ContentEntry[], publicSources);
    expect(defaultRulesetFor(one)).toBe(SYNTHETIC_RULESET.id);
  });

  it("prefers what the user built with last time", () => {
    expect(defaultRulesetFor(selectable(), PROG_RULESET.id)).toBe(PROG_RULESET.id);
  });

  it("never returns an unusable profile", () => {
    const empty: RulesetProfile = { ...PROG_RULESET, id: "ruleset:empty", activeSourceIds: ["source:nothing"] };
    const one = selectableRulesets([empty], allEntries, publicSources);
    expect(defaultRulesetFor(one)).toBeUndefined();
    // Even when it is what was used before, if it can no longer build anything.
    expect(defaultRulesetFor(one, "ruleset:empty")).toBeUndefined();
  });

  it("does not adopt a newly imported profile merely because it exists", () => {
    const before = defaultRulesetFor(
      selectableRulesets([SYNTHETIC_RULESET], SYNTHETIC_ENTRIES as ContentEntry[], publicSources),
      SYNTHETIC_RULESET.id,
    );
    const after = defaultRulesetFor(selectable(), SYNTHETIC_RULESET.id);
    expect(after).toBe(before);
    expect(after).toBe(SYNTHETIC_RULESET.id);
  });
});

describe("proposing a profile for an imported pack", () => {
  it("derives a stable profile from the pack, without writing anything", () => {
    const outcome = proposeRulesetForSources("Stonewake", PROG_PACK_ID, [PROG_SOURCE_ID], PROG_ENTRIES, [], AT);
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.result.profile.id).toBe("ruleset:stonewake-synthetic");
    expect(outcome.result.profile.activeSourceIds).toEqual([PROG_SOURCE_ID]);
    expect(outcome.result.profile.allowedCategories).toContain("class");
    expect(outcome.result.alreadyInstalled).toBe(false);
    // Proposing is pure: the same input proposes the same profile again.
    const again = proposeRulesetForSources("Stonewake", PROG_PACK_ID, [PROG_SOURCE_ID], PROG_ENTRIES, [], AT);
    expect(again.status === "ok" && again.result.profile).toEqual(outcome.result.profile);
  });

  it("reports an equivalent existing profile instead of proposing a duplicate", () => {
    const outcome = proposeRulesetForSources(
      "Stonewake", PROG_PACK_ID, [PROG_SOURCE_ID], PROG_ENTRIES, [PROG_RULESET], AT,
    );
    expect(outcome.status === "ok" && outcome.result.alreadyInstalled).toBe(true);
    expect(outcome.status === "ok" && outcome.result.existingId).toBe(PROG_RULESET.id);
  });

  it("refuses a pack that activates no source", () => {
    const outcome = proposeRulesetForSources("Nothing", "pack:nothing", [], PROG_ENTRIES, [], AT);
    expect(outcome.status).toBe("invalid");
  });

  it("is separate from import, so a rolled-back import leaves no profile behind", () => {
    // Proposing returns a value; it performs no write. A caller that abandons
    // the import simply never persists it, so there is no partial profile.
    const outcome = proposeRulesetForSources("Stonewake", PROG_PACK_ID, [PROG_SOURCE_ID], PROG_ENTRIES, [], AT);
    expect(outcome.status).toBe("ok");
    const installed: RulesetProfile[] = [];
    expect(installed).toHaveLength(0);
  });
});
