import type {
  Ability,
  ActionGrantKind,
  Condition,
  DiceExpression,
  Effect,
  EffectDisposition,
  ID,
  ResourceDefinition,
  ValidationIssue,
  Value,
} from "@/src/domain/model";
import { effectCapability } from "@/src/rules/effect-capabilities";

export interface RuleContext {
  totalLevel: number;
  classLevels: Record<string, number>;
  abilities: Record<Ability, number>;
  tags: Set<string>;
  features: Set<string>;
  proficiencies: Set<string>;
  armor: { worn: boolean; type?: "light" | "medium" | "heavy" | "shield" };
  flags: Record<string, string | number | boolean>;
  values: Record<string, number>;
}

export interface RollRuleState {
  extraDice: Array<{ effectId: string; target: string; dice: DiceExpression }>;
  replacements: Array<{ effectId: string; target: string; replacement: DiceExpression; match?: DiceExpression }>;
  rerolls: Array<{ effectId: string; target: string; rolls: number[]; limit: number; keep: "new" | "higher" | "lower" }>;
  minimums: Array<{ effectId: string; target: string; minimum: number }>;
  advantages: Set<string>;
  disadvantages: Set<string>;
}

/**
 * One typed grant collection that preserves the action-economy category, so the
 * play sheet can group attacks, actions, bonus actions and reactions without
 * reinterpreting effect types. Ordering follows effect priority then effect ID.
 */
export interface GrantedAction {
  kind: ActionGrantKind;
  definitionId: ID;
  effectId: ID;
}

const ACTION_GRANT_KINDS: Record<
  Extract<Effect["type"], "addAttack" | "addAction" | "addBonusAction" | "addReaction">,
  ActionGrantKind
> = {
  addAttack: "attack",
  addAction: "action",
  addBonusAction: "bonus-action",
  addReaction: "reaction",
};

/** Deterministic per-kind view of the grant collection for action-economy surfaces. */
export function actionGrantsByKind(grants: readonly GrantedAction[]): Record<ActionGrantKind, ID[]> {
  const grouped: Record<ActionGrantKind, ID[]> = { attack: [], action: [], "bonus-action": [], reaction: [] };
  for (const grant of grants) grouped[grant.kind].push(grant.definitionId);
  return grouped;
}

export interface RuleTrace {
  effectId: string;
  type: Effect["type"];
  disposition: EffectDisposition;
  applied: boolean;
  reason: "Applied" | "Condition not met" | "Level not met" | "Choice required" | "Review required" | "Evaluation error";
}

type RuntimeIssue = Omit<ValidationIssue, "createdAt" | "updatedAt">;
export interface RuleResult {
  context: RuleContext;
  grantedFeatures: Set<string>;
  disabledFeatures: Set<string>;
  expertise: Set<string>;
  actionGrants: GrantedAction[];
  resources: string[];
  resourceDefinitions: Map<string, ResourceDefinition>;
  spells: Set<string>;
  alwaysPreparedSpells: Set<string>;
  spellLists: Set<string>;
  pendingChoices: Set<string>;
  equipmentBundleIds: Set<string>;
  optionGrants: Record<"weaponMasteries" | "fightingStyles" | "maneuvers" | "invocations" | "metamagic", Set<string>>;
  resourceRecharge: Map<string, "short-rest" | "long-rest">;
  attackModifiers: Array<{ effectId: string; selector: Record<string, string>; operation: "add" | "subtract" | "multiply" | "set" | "min" | "max"; value: number }>;
  damageModifiers: Array<{ effectId: string; selector: Record<string, string>; operation: "add" | "subtract" | "multiply" | "set" | "min" | "max"; value: number }>;
  rollRules: RollRuleState;
  issues: RuntimeIssue[];
  trace: RuleTrace[];
}

export interface ApplyEffectsOptions {
  resolvedChoiceIds?: ReadonlySet<string>;
}

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);
export const proficiencyBonus = (level: number) => 2 + Math.floor((Math.max(1, level) - 1) / 4);

const compare = (left: number, operator: string, right: number) => ({
  eq: left === right,
  neq: left !== right,
  gt: left > right,
  gte: left >= right,
  lt: left < right,
  lte: left <= right,
}[operator] ?? false);

export function evaluateCondition(condition: Condition | undefined, context: RuleContext): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every(item => evaluateCondition(item, context));
  if ("any" in condition) return condition.any.some(item => evaluateCondition(item, context));
  if ("not" in condition) return !evaluateCondition(condition.not, context);
  switch (condition.type) {
    case "always": return true;
    case "wearingArmor": return context.armor.worn && (!condition.armorType || context.armor.type === condition.armorType);
    case "hasFeature": return context.features.has(condition.featureId);
    case "hasTag": return context.tags.has(condition.tag);
    case "classLevel": return compare(context.classLevels[condition.classId] ?? 0, condition.operator, condition.value);
    case "totalLevel": return compare(context.totalLevel, condition.operator, condition.value);
    case "ability": return compare(context.abilities[condition.ability], condition.operator, condition.value);
    case "proficientWith": return context.proficiencies.has(condition.proficiencyId);
    case "customFlag": return context.flags[condition.key] === condition.equals;
  }
}

function resolveValue(value: Value, context: RuleContext): number | string | boolean {
  if (value.kind === "literal") return value.value;
  if (value.kind === "path") return context.values[value.path] ?? 0;
  if (value.formula === "proficiencyBonus") return proficiencyBonus(context.totalLevel);
  const variable = value.variables[0];
  if (value.formula === "abilityModifier" && variable && variable in context.abilities)
    return abilityModifier(context.abilities[variable as Ability]);
  throw new Error("Unsupported safe formula");
}

function numeric(value: Value, context: RuleContext): number {
  const resolved = resolveValue(value, context);
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) throw new Error("Effect value is not numeric");
  return resolved;
}

function mutate(left: number, operation: "add" | "subtract" | "multiply" | "set" | "min" | "max", right: number): number {
  switch (operation) {
    case "add": return left + right;
    case "subtract": return left - right;
    case "multiply": return left * right;
    case "set": return right;
    case "min": return Math.max(left, right);
    case "max": return Math.min(left, right);
  }
}

const assertNever = (_effect: never): never => {
  throw new Error("Unhandled effect variant");
};

function runtimeIssue(effect: Effect, code: "RULE_EFFECT_FAILED" | "RULE_EFFECT_REVIEW_REQUIRED" | "RULE_CHOICE_REQUIRED", severity: RuntimeIssue["severity"]): RuntimeIssue {
  return {
    id: `rule:${code.toLocaleLowerCase()}:${effect.id}`,
    severity,
    code,
    message: code === "RULE_EFFECT_REVIEW_REQUIRED"
      ? `Effect ${effect.id} requires manual rules review`
      : code === "RULE_CHOICE_REQUIRED"
        ? `Effect ${effect.id} requires a resolved choice`
        : `Effect ${effect.id} could not be evaluated`,
    affectedRule: effect.id,
    overridable: code !== "RULE_EFFECT_FAILED",
  };
}

function createResult(initial: RuleContext): RuleResult {
  const context: RuleContext = {
    ...initial,
    abilities: { ...initial.abilities },
    tags: new Set(initial.tags),
    features: new Set(initial.features),
    proficiencies: new Set(initial.proficiencies),
    armor: { ...initial.armor },
    flags: { ...initial.flags },
    values: { ...initial.values },
  };
  return {
    context,
    grantedFeatures: new Set(),
    disabledFeatures: new Set(),
    expertise: new Set(),
    actionGrants: [],
    resources: [],
    resourceDefinitions: new Map(),
    spells: new Set(),
    alwaysPreparedSpells: new Set(),
    spellLists: new Set(),
    pendingChoices: new Set(),
    equipmentBundleIds: new Set(),
    optionGrants: {
      weaponMasteries: new Set(), fightingStyles: new Set(), maneuvers: new Set(), invocations: new Set(), metamagic: new Set(),
    },
    resourceRecharge: new Map(),
    attackModifiers: [],
    damageModifiers: [],
    rollRules: { extraDice: [], replacements: [], rerolls: [], minimums: [], advantages: new Set(), disadvantages: new Set() },
    issues: [],
    trace: [],
  };
}

function effectLevel(effect: Extract<Effect, { type: "unlockAtLevel" | "scaleAtLevel" }>, context: RuleContext): number {
  return effect.scope === "class" && effect.classId ? context.classLevels[effect.classId] ?? 0 : context.totalLevel;
}

function applyOne(effect: Effect, result: RuleResult, options: ApplyEffectsOptions): void {
  const capability = effectCapability(effect.type);
  if (!evaluateCondition(effect.condition, result.context)) {
    result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: false, reason: "Condition not met" });
    return;
  }
  try {
    const context = result.context;
    switch (effect.type) {
      case "grantProficiency": context.proficiencies.add(effect.proficiencyId); break;
      case "grantExpertise": context.proficiencies.add(effect.proficiencyId); result.expertise.add(effect.proficiencyId); break;
      case "grantFeature": context.features.add(effect.featureId); result.grantedFeatures.add(effect.featureId); break;
      case "disableFeature": context.features.delete(effect.featureId); result.disabledFeatures.add(effect.featureId); break;
      case "replaceFeature":
        context.features.delete(effect.featureId); context.features.add(effect.replacementId); break;
      case "grantChoice":
        if (options.resolvedChoiceIds?.has(effect.choiceId)) break;
        result.pendingChoices.add(effect.choiceId);
        result.issues.push(runtimeIssue(effect, "RULE_CHOICE_REQUIRED", "rules-warning"));
        result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: false, reason: "Choice required" });
        return;
      case "modifyAbility": context.abilities[effect.ability] = mutate(context.abilities[effect.ability], effect.operation, numeric(effect.value, context)); break;
      case "modifyAbilityMaximum": {
        const key = `abilityMaximum.${effect.ability}`;
        context.values[key] = mutate(context.values[key] ?? 20, effect.operation, numeric(effect.value, context));
        break;
      }
      case "modifySkill": context.values[`skill.${effect.target}`] = mutate(context.values[`skill.${effect.target}`] ?? 0, effect.operation, numeric(effect.value, context)); break;
      case "modifySavingThrow": context.values[`savingThrow.${effect.target}`] = mutate(context.values[`savingThrow.${effect.target}`] ?? 0, effect.operation, numeric(effect.value, context)); break;
      case "modifyArmorClass": context.values.armorClass = mutate(context.values.armorClass ?? 0, effect.operation, numeric(effect.value, context)); break;
      case "modifyInitiative": context.values.initiative = mutate(context.values.initiative ?? 0, effect.operation, numeric(effect.value, context)); break;
      case "modifySpeed": context.values.speed = mutate(context.values.speed ?? 0, effect.operation, numeric(effect.value, context)); break;
      case "modifyCriticalRange": context.values.criticalRange = mutate(context.values.criticalRange ?? 20, effect.operation, numeric(effect.value, context)); break;
      case "modifyAttack": result.attackModifiers.push({ effectId: effect.id, selector: { ...effect.selector }, operation: effect.operation, value: numeric(effect.value, context) }); break;
      case "modifyDamage": result.damageModifiers.push({ effectId: effect.id, selector: { ...effect.selector }, operation: effect.operation, value: numeric(effect.value, context) }); break;
      case "addSpell": result.spells.add(effect.spellId); if (effect.alwaysPrepared) result.alwaysPreparedSpells.add(effect.spellId); break;
      case "addSpellList": result.spellLists.add(effect.spellListId); break;
      case "addResource": result.resources.push(effect.resource.id); result.resourceDefinitions.set(effect.resource.id, effect.resource); break;
      case "addAttack": case "addAction": case "addBonusAction": case "addReaction": {
        const kind = ACTION_GRANT_KINDS[effect.type];
        if (!result.actionGrants.some(grant => grant.kind === kind && grant.definitionId === effect.definitionId))
          result.actionGrants.push({ kind, definitionId: effect.definitionId, effectId: effect.id });
        break;
      }
      case "setMinimum": context.values[effect.target] = Math.max(context.values[effect.target] ?? Number.NEGATIVE_INFINITY, numeric(effect.value, context)); break;
      case "setMaximum": context.values[effect.target] = Math.min(context.values[effect.target] ?? Number.POSITIVE_INFINITY, numeric(effect.value, context)); break;
      case "setCalculation": context.values[effect.target] = numeric(effect.value, context); break;
      case "addAdvantage": result.rollRules.advantages.add(effect.target); break;
      case "addDisadvantage": result.rollRules.disadvantages.add(effect.target); break;
      case "rechargeOnShortRest": result.resourceRecharge.set(effect.resourceId, "short-rest"); break;
      case "rechargeOnLongRest": result.resourceRecharge.set(effect.resourceId, "long-rest"); break;
      case "unlockAtLevel":
        if (effectLevel(effect, context) < effect.level) {
          result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: false, reason: "Level not met" });
          return;
        }
        applyOne(effect.effect, result, options);
        break;
      case "scaleAtLevel": {
        const level = effectLevel(effect, context);
        const selected = Object.entries(effect.levels).map(([key, value]) => [Number(key), value] as const).filter(([threshold]) => threshold <= level).sort((left, right) => right[0] - left[0])[0];
        if (!selected) {
          result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: false, reason: "Level not met" });
          return;
        }
        context.values[effect.target] = numeric(selected[1], context);
        break;
      }
      case "addWeaponMastery": result.optionGrants.weaponMasteries.add(effect.optionId); break;
      case "grantFightingStyle": result.optionGrants.fightingStyles.add(effect.optionId); break;
      case "grantManeuver": result.optionGrants.maneuvers.add(effect.optionId); break;
      case "grantInvocation": result.optionGrants.invocations.add(effect.optionId); break;
      case "grantMetamagic": result.optionGrants.metamagic.add(effect.optionId); break;
      case "addDice": result.rollRules.extraDice.push({ effectId: effect.id, target: effect.target, dice: { ...effect.dice } }); break;
      case "replaceDice": result.rollRules.replacements.push({ effectId: effect.id, target: effect.target, replacement: { ...effect.replacement }, ...(effect.match ? { match: { ...effect.match } } : {}) }); break;
      case "rerollDice": result.rollRules.rerolls.push({ effectId: effect.id, target: effect.target, rolls: [...effect.rolls], limit: effect.limit, keep: effect.keep }); break;
      case "setMinimumRoll": result.rollRules.minimums.push({ effectId: effect.id, target: effect.target, minimum: effect.minimum }); break;
      case "grantEquipmentBundle": result.equipmentBundleIds.add(effect.bundleId); break;
      case "manualAdjudication":
        result.issues.push(runtimeIssue(effect, "RULE_EFFECT_REVIEW_REQUIRED", "rules-warning"));
        result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: false, reason: "Review required" });
        return;
      default: assertNever(effect);
    }
    result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: true, reason: "Applied" });
  } catch {
    result.issues.push(runtimeIssue(effect, "RULE_EFFECT_FAILED", "error"));
    result.trace.push({ effectId: effect.id, type: effect.type, disposition: capability.disposition, applied: false, reason: "Evaluation error" });
  }
}

export function applyEffects(initial: RuleContext, effects: readonly Effect[], options: ApplyEffectsOptions = {}): RuleResult {
  const result = createResult(initial);
  for (const effect of [...effects].sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0) || left.id.localeCompare(right.id)))
    applyOne(effect, result, options);
  return result;
}
