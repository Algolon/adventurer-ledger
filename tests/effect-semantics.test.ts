import { describe, expect, it } from "vitest";
import type { Effect, ResourceDefinition } from "@/src/domain/model";
import { actionGrantsByKind, applyEffects } from "@/src/rules/engine";
import { ruleContext } from "@/tests/rules-engine.test";

/**
 * Semantic coverage for the effect runtime. These assert resulting state and issues;
 * the golden matrix in `effect-runtime-golden.test.ts` only proves that every schema
 * variant reaches an explicit trace.
 */
const literal = (value: number) => ({ kind: "literal" as const, value });
const run = (effects: Effect[], resolvedChoiceIds?: ReadonlySet<string>) =>
  applyEffects(ruleContext(), effects, resolvedChoiceIds ? { resolvedChoiceIds } : {});
const traceFor = (effects: Effect[], effectId: string) =>
  run(effects).trace.find(item => item.effectId === effectId);

describe("feature state", () => {
  it("separates granted, disabled and replaced features from the active feature set", () => {
    const result = run([
      { id: "effect:1-grant-a", type: "grantFeature", featureId: "feature:a" },
      { id: "effect:2-grant-b", type: "grantFeature", featureId: "feature:b" },
      { id: "effect:3-disable-b", type: "disableFeature", featureId: "feature:b" },
      { id: "effect:4-replace-a", type: "replaceFeature", featureId: "feature:a", replacementId: "feature:c" },
    ]);
    expect(result.grantedFeatures).toEqual(new Set(["feature:a", "feature:b"]));
    expect(result.disabledFeatures).toEqual(new Set(["feature:b"]));
    // The active set is the authoritative one: b was disabled, a was replaced by c.
    expect(result.context.features).toEqual(new Set(["feature:c"]));
    expect(result.grantedFeatures.has("feature:c")).toBe(false);
    expect(result.issues).toEqual([]);
  });

  it("records expertise as both a proficiency and an expertise grant", () => {
    const result = run([
      { id: "effect:proficiency", type: "grantProficiency", proficiencyId: "proficiency:athletics" },
      { id: "effect:expertise", type: "grantExpertise", proficiencyId: "proficiency:stealth" },
    ]);
    expect(result.context.proficiencies).toEqual(new Set(["proficiency:athletics", "proficiency:stealth"]));
    expect(result.expertise).toEqual(new Set(["proficiency:stealth"]));
  });
});

describe("action-economy grants", () => {
  it("keeps attacks, actions, bonus actions and reactions in separate typed categories", () => {
    const result = run([
      { id: "effect:a-action", type: "addAction", definitionId: "action:one" },
      { id: "effect:b-attack", type: "addAttack", definitionId: "attack:one" },
      { id: "effect:c-bonus", type: "addBonusAction", definitionId: "bonus-action:one" },
      { id: "effect:d-reaction", type: "addReaction", definitionId: "reaction:one" },
    ]);
    expect(result.actionGrants).toEqual([
      { kind: "action", definitionId: "action:one", effectId: "effect:a-action" },
      { kind: "attack", definitionId: "attack:one", effectId: "effect:b-attack" },
      { kind: "bonus-action", definitionId: "bonus-action:one", effectId: "effect:c-bonus" },
      { kind: "reaction", definitionId: "reaction:one", effectId: "effect:d-reaction" },
    ]);
    expect(actionGrantsByKind(result.actionGrants)).toEqual({
      attack: ["attack:one"],
      action: ["action:one"],
      "bonus-action": ["bonus-action:one"],
      reaction: ["reaction:one"],
    });
  });

  it("keeps one definition usable in two categories but collapses an accidental duplicate", () => {
    const result = run([
      { id: "effect:a", type: "addAction", definitionId: "definition:shared" },
      { id: "effect:b", type: "addBonusAction", definitionId: "definition:shared" },
      { id: "effect:c", type: "addBonusAction", definitionId: "definition:shared" },
    ]);
    expect(result.actionGrants).toEqual([
      { kind: "action", definitionId: "definition:shared", effectId: "effect:a" },
      { kind: "bonus-action", definitionId: "definition:shared", effectId: "effect:b" },
    ]);
  });

  it("orders grants by effect priority and then effect ID", () => {
    const result = run([
      { id: "effect:a", type: "addAttack", definitionId: "attack:late", priority: 10 },
      { id: "effect:z", type: "addAttack", definitionId: "attack:early", priority: 1 },
    ]);
    expect(result.actionGrants.map(grant => grant.definitionId)).toEqual(["attack:early", "attack:late"]);
  });
});

describe("choice-driven effects", () => {
  const grantChoice: Effect = { id: "effect:choice", type: "grantChoice", choiceId: "choice:style" };

  it("reports an unresolved choice as pending with an overridable issue and no application", () => {
    const result = run([grantChoice]);
    expect(result.pendingChoices).toEqual(new Set(["choice:style"]));
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "RULE_CHOICE_REQUIRED", severity: "rules-warning", overridable: true, affectedRule: "effect:choice" }),
    ]);
    expect(result.trace).toContainEqual(expect.objectContaining({ applied: false, reason: "Choice required" }));
  });

  it("applies a resolved choice without leaving it pending", () => {
    const result = run([grantChoice], new Set(["choice:style"]));
    expect(result.pendingChoices).toEqual(new Set());
    expect(result.issues).toEqual([]);
    expect(result.trace).toContainEqual(expect.objectContaining({ effectId: "effect:choice", applied: true, reason: "Applied" }));
  });
});

describe("numeric modification", () => {
  it("modifies ability, armour class, initiative, speed and critical range", () => {
    const result = run([
      { id: "effect:a-ability", type: "modifyAbility", ability: "strength", operation: "add", value: literal(2) },
      { id: "effect:b-maximum", type: "modifyAbilityMaximum", ability: "strength", operation: "add", value: literal(2) },
      { id: "effect:c-armour", type: "modifyArmorClass", operation: "add", value: literal(2) },
      { id: "effect:d-initiative", type: "modifyInitiative", operation: "set", value: literal(7) },
      { id: "effect:e-speed", type: "modifySpeed", operation: "add", value: literal(10) },
      { id: "effect:f-critical", type: "modifyCriticalRange", operation: "subtract", value: literal(1) },
      { id: "effect:g-skill", type: "modifySkill", target: "athletics", operation: "add", value: literal(3) },
      { id: "effect:h-save", type: "modifySavingThrow", target: "strength", operation: "add", value: literal(1) },
    ]);
    expect(result.context.abilities.strength).toBe(18);
    expect(result.context.values).toMatchObject({
      "abilityMaximum.strength": 22,
      armorClass: 20,
      initiative: 7,
      speed: 40,
      criticalRange: 19,
      "skill.athletics": 3,
      "savingThrow.strength": 1,
    });
    expect(result.issues).toEqual([]);
  });

  it("resolves allow-listed formulas against the rule context", () => {
    const result = run([
      { id: "effect:proficiency", type: "setCalculation", target: "value:proficiency", value: { kind: "formula", formula: "proficiencyBonus", variables: [] } },
      { id: "effect:modifier", type: "setCalculation", target: "value:strength", value: { kind: "formula", formula: "abilityModifier", variables: ["strength"] } },
    ]);
    expect(result.context.values).toMatchObject({ "value:proficiency": 3, "value:strength": 3 });
  });

  it("fails an unsupported formula as a non-overridable error instead of silently applying zero", () => {
    const result = run([
      { id: "effect:broken", type: "setCalculation", target: "value:broken", value: { kind: "formula", formula: "unsupportedFormula", variables: [] } },
    ]);
    expect(result.context.values["value:broken"]).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "RULE_EFFECT_FAILED", severity: "error", overridable: false }),
    ]);
    expect(result.trace).toContainEqual(expect.objectContaining({ applied: false, reason: "Evaluation error" }));
  });

  it("does not apply an effect whose condition is not met", () => {
    const result = run([
      { id: "effect:gated", type: "modifyArmorClass", operation: "add", value: literal(5), condition: { type: "hasFeature", featureId: "feature:absent" } },
    ]);
    expect(result.context.values.armorClass).toBe(18);
    expect(result.trace).toEqual([expect.objectContaining({ applied: false, reason: "Condition not met" })]);
  });
});

/**
 * `min` and `max` name the bound they establish, not the arithmetic they perform.
 * These cases exist so the decision cannot drift: `min` is a lower bound and `max`
 * is an upper bound, matching `setMinimum` and `setMaximum`.
 */
describe("bounding operation semantics", () => {
  const armourClass = (operation: "min" | "max", value: number) =>
    run([{ id: "effect:bound", type: "modifyArmorClass", operation, value: literal(value) }]).context.values.armorClass;
  const bounded = (type: "setMinimum" | "setMaximum", value: number) =>
    run([{ id: "effect:bound", type, target: "armorClass", value: literal(value) }]).context.values.armorClass;

  it("treats min as a lower bound that only ever raises the value", () => {
    expect(armourClass("min", 20)).toBe(20);
    expect(armourClass("min", 10)).toBe(18);
  });

  it("treats max as an upper bound that only ever lowers the value", () => {
    expect(armourClass("max", 15)).toBe(15);
    expect(armourClass("max", 25)).toBe(18);
  });

  it("keeps setMinimum and setMaximum consistent with the min and max operations", () => {
    expect(bounded("setMinimum", 20)).toBe(armourClass("min", 20));
    expect(bounded("setMinimum", 10)).toBe(armourClass("min", 10));
    expect(bounded("setMaximum", 15)).toBe(armourClass("max", 15));
    expect(bounded("setMaximum", 25)).toBe(armourClass("max", 25));
  });

  it("adopts the operand when the bounded value has no prior state", () => {
    const result = run([
      { id: "effect:a-minimum", type: "setMinimum", target: "value:fresh-minimum", value: literal(4) },
      { id: "effect:b-maximum", type: "setMaximum", target: "value:fresh-maximum", value: literal(4) },
    ]);
    expect(result.context.values).toMatchObject({ "value:fresh-minimum": 4, "value:fresh-maximum": 4 });
  });
});

describe("attack and damage modifier registration", () => {
  it("registers declarative modifiers with resolved values and copied selectors", () => {
    const attack: Effect = { id: "effect:attack", type: "modifyAttack", selector: { usage: "melee" }, operation: "add", value: literal(2) };
    const damage: Effect = { id: "effect:damage", type: "modifyDamage", selector: { usage: "melee" }, operation: "add", value: { kind: "formula", formula: "proficiencyBonus", variables: [] } };
    const result = run([attack, damage]);
    expect(result.attackModifiers).toEqual([{ effectId: "effect:attack", selector: { usage: "melee" }, operation: "add", value: 2 }]);
    expect(result.damageModifiers).toEqual([{ effectId: "effect:damage", selector: { usage: "melee" }, operation: "add", value: 3 }]);
    if (attack.type !== "modifyAttack") throw new Error("Synthetic effect changed shape");
    attack.selector.usage = "ranged";
    expect(result.attackModifiers[0]?.selector).toEqual({ usage: "melee" });
  });

  it("registers advantage and disadvantage per target without cancelling either out", () => {
    const result = run([
      { id: "effect:a", type: "addAdvantage", target: "save:dexterity" },
      { id: "effect:b", type: "addDisadvantage", target: "save:dexterity" },
    ]);
    expect(result.rollRules.advantages).toEqual(new Set(["save:dexterity"]));
    expect(result.rollRules.disadvantages).toEqual(new Set(["save:dexterity"]));
  });
});

describe("resources and recharge", () => {
  it("stores the resource definition and lets a recharge effect set the cadence", () => {
    const resource: ResourceDefinition = { id: "resource:focus", name: "Synthetic focus", maximum: literal(3), recharge: "short-rest" };
    const result = run([
      { id: "effect:a-resource", type: "addResource", resource },
      { id: "effect:b-recharge", type: "rechargeOnLongRest", resourceId: "resource:focus" },
    ]);
    expect(result.resources).toEqual(["resource:focus"]);
    expect(result.resourceDefinitions.get("resource:focus")).toEqual(resource);
    // The declared cadence stays on the definition; the recharge effect is separate state.
    expect(result.resourceDefinitions.get("resource:focus")?.recharge).toBe("short-rest");
    expect(result.resourceRecharge.get("resource:focus")).toBe("long-rest");
  });

  it("keeps short-rest recharge distinct from long-rest recharge", () => {
    const result = run([{ id: "effect:short", type: "rechargeOnShortRest", resourceId: "resource:focus" }]);
    expect(result.resourceRecharge.get("resource:focus")).toBe("short-rest");
  });
});

describe("level gating", () => {
  const nested: Effect = { id: "effect:nested", type: "grantFeature", featureId: "feature:nested" };

  it("does not apply a nested effect below the total-level threshold", () => {
    const result = run([{ id: "effect:unlock", type: "unlockAtLevel", level: 6, effect: nested }]);
    expect(result.grantedFeatures).toEqual(new Set());
    expect(result.trace).toEqual([expect.objectContaining({ effectId: "effect:unlock", applied: false, reason: "Level not met" })]);
  });

  it("applies the nested effect at the threshold and traces both effects", () => {
    const result = run([{ id: "effect:unlock", type: "unlockAtLevel", level: 5, effect: nested }]);
    expect(result.grantedFeatures).toEqual(new Set(["feature:nested"]));
    expect(result.trace).toEqual([
      expect.objectContaining({ effectId: "effect:nested", applied: true }),
      expect.objectContaining({ effectId: "effect:unlock", applied: true }),
    ]);
  });

  it("measures a class-scoped gate against that class level only", () => {
    const known: Effect = { id: "effect:unlock", type: "unlockAtLevel", level: 5, scope: "class", classId: "class:fighter:2024", effect: nested };
    const unknown: Effect = { id: "effect:unlock", type: "unlockAtLevel", level: 1, scope: "class", classId: "class:absent", effect: nested };
    expect(run([known]).grantedFeatures).toEqual(new Set(["feature:nested"]));
    expect(run([unknown]).grantedFeatures).toEqual(new Set());
    expect(traceFor([unknown], "effect:unlock")).toMatchObject({ applied: false, reason: "Level not met" });
  });

  it("selects the highest scale-at-level threshold at or below the current level", () => {
    const result = run([
      { id: "effect:scale", type: "scaleAtLevel", target: "value:scaled", levels: { "1": literal(1), "5": literal(3), "9": literal(5) } },
    ]);
    expect(result.context.values["value:scaled"]).toBe(3);
  });

  it("does not scale when no threshold is reached", () => {
    const result = run([{ id: "effect:scale", type: "scaleAtLevel", target: "value:scaled", levels: { "9": literal(5) } }]);
    expect(result.context.values["value:scaled"]).toBeUndefined();
    expect(result.trace).toEqual([expect.objectContaining({ applied: false, reason: "Level not met" })]);
  });
});

describe("dice and roll rules", () => {
  it("records added, replaced, rerolled and minimum dice state without rolling", () => {
    const added: Effect = { id: "effect:a-add", type: "addDice", target: "damage:melee", dice: { count: 1, faces: 6 } };
    const result = run([
      added,
      { id: "effect:b-replace", type: "replaceDice", target: "damage:melee", match: { count: 1, faces: 6 }, replacement: { count: 1, faces: 8 } },
      { id: "effect:c-reroll", type: "rerollDice", target: "damage:melee", rolls: [1, 2], limit: 1, keep: "new" },
      { id: "effect:d-minimum", type: "setMinimumRoll", target: "check:athletics", minimum: 10 },
    ]);
    expect(result.rollRules.extraDice).toEqual([{ effectId: "effect:a-add", target: "damage:melee", dice: { count: 1, faces: 6 } }]);
    expect(result.rollRules.replacements).toEqual([
      { effectId: "effect:b-replace", target: "damage:melee", replacement: { count: 1, faces: 8 }, match: { count: 1, faces: 6 } },
    ]);
    expect(result.rollRules.rerolls).toEqual([{ effectId: "effect:c-reroll", target: "damage:melee", rolls: [1, 2], limit: 1, keep: "new" }]);
    expect(result.rollRules.minimums).toEqual([{ effectId: "effect:d-minimum", target: "check:athletics", minimum: 10 }]);
    if (added.type !== "addDice") throw new Error("Synthetic effect changed shape");
    added.dice.faces = 12;
    expect(result.rollRules.extraDice[0]?.dice).toEqual({ count: 1, faces: 6 });
  });

  it("omits the match clause when a replacement applies to every die on the target", () => {
    const result = run([{ id: "effect:replace", type: "replaceDice", target: "damage:melee", replacement: { count: 2, faces: 6 } }]);
    expect(result.rollRules.replacements[0]).toEqual({ effectId: "effect:replace", target: "damage:melee", replacement: { count: 2, faces: 6 } });
    expect("match" in (result.rollRules.replacements[0] ?? {})).toBe(false);
  });
});

describe("option and equipment grants", () => {
  it("collects each option grant in its own typed category", () => {
    const result = run([
      { id: "effect:a", type: "addWeaponMastery", optionId: "mastery:one" },
      { id: "effect:b", type: "grantFightingStyle", optionId: "style:one" },
      { id: "effect:c", type: "grantManeuver", optionId: "maneuver:one" },
      { id: "effect:d", type: "grantInvocation", optionId: "invocation:one" },
      { id: "effect:e", type: "grantMetamagic", optionId: "metamagic:one" },
    ]);
    expect(result.optionGrants).toEqual({
      weaponMasteries: new Set(["mastery:one"]),
      fightingStyles: new Set(["style:one"]),
      maneuvers: new Set(["maneuver:one"]),
      invocations: new Set(["invocation:one"]),
      metamagic: new Set(["metamagic:one"]),
    });
  });

  it("collects equipment bundle grants once per bundle", () => {
    const result = run([
      { id: "effect:a", type: "grantEquipmentBundle", bundleId: "bundle:starter" },
      { id: "effect:b", type: "grantEquipmentBundle", bundleId: "bundle:starter" },
      { id: "effect:c", type: "grantEquipmentBundle", bundleId: "bundle:extra" },
    ]);
    expect(result.equipmentBundleIds).toEqual(new Set(["bundle:starter", "bundle:extra"]));
  });

  it("separates known spells from always-prepared spells and spell lists", () => {
    const result = run([
      { id: "effect:a", type: "addSpell", spellId: "spell:one" },
      { id: "effect:b", type: "addSpell", spellId: "spell:two", alwaysPrepared: true },
      { id: "effect:c", type: "addSpellList", spellListId: "spell-list:one" },
    ]);
    expect(result.spells).toEqual(new Set(["spell:one", "spell:two"]));
    expect(result.alwaysPreparedSpells).toEqual(new Set(["spell:two"]));
    expect(result.spellLists).toEqual(new Set(["spell-list:one"]));
  });
});

describe("manual adjudication", () => {
  it("produces an overridable review issue and changes no state", () => {
    const result = run([
      { id: "effect:manual", type: "manualAdjudication", reasonCode: "SYNTHETIC_REVIEW", target: "value:untouched" },
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "RULE_EFFECT_REVIEW_REQUIRED", severity: "rules-warning", overridable: true, affectedRule: "effect:manual" }),
    ]);
    expect(result.trace).toEqual([
      expect.objectContaining({ disposition: "manual-adjudication", applied: false, reason: "Review required" }),
    ]);
    expect(result.context.values["value:untouched"]).toBeUndefined();
  });

  it("does not leak the reason code target into a value", () => {
    const result = run([{ id: "effect:manual", type: "manualAdjudication", reasonCode: "SYNTHETIC_REVIEW" }]);
    expect(JSON.stringify(result.issues)).not.toContain("SYNTHETIC_REVIEW");
  });
});
