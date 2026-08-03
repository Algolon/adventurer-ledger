import { describe, expect, it } from "vitest";
import type { Character, ContentEntry } from "@/src/domain/model";
import { resolveChoices } from "@/src/rules/choice-resolution";
import { deriveCharacterState } from "@/src/rules/derive-character";
import { applyEffects } from "@/src/rules/engine";
import { ruleContext } from "@/tests/rules-engine.test";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

/**
 * Characterization reproductions for M1.5 candidate gaps.
 *
 * Each test pins the CURRENT behaviour of the merged M1.4 boundary using original
 * synthetic content only. They are deliberately green: they document a gap so it
 * cannot regress silently, and each one states the behaviour a future approved fix
 * should establish. No private or official content is referenced.
 */
const stamp = "2026-08-03T08:00:00.000Z";
const template = (): ContentEntry => syntheticPack().entries[0];
const entry = (id: string, category: ContentEntry["category"], mechanics: Record<string, unknown>, overrides: Partial<ContentEntry> = {}): ContentEntry => ({
  ...template(), id, slug: id.replaceAll(":", "-"), name: `Synthetic ${id}`, category, mechanics,
  effects: [], choices: [], equipmentBundles: [], links: [], ...overrides,
});
const character = (overrides: Partial<Character> = {}): Character => ({
  id: "character:gap", name: "Gap probe", level: 1, advancement: "milestone",
  classLevels: [{ classId: "class:probe", level: 1 }],
  rulesetProfileId: "ruleset:gap",
  abilities: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
  baseHitPoints: 1, currentHitPoints: 1, temporaryHitPoints: 0, exhaustion: 0,
  deathSaves: { successes: 0, failures: 0 }, selections: [], biography: {}, tags: [],
  status: "active", kind: "player-character", createdAt: stamp, updatedAt: stamp, ...overrides,
});
const probeClass = (featureIds: string[]) => entry("class:probe", "class", {
  hitDie: 10, primaryAbilities: ["strength"], savingThrows: ["proficiency:a", "proficiency:b"],
  startingProficiencyIds: [], subclassLevel: 3, subclassIds: [],
  progression: [{ level: 1, proficiencyBonus: 2, featureIds, choiceIds: [], resourceChanges: {} }],
});

describe("GAP-1 option grants do not activate the entry they name", () => {
  it("records the option ID but never executes the referenced entry's effects", () => {
    const entries = [
      probeClass(["feature:grants-style"]),
      entry("feature:grants-style", "class-feature", { classId: "class:probe", level: 1, featureType: "core" }, {
        effects: [{ id: "effect:grant-style", type: "grantFightingStyle", optionId: "fighting-style:probe" }],
      }),
      entry("fighting-style:probe", "fighting-style", { kind: "style", data: {} }, {
        effects: [{ id: "effect:style-armour", type: "modifyArmorClass", operation: "add", value: { kind: "literal", value: 1 } }],
      }),
    ];
    const result = deriveCharacterState({ character: character(), entries });

    expect(result.ruleResult.optionGrants.fightingStyles).toEqual(new Set(["fighting-style:probe"]));
    expect(result.ruleResult.trace).toContainEqual(expect.objectContaining({ effectId: "effect:grant-style", applied: true }));
    // Current behaviour: the named entry is inert. Its effect never runs and it is
    // not an active entry, yet nothing reports a problem.
    expect(result.activeEntryIds.has("fighting-style:probe")).toBe(false);
    expect(result.ruleResult.context.values.armorClass).toBeUndefined();
    expect(result.status).toBe("ready");
    // A future fix should either activate the referenced entry or report an issue
    // when an option grant names an entry that exists but is never resolved.
  });

  it("applies the same effect when the option is reached through a choice target instead", () => {
    const entries = [
      probeClass(["feature:offers-style"]),
      entry("feature:offers-style", "class-feature", { classId: "class:probe", level: 1, featureType: "core" }, {
        choices: [{
          id: "choice:style", label: "Synthetic style", min: 1, max: 1, repeatable: false,
          options: [{ id: "option:probe", label: "Synthetic option", entryId: "fighting-style:probe" }],
        }],
      }),
      entry("fighting-style:probe", "fighting-style", { kind: "style", data: {} }, {
        effects: [{ id: "effect:style-armour", type: "modifyArmorClass", operation: "add", value: { kind: "literal", value: 1 } }],
      }),
    ];
    const result = deriveCharacterState({ character: character(), entries, choiceSelections: { "choice:style": ["option:probe"] } });

    expect(result.activeEntryIds.has("fighting-style:probe")).toBe(true);
    expect(result.ruleResult.context.values.armorClass).toBe(1);
  });
});

describe("GAP-2 a resource cannot declare two rest cadences", () => {
  it("keeps only the last recharge effect for one resource", () => {
    const result = applyEffects(ruleContext(), [
      { id: "effect:a-short", type: "rechargeOnShortRest", resourceId: "resource:probe" },
      { id: "effect:b-long", type: "rechargeOnLongRest", resourceId: "resource:probe" },
    ]);
    // Both effects trace as applied, but the map holds a single cadence: a rule of the
    // form "regain one use on a short rest and all uses on a long rest" is inexpressible.
    expect(result.trace.filter(item => item.applied)).toHaveLength(2);
    expect([...result.resourceRecharge]).toEqual([["resource:probe", "long-rest"]]);
    // A future fix needs a per-cadence recovery amount rather than one enum per resource.
  });
});

describe("GAP-3 a resource maximum has no canonical source", () => {
  it("lets the definition, the progression and a scaled value disagree at once", () => {
    const entries = [
      entry("class:probe", "class", {
        hitDie: 10, primaryAbilities: ["strength"], savingThrows: ["proficiency:a", "proficiency:b"],
        startingProficiencyIds: [], subclassLevel: 3, subclassIds: [],
        progression: [{ level: 1, proficiencyBonus: 2, featureIds: ["feature:resource"], choiceIds: [], resourceChanges: { "resource:probe": 3 } }],
      }),
      entry("feature:resource", "class-feature", { classId: "class:probe", level: 1, featureType: "resource" }, {
        effects: [
          { id: "effect:a-add", type: "addResource", resource: { id: "resource:probe", name: "Synthetic", maximum: { kind: "literal", value: 2 }, recharge: "short-rest" } },
          { id: "effect:b-scale", type: "scaleAtLevel", target: "resource:probe.maximum", levels: { "1": { kind: "literal", value: 4 } } },
        ],
      }),
    ];
    const result = deriveCharacterState({ character: character(), entries });

    // Three independent numbers for one maximum, no declared precedence, no issue raised.
    expect(result.ruleResult.resourceDefinitions.get("resource:probe")?.maximum).toEqual({ kind: "literal", value: 2 });
    expect(result.ruleResult.context.values["resource.resource:probe"]).toBe(3);
    expect(result.ruleResult.context.values["resource:probe.maximum"]).toBe(4);
    expect(result.status).toBe("ready");
    // A future fix should define one canonical maximum and reject or reconcile the rest.
  });
});

describe("GAP-4 one unresolved choice produces two diagnostics", () => {
  it("reports the same choice as both required and count-invalid", () => {
    const resolution = resolveChoices(
      [{ id: "choice:probe", label: "Synthetic", min: 1, max: 1, repeatable: false, options: [{ id: "option:a", label: "Synthetic" }] }],
      {},
    );
    expect(resolution.issues.map(issue => issue.code)).toEqual(["CHOICE_REQUIRED", "CHOICE_COUNT_INVALID"]);
    expect(new Set(resolution.issues.map(issue => issue.choiceId)).size).toBe(1);
    // A future fix should emit one diagnostic per unresolved choice so a consuming
    // surface does not show the same missing decision twice.
  });
});

describe("GAP-5 background ability-score increases are declared but never resolved", () => {
  it("leaves abilities untouched and offers no selection path", () => {
    const entries = [
      probeClass([]),
      entry("background:probe", "background", {
        abilityScoreChoices: { abilities: ["strength", "dexterity", "constitution"], increasePattern: [2, 1] },
        featId: "feat:probe", proficiencyIds: [], equipmentChoiceIds: [], equipmentBundleIds: [],
      }),
      entry("feat:probe", "feat", { category: "origin", repeatable: false }),
    ];
    const result = deriveCharacterState({ character: character({ backgroundId: "background:probe" }), entries });

    expect(result.activeEntryIds.has("background:probe")).toBe(true);
    // The declared increases are inert: no ability changes and nothing pending.
    expect(result.ruleResult.context.abilities.strength).toBe(10);
    expect(result.ruleResult.context.abilities.dexterity).toBe(10);
    expect(result.pendingChoiceIds.has("background:probe")).toBe(false);
    expect(result.status).toBe("ready");
    // `increasePattern` is also a single array, so a background offering an either/or
    // spread cannot be represented at all. A future fix needs a resolvable selection.
  });
});
