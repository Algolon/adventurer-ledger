import type { Effect, EffectDisposition } from "@/src/domain/model";

export interface EffectCapability {
  schema: "supported";
  runtime: "supported" | "review-required";
  disposition: EffectDisposition;
}

const automatic = { schema: "supported", runtime: "supported", disposition: "automatic" } as const;
const choiceDriven = { schema: "supported", runtime: "supported", disposition: "choice-driven" } as const;
const manual = { schema: "supported", runtime: "review-required", disposition: "manual-adjudication" } as const;

/**
 * Exhaustive by construction: adding an Effect variant fails typecheck until its
 * runtime disposition is declared here and handled by the rules engine.
 */
export const EFFECT_CAPABILITIES = {
  grantProficiency: automatic,
  grantExpertise: automatic,
  grantFeature: automatic,
  replaceFeature: automatic,
  disableFeature: automatic,
  grantChoice: choiceDriven,
  modifyAbility: automatic,
  modifyAbilityMaximum: automatic,
  modifySkill: automatic,
  modifySavingThrow: automatic,
  modifyArmorClass: automatic,
  modifyInitiative: automatic,
  modifySpeed: automatic,
  modifyCriticalRange: automatic,
  modifyAttack: automatic,
  modifyDamage: automatic,
  addSpell: automatic,
  addSpellList: automatic,
  addResource: automatic,
  addAttack: automatic,
  addAction: automatic,
  addBonusAction: automatic,
  addReaction: automatic,
  setMinimum: automatic,
  setMaximum: automatic,
  setCalculation: automatic,
  addAdvantage: automatic,
  addDisadvantage: automatic,
  rechargeOnShortRest: automatic,
  rechargeOnLongRest: automatic,
  unlockAtLevel: automatic,
  scaleAtLevel: automatic,
  addWeaponMastery: automatic,
  grantFightingStyle: automatic,
  grantManeuver: automatic,
  grantInvocation: automatic,
  grantMetamagic: automatic,
  addDice: automatic,
  replaceDice: automatic,
  rerollDice: automatic,
  setMinimumRoll: automatic,
  grantEquipmentBundle: automatic,
  manualAdjudication: manual,
} satisfies Record<Effect["type"], EffectCapability>;

export type EffectType = keyof typeof EFFECT_CAPABILITIES;
export const effectCapability = (type: EffectType): EffectCapability => EFFECT_CAPABILITIES[type];
