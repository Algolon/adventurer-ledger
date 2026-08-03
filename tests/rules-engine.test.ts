import { describe, expect, it } from "vitest";
import { abilityModifier, applyEffects, proficiencyBonus, type RuleContext } from "@/src/rules/engine";
import type { Effect } from "@/src/domain/model";

export const ruleContext = (): RuleContext => ({
  totalLevel: 5,
  classLevels: { "class:fighter:2024": 5 },
  abilities: { strength: 16, dexterity: 12, constitution: 14, intelligence: 13, wisdom: 14, charisma: 10 },
  tags: new Set(), features: new Set(), proficiencies: new Set(), armor: { worn: true, type: "shield" }, flags: {},
  values: { armorClass: 18, initiative: 1, speed: 30, criticalRange: 20 },
});

describe("rules engine", () => {
  it("calculates core modifiers", () => {
    expect(abilityModifier(16)).toBe(3);
    expect(proficiencyBonus(5)).toBe(3);
  });
  it("applies a conditional effect with an explicit disposition", () => {
    const effects: Effect[] = [{ id: "defense", type: "modifyArmorClass", operation: "add", value: { kind: "literal", value: 1 }, condition: { type: "wearingArmor" } }];
    const result = applyEffects(ruleContext(), effects);
    expect(result.context.values.armorClass).toBe(19);
    expect(result.trace[0]).toEqual({ effectId: "defense", type: "modifyArmorClass", disposition: "automatic", applied: true, reason: "Applied" });
  });
});
