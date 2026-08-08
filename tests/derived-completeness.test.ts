/**
 * Creation-incomplete and derived-value-unavailable are different facts.
 *
 * The Samsung pilot committed a Fighter 5 whose Review reported no outstanding
 * choices, and the committed sheet then said "This character is not finished"
 * and pointed at Edit character. The cause was a species-granted resource whose
 * maximum path no producer writes: only a class progression row writes
 * `resource.<id>`, so a resource granted by a species trait can never resolve
 * one. That unresolved value was folded into the same flag as an unmade
 * decision, and carried a recovery that named a class source the resource never
 * had.
 *
 * These tests fix the distinction, not the content: a resource the installed
 * content cannot size is reported, counted and named, but it does not make a
 * finished character unfinished and it never claims a source the resolver
 * cannot prove.
 */
import { describe, expect, it } from "vitest";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import { SYNTHETIC_ENTRIES, SYNTHETIC_IDS, SYNTHETIC_RULESET } from "@/src/content/runefolio-synthetic";
import { brammel, brammelRuntime } from "@/tests/fixtures/brammel";
import type { ContentEntry } from "@/src/domain/model";

const ANCESTRY_TRAIT = "trait:ancestral-surge";
const ANCESTRY_RESOURCE = "resource:ancestral-surge";

/** A species trait granting a resource whose maximum path nothing writes. */
const traitEntry = (): ContentEntry => ({
  ...SYNTHETIC_ENTRIES.find(item => item.id === "trait:river-footing")!,
  id: ANCESTRY_TRAIT,
  slug: "ancestral-surge",
  name: "Ancestral Surge",
  effects: [
    {
      id: "effect:ancestral-surge",
      type: "addResource",
      resource: {
        id: ANCESTRY_RESOURCE,
        name: "Ancestral Surge",
        maximum: { kind: "path", path: `resource.${ANCESTRY_RESOURCE}` },
        recharge: "long-rest",
      },
    },
  ],
});

const withSpeciesResource = (): ContentEntry[] => [
  ...SYNTHETIC_ENTRIES.map(item =>
    item.id === SYNTHETIC_IDS.species
      ? {
          ...item,
          mechanics: {
            ...(item.mechanics as Record<string, unknown>),
            traitIds: [...(item.mechanics as { traitIds: string[] }).traitIds, ANCESTRY_TRAIT],
          },
        }
      : item,
  ),
  traitEntry(),
];

const resolve = (entries: ContentEntry[]) =>
  resolveDerivedCharacter({
    character: brammel(1),
    runtime: brammelRuntime(),
    entries,
    ruleset: SYNTHETIC_RULESET,
  });

describe("a resource the installed content cannot size", () => {
  const sheet = resolve(withSpeciesResource());
  const resource = sheet.resources.find(item => item.id === ANCESTRY_RESOURCE);

  it("still leaves the value unknown rather than inventing one", () => {
    expect(resource?.maximum.value).toBeNull();
    expect(resource?.current.value).toBeNull();
  });

  it("does not call a character with no outstanding decisions unfinished", () => {
    expect(sheet.completeness).toBe("guided-complete");
    expect(sheet.renderable).toBe(true);
  });

  it("reports the condition as a countable, non-blocking issue", () => {
    const issue = sheet.issues.find(item => item.code === "DERIVED_VALUE_UNAVAILABLE");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    expect(sheet.issues.some(item => item.severity === "error")).toBe(false);
  });

  it("names the affected concept without exposing an ID", () => {
    expect(sheet.unavailableValues).toHaveLength(1);
    expect(sheet.unavailableValues[0]?.label).toBe("Ancestral Surge");
    expect(sheet.unavailableValues[0]?.label).not.toContain("resource:");
  });

  it("never blames a class source for a resource the class did not grant", () => {
    expect(resource?.maximum.recovery?.action).toBe("Check Ancestral Surge");
    expect(resource?.maximum.recovery?.action).not.toMatch(/class/i);
    expect(resource?.current.recovery?.action).not.toMatch(/class/i);
  });
});

describe("a resource the content does size", () => {
  const sheet = resolve([...SYNTHETIC_ENTRIES]);
  const resource = sheet.resources.find(item => item.id === SYNTHETIC_IDS.resource);

  it("resolves and reports nothing unavailable", () => {
    expect(resource?.maximum.value).toBe(3);
    expect(sheet.unavailableValues).toHaveLength(0);
    expect(sheet.issues.some(item => item.code === "DERIVED_VALUE_UNAVAILABLE")).toBe(false);
    expect(sheet.completeness).toBe("guided-complete");
  });

  it("attributes it to the entry that declares it, not to the class by assumption", () => {
    const contributor = resource?.maximum.contributors[0];
    expect(contributor?.label).toBe("Hold the Line");
    expect(contributor?.entryId).toBe("feature:vanguard-hold-the-line");
  });
});

describe("a genuinely unfinished build", () => {
  it("is still reported as incomplete", () => {
    const sheet = resolveDerivedCharacter({
      character: brammel(1, { abilityScores: {} as never }),
      runtime: brammelRuntime(),
      entries: [...SYNTHETIC_ENTRIES],
      ruleset: SYNTHETIC_RULESET,
    });
    expect(sheet.completeness).toBe("incomplete");
  });
});
