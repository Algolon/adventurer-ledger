import { describe, expect, it } from "vitest";
import type { Effect } from "@/src/domain/model";
import { EFFECT_CAPABILITIES } from "@/src/rules/effect-capabilities";
import { applyEffects } from "@/src/rules/engine";
import { ruleContext } from "@/tests/rules-engine.test";

const literal = { kind: "literal" as const, value: 1 };
const base = <T extends Effect["type"]>(type: T) => ({ id: `effect:${type}`, type });
const GOLDEN_EFFECTS = {
  grantProficiency: { ...base("grantProficiency"), proficiencyId: "proficiency:test" },
  grantExpertise: { ...base("grantExpertise"), proficiencyId: "proficiency:test" },
  grantFeature: { ...base("grantFeature"), featureId: "feature:test" },
  replaceFeature: { ...base("replaceFeature"), featureId: "feature:old", replacementId: "feature:new" },
  disableFeature: { ...base("disableFeature"), featureId: "feature:test" },
  grantChoice: { ...base("grantChoice"), choiceId: "choice:test" },
  modifyAbility: { ...base("modifyAbility"), ability: "strength", operation: "add", value: literal },
  modifyAbilityMaximum: { ...base("modifyAbilityMaximum"), ability: "strength", operation: "add", value: literal },
  modifySkill: { ...base("modifySkill"), target: "athletics", operation: "add", value: literal },
  modifySavingThrow: { ...base("modifySavingThrow"), target: "strength", operation: "add", value: literal },
  modifyArmorClass: { ...base("modifyArmorClass"), operation: "add", value: literal },
  modifyInitiative: { ...base("modifyInitiative"), operation: "add", value: literal },
  modifySpeed: { ...base("modifySpeed"), operation: "add", value: literal },
  modifyCriticalRange: { ...base("modifyCriticalRange"), operation: "subtract", value: literal },
  modifyAttack: { ...base("modifyAttack"), selector: { usage: "melee" }, operation: "add", value: literal },
  modifyDamage: { ...base("modifyDamage"), selector: { usage: "melee" }, operation: "add", value: literal },
  addSpell: { ...base("addSpell"), spellId: "spell:test", alwaysPrepared: true },
  addSpellList: { ...base("addSpellList"), spellListId: "spell-list:test" },
  addResource: { ...base("addResource"), resource: { id: "resource:test", name: "Synthetic", maximum: literal, recharge: "short-rest" } },
  addAttack: { ...base("addAttack"), definitionId: "attack:test" },
  addAction: { ...base("addAction"), definitionId: "action:test" },
  addBonusAction: { ...base("addBonusAction"), definitionId: "bonus-action:test" },
  addReaction: { ...base("addReaction"), definitionId: "reaction:test" },
  setMinimum: { ...base("setMinimum"), target: "minimum:test", value: literal },
  setMaximum: { ...base("setMaximum"), target: "maximum:test", value: literal },
  setCalculation: { ...base("setCalculation"), target: "calculation:test", value: literal },
  addAdvantage: { ...base("addAdvantage"), target: "check:test" },
  addDisadvantage: { ...base("addDisadvantage"), target: "attack:test" },
  rechargeOnShortRest: { ...base("rechargeOnShortRest"), resourceId: "resource:test" },
  rechargeOnLongRest: { ...base("rechargeOnLongRest"), resourceId: "resource:test" },
  unlockAtLevel: { ...base("unlockAtLevel"), level: 5, scope: "class", classId: "class:fighter:2024", effect: { id: "effect:nested", type: "grantFeature", featureId: "feature:nested" } },
  scaleAtLevel: { ...base("scaleAtLevel"), levels: { "5": literal }, target: "scale:test" },
  addWeaponMastery: { ...base("addWeaponMastery"), optionId: "mastery:test" },
  grantFightingStyle: { ...base("grantFightingStyle"), optionId: "style:test" },
  grantManeuver: { ...base("grantManeuver"), optionId: "maneuver:test" },
  grantInvocation: { ...base("grantInvocation"), optionId: "invocation:test" },
  grantMetamagic: { ...base("grantMetamagic"), optionId: "metamagic:test" },
  addDice: { ...base("addDice"), target: "damage:test", dice: { count: 1, faces: 8 } },
  replaceDice: { ...base("replaceDice"), target: "damage:test", match: { count: 1, faces: 6 }, replacement: { count: 1, faces: 8 } },
  rerollDice: { ...base("rerollDice"), target: "damage:test", rolls: [1, 2], limit: 1, keep: "new" },
  setMinimumRoll: { ...base("setMinimumRoll"), target: "check:test", minimum: 10 },
  grantEquipmentBundle: { ...base("grantEquipmentBundle"), bundleId: "bundle:test" },
  manualAdjudication: { ...base("manualAdjudication"), reasonCode: "SYNTHETIC_REVIEW" },
} satisfies Record<Effect["type"], Effect>;

describe("effect runtime golden matrix", () => {
  it.each(Object.entries(GOLDEN_EFFECTS))("handles %s explicitly", (type, effect) => {
    const result = applyEffects(ruleContext(), [effect]);
    const trace = result.trace.find(item => item.effectId === effect.id);
    expect(trace, type).toBeDefined();
    expect(trace?.disposition).toBe(EFFECT_CAPABILITIES[effect.type].disposition);
    if (effect.type === "grantChoice") expect(trace).toMatchObject({ applied: false, reason: "Choice required" });
    else if (effect.type === "manualAdjudication") expect(trace).toMatchObject({ applied: false, reason: "Review required" });
    else expect(trace).toMatchObject({ applied: true, reason: "Applied" });
  });

  it("has no schema-allowed effect without a capability or trace", () => {
    expect(Object.keys(EFFECT_CAPABILITIES).sort()).toEqual(Object.keys(GOLDEN_EFFECTS).sort());
    const result = applyEffects(ruleContext(), Object.values(GOLDEN_EFFECTS));
    const tracedTypes = new Set(result.trace.map(item => item.type));
    expect([...tracedTypes].sort()).toEqual(Object.keys(EFFECT_CAPABILITIES).sort());
    expect(result.trace.filter(item => !item.applied).every(item => item.reason !== "Applied")).toBe(true);
    expect(result.rollRules).toMatchObject({
      extraDice: [expect.objectContaining({ target: "damage:test" })],
      replacements: [expect.objectContaining({ target: "damage:test" })],
      rerolls: [expect.objectContaining({ target: "damage:test" })],
      minimums: [expect.objectContaining({ target: "check:test" })],
    });
  });
});
