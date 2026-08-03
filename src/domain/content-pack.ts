import { z } from "zod";
import type {
  ChoiceDefinition,
  Condition,
  EquipmentBundleDefinition,
  EquipmentBundleNode,
  Effect,
  PackCoverage,
  PrerequisiteDefinition,
  Value,
} from "@/src/domain/model";

const id = z.string().min(1).max(160);
const edition = z.enum(["2014", "2024", "mixed", "homebrew"]);
const coverage = z.enum(["pilot", "partial", "complete"]);
export function packCoverageMatchesIdentity(id: string, name: string, value: PackCoverage): boolean {
  const identity = `${id} ${name}`;
  if (/\bpilot\b/i.test(identity)) return value === "pilot";
  if (/\b(?:partial|incomplete)\b/i.test(identity)) return value !== "complete";
  return true;
}
const license = z.enum([
  "CC-BY-4.0", "official-free", "original", "private-reference",
  "private-owned-source", "unknown", "export-restricted", "do-not-distribute",
]);
const value: z.ZodType<Value> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("literal"), value: z.union([z.number(), z.string(), z.boolean()]) }).strict(),
  z.object({ kind: z.literal("path"), path: z.string().min(1).max(160) }).strict(),
  z.object({ kind: z.literal("formula"), formula: z.enum(["proficiencyBonus", "abilityModifier"]), variables: z.array(z.string().max(160)).max(20) }).strict(),
]);
const comparison = z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]);
const condition: z.ZodType<Condition> = z.lazy(() => z.union([
  z.object({ all: z.array(condition).min(1).max(50) }).strict(),
  z.object({ any: z.array(condition).min(1).max(50) }).strict(),
  z.object({ not: condition }).strict(),
  z.object({ type: z.literal("always") }).strict(),
  z.object({ type: z.literal("wearingArmor"), armorType: z.enum(["light", "medium", "heavy", "shield"]).optional() }).strict(),
  z.object({ type: z.literal("hasFeature"), featureId: id }).strict(),
  z.object({ type: z.literal("hasTag"), tag: z.string().min(1).max(160) }).strict(),
  z.object({ type: z.literal("classLevel"), classId: id, operator: comparison, value: z.number().int().min(0).max(20) }).strict(),
  z.object({ type: z.literal("totalLevel"), operator: comparison, value: z.number().int().min(0).max(30) }).strict(),
  z.object({ type: z.literal("ability"), ability: z.enum(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]), operator: comparison, value: z.number().int() }).strict(),
  z.object({ type: z.literal("proficientWith"), proficiencyId: id }).strict(),
  z.object({ type: z.literal("customFlag"), key: z.string().min(1).max(160), equals: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
]));
const operation = z.enum(["add", "subtract", "multiply", "set", "min", "max"]);
const effectBase = { id, sourceEntryId: id.optional(), label: z.string().max(240).optional(), priority: z.number().int().optional(), condition: condition.optional() };
const resource = z.object({ id, name: z.string().min(1).max(240), maximum: value, recharge: z.enum(["short-rest", "long-rest", "dawn", "manual", "none"]), sharedPoolId: id.optional() }).strict();
const ability = z.enum(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]);
const target = z.string().min(1).max(160), selector = z.record(z.string().max(160)).refine(v => Object.keys(v).length <= 20);
const dice = z.object({ count: z.number().int().min(1).max(100), faces: z.number().int().min(2).max(1000), modifier: z.number().int().min(-1000).max(1000).optional() }).strict();
const variant = <T extends Effect["type"], S extends z.ZodRawShape>(type: T, shape: S) => z.object({ ...effectBase, type: z.literal(type), ...shape }).strict();
const effect: z.ZodType<Effect> = z.lazy(() => z.union([
  variant("grantProficiency", { proficiencyId: id }), variant("grantExpertise", { proficiencyId: id }),
  variant("grantFeature", { featureId: id }), variant("disableFeature", { featureId: id }), variant("replaceFeature", { featureId: id, replacementId: id }), variant("grantChoice", { choiceId: id }),
  variant("modifyAbility", { ability, operation, value }), variant("modifyAbilityMaximum", { ability, operation, value }),
  variant("modifySkill", { target, operation, value }), variant("modifySavingThrow", { target, operation, value }),
  variant("modifyArmorClass", { operation, value }), variant("modifyInitiative", { operation, value }), variant("modifySpeed", { operation, value }), variant("modifyCriticalRange", { operation, value }),
  variant("modifyAttack", { selector, operation, value }), variant("modifyDamage", { selector, operation, value }),
  variant("addSpell", { spellId: id, alwaysPrepared: z.boolean().optional() }), variant("addSpellList", { spellListId: id }), variant("addResource", { resource }),
  variant("addAttack", { definitionId: id }), variant("addAction", { definitionId: id }), variant("addBonusAction", { definitionId: id }), variant("addReaction", { definitionId: id }),
  variant("setMinimum", { target, value }), variant("setMaximum", { target, value }), variant("setCalculation", { target, value }),
  variant("addAdvantage", { target }), variant("addDisadvantage", { target }), variant("rechargeOnShortRest", { resourceId: id }), variant("rechargeOnLongRest", { resourceId: id }),
  variant("unlockAtLevel", { level: z.number().int().min(1).max(30), scope: z.enum(["total", "class"]).optional(), classId: id.optional(), effect }), variant("scaleAtLevel", { levels: z.record(value).refine(v => Object.keys(v).every(k => /^(?:[1-9]|[12][0-9]|30)$/.test(k))), target, scope: z.enum(["total", "class"]).optional(), classId: id.optional() }),
  variant("addWeaponMastery", { optionId: id }), variant("grantFightingStyle", { optionId: id }), variant("grantManeuver", { optionId: id }), variant("grantInvocation", { optionId: id }), variant("grantMetamagic", { optionId: id }),
  variant("addDice", { target, dice }), variant("replaceDice", { target, replacement: dice, match: dice.optional() }),
  variant("rerollDice", { target, rolls: z.array(z.number().int().min(1).max(1000)).min(1).max(100), limit: z.number().int().min(1).max(100), keep: z.enum(["new", "higher", "lower"]) }),
  variant("setMinimumRoll", { target, minimum: z.number().int().min(0).max(1000) }),
  variant("grantEquipmentBundle", { bundleId: id }),
  variant("manualAdjudication", { reasonCode: z.string().regex(/^[A-Z0-9_:-]+$/).max(160), target: target.optional() }),
]));
const prerequisite: z.ZodType<PrerequisiteDefinition> = z.object({ id, label: z.string().min(1).max(240), condition, enforcement: z.enum(["hard", "soft", "informational"]) }).strict();
const choice: z.ZodType<ChoiceDefinition> = z.lazy(() => z.object({
  id, label: z.string().min(1).max(240), min: z.number().int().min(0), max: z.number().int().min(0), repeatable: z.boolean(), maxRepeats: z.number().int().positive().optional(),
  options: z.array(z.object({ id, label: z.string().min(1).max(240), entryId: id.optional(), effects: z.array(effect).max(100).optional(), childChoices: z.array(choice).max(50).optional() }).strict()).max(500),
  childChoices: z.array(choice).max(50).optional(),
}).strict().refine(v => v.max >= v.min, "Choice maximum must not be less than minimum"));
const equipmentNode: z.ZodType<EquipmentBundleNode> = z.lazy(() => z.union([
  z.object({ type: z.literal("item"), itemId: id, quantity: z.number().int().positive().max(100000), status: z.enum(["granted", "carried", "equipped"]), alternativeItemIds: z.array(id).max(100).optional() }).strict(),
  z.object({ type: z.literal("bundle"), id, label: z.string().max(240).optional(), entries: z.array(equipmentNode).min(1).max(200) }).strict(),
  z.object({ type: z.literal("choice"), id, label: z.string().min(1).max(240), min: z.number().int().min(0), max: z.number().int().min(0), options: z.array(z.object({ id, label: z.string().min(1).max(240), entries: z.array(equipmentNode).min(1).max(200) }).strict()).min(1).max(100) }).strict().refine(node => node.max >= node.min && node.max <= node.options.length, "Equipment choice bounds are invalid"),
]));
const equipmentBundle: z.ZodType<EquipmentBundleDefinition> = z.object({
  id, label: z.string().min(1).max(240), entries: z.array(equipmentNode).min(1).max(200),
  currencyAlternative: z.object({ amount: z.number().nonnegative(), currency: z.enum(["cp", "sp", "ep", "gp", "pp"]) }).strict().optional(),
}).strict();

const source = z.object({
  id, name: z.string().min(1).max(240), abbreviation: z.string().min(1).max(32), edition,
  publicationDate: z.string().optional(), type: z.enum(["core", "supplement", "adventure", "free-rules", "srd", "homebrew", "campaign"]),
  licenseType: license, visibility: z.enum(["public", "private", "reference-only"]), priority: z.number().int(), enabledByDefault: z.boolean(), campaignIds: z.array(id).default([]), version: z.string().min(1),
  replacementOf: id.optional(), replacedBy: id.optional(), pageFormat: z.string().max(100).optional(), notes: z.string().max(50000).optional(), localFileReference: z.string().max(500).optional(),
}).strict();
const locator = z.object({ sourceId: id, page: z.string().min(1).max(40), section: z.string().max(240).optional(), printPage: z.string().max(40).optional(), localFileKey: z.string().max(160).optional() }).strict();
const link = z.object({ type: z.enum(["feature", "subclass", "feat", "proficiency", "equipment", "spell", "spell-list", "choice", "effect", "attack", "resource", "mastery", "summon", "wild-shape", "familiar", "companion", "edition-equivalent", "replacement"]), targetId: id, required: z.boolean(), level: z.number().int().min(1).max(30).optional() }).strict();
const common = z.object({
  id, slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().min(1).max(240), aliases: z.array(z.string().max(240)).max(100).default([]),
  rulesEdition: edition, sourceId: id, sourceBook: z.string().max(240).optional(), sourcePage: z.string().max(40).optional(), sourceSection: z.string().max(240).optional(), sourceLocator: locator,
  reviewStatus: z.enum(["extracted", "text-reviewed", "mechanics-reviewed", "engine-verified"]), licenseType: license,
  visibility: z.enum(["public-srd", "public-free-rules", "public-original", "private-user-entered", "private-full-text", "private-summary", "local-reference-only", "unavailable-reference-only"]),
  fullText: z.string().max(500000).optional(), summary: z.string().max(20000).optional(), prerequisites: z.array(prerequisite).max(100).default([]), choices: z.array(choice).max(100).default([]), equipmentBundles: z.array(equipmentBundle).max(100).default([]), effects: z.array(effect).max(500).default([]), links: z.array(link).max(1000).default([]),
  conflict: z.object({ sourcePriority: z.number().int(), conflictKey: z.string().max(160).optional(), resolution: z.enum(["source-priority", "newest-revision", "explicit-selection", "coexist"]) }).strict(),
  tags: z.array(z.string().max(160)).max(200).default([]), version: z.string().min(1), revision: z.number().int().min(1), errataVersion: z.string().max(80).optional(), replacementOf: id.optional(), replacedBy: id.optional(), editionRelations: z.array(id).max(100).default([]), legacy: z.boolean(), optional: z.boolean(), private: z.boolean(), exportRestricted: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict();
const progression = z.array(z.object({ level: z.number().int().min(1).max(20), proficiencyBonus: z.number().int().min(2).max(10), featureIds: z.array(id), choiceIds: z.array(id).default([]), resourceChanges: z.record(z.number().int()).default({}) }).strict()).min(1).max(20);
const multiclass = z.object({
  prerequisites: z.array(prerequisite).max(20).default([]),
  grantedProficiencyIds: z.array(id).max(100).default([]),
  spellSlotProgression: z.enum(["none", "full", "half", "third", "pact"]),
  spellSlotRounding: z.enum(["down", "up"]).default("down"),
  unsupportedWithClassIds: z.array(id).max(100).default([]),
}).strict();
const mechanicsByCategory = {
  class: z.object({ hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]), primaryAbilities: z.array(ability).min(1), savingThrows: z.array(id).length(2), startingProficiencyIds: z.array(id).default([]), progression, subclassLevel: z.number().int().min(1).max(20), subclassIds: z.array(id), multiclass: multiclass.optional() }).strict(),
  "class-feature": z.object({ classId: id, level: z.number().int().min(1).max(20), featureType: z.enum(["core", "optional", "subclass", "improvement", "resource"]) }).strict(),
  subclass: z.object({ classId: id, progression: z.array(z.object({ level: z.number().int().min(1).max(20), featureIds: z.array(id).min(1), choiceIds: z.array(id).default([]) }).strict()).min(1) }).strict(),
  species: z.object({ creatureType: z.string().min(1), sizeChoices: z.array(z.string()).min(1), speed: z.number().positive(), traitIds: z.array(id), lineageIds: z.array(id).default([]) }).strict(),
  race: z.object({ creatureType: z.string().min(1), sizeChoices: z.array(z.string()).min(1), speed: z.number().positive(), traitIds: z.array(id), legacyAbilityScores: z.record(z.number().int()).default({}) }).strict(),
  lineage: z.object({ parentSpeciesIds: z.array(id), traitIds: z.array(id), replacesTraitIds: z.array(id).default([]) }).strict(),
  background: z.object({ abilityScoreChoices: z.object({ abilities: z.array(z.string()).min(2), increasePattern: z.array(z.number().int()).min(1) }).strict(), featId: id, proficiencyIds: z.array(id), equipmentChoiceIds: z.array(id), equipmentBundleIds: z.array(id).default([]) }).strict(),
  feat: z.object({ category: z.enum(["origin", "general", "epic-boon", "fighting-style", "other"]), repeatable: z.boolean() }).strict(),
  spell: z.object({ level: z.number().int().min(0).max(9), school: z.enum(["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"]), components: z.object({ verbal: z.boolean(), somatic: z.boolean(), material: z.string().max(1000).optional(), consumed: z.boolean().default(false), costGp: z.number().nonnegative().optional() }).strict(), castingTime: z.object({ amount: z.number().positive(), unit: z.enum(["action", "bonus-action", "reaction", "minute", "hour"]), trigger: z.string().max(500).optional() }).strict(), duration: z.object({ type: z.enum(["instantaneous", "timed", "until-dispelled", "special"]), amount: z.number().positive().optional(), unit: z.enum(["round", "minute", "hour", "day"]).optional(), concentration: z.boolean() }).strict(), range: z.object({ type: z.enum(["self", "touch", "distance", "sight", "unlimited", "special"]), distance: z.number().nonnegative().optional(), unit: z.enum(["feet", "miles"]).optional() }).strict(), scaling: z.array(z.object({ level: z.number().int().min(1).max(9), effectIds: z.array(id) }).strict()).default([]), spellListIds: z.array(id).min(1) }).strict(),
  item: z.object({ itemType: z.string().min(1), rarity: z.enum(["common", "uncommon", "rare", "very-rare", "legendary", "artifact", "varies", "none"]), attunement: z.object({ required: z.boolean(), prerequisite: z.string().max(500).optional() }).strict(), weight: z.number().nonnegative().optional(), cost: z.object({ amount: z.number().nonnegative(), currency: z.enum(["cp", "sp", "ep", "gp", "pp"]) }).optional(), attackIds: z.array(id).default([]), resourceIds: z.array(id).default([]) }).strict(),
  weapon: z.object({ category: z.enum(["simple", "martial"]), usage: z.enum(["melee", "ranged"]), damage: z.object({ dice: z.string().regex(/^\d+d\d+(?:[+-]\d+)?$/), type: z.string().min(1) }).strict(), properties: z.array(z.string()), masteryId: id.optional(), range: z.object({ normal: z.number().positive(), long: z.number().positive() }).optional(), weight: z.number().nonnegative(), costGp: z.number().nonnegative() }).strict(),
  armor: z.object({ category: z.enum(["light", "medium", "heavy", "shield"]), baseArmorClass: z.number().int(), dexterity: z.enum(["none", "full", "max-2"]), strengthRequirement: z.number().int().optional(), stealthDisadvantage: z.boolean(), weight: z.number().nonnegative(), costGp: z.number().nonnegative() }).strict(),
  tool: z.object({ toolType: z.string().min(1), abilitySuggestions: z.array(z.string()), weight: z.number().nonnegative().optional(), costGp: z.number().nonnegative().optional() }).strict(),
  monster: z.object({ size: z.string().min(1), creatureType: z.string().min(1), armorClass: z.number().int().positive(), hitPoints: z.object({ average: z.number().int().positive(), formula: z.string().min(1) }).strict(), speeds: z.record(z.number().nonnegative()), abilities: z.record(z.number().int().min(1).max(30)), challengeRating: z.string().min(1), proficiencyBonus: z.number().int(), actionIds: z.array(id), eligibility: z.object({ wildShape: z.boolean(), familiar: z.boolean(), summon: z.boolean(), companion: z.boolean() }).strict() }).strict(),
  proficiency: z.object({ type: z.enum(["skill", "save", "armor", "weapon", "tool", "language"]), key: z.string().min(1) }).strict(),
  "spell-list": z.object({ spellIds: z.array(id), ownerIds: z.array(id) }).strict(),
} as const;
export const classMechanicsSchema = mechanicsByCategory.class;
export const subclassMechanicsSchema = mechanicsByCategory.subclass;
export const speciesMechanicsSchema = mechanicsByCategory.species;
export const raceMechanicsSchema = mechanicsByCategory.race;
export const lineageMechanicsSchema = mechanicsByCategory.lineage;
export const backgroundMechanicsSchema = mechanicsByCategory.background;
const categorized = <C extends string, M extends z.ZodTypeAny>(category: C, mechanics: M) => common.extend({ category: z.literal(category), mechanics });
const generic = z.object({ kind: z.string().min(1), data: z.record(z.unknown()).default({}) }).strict();
export const contentEntrySchema = z.discriminatedUnion("category", [
  categorized("class", mechanicsByCategory.class), categorized("class-feature", mechanicsByCategory["class-feature"]), categorized("subclass", mechanicsByCategory.subclass),
  categorized("species", mechanicsByCategory.species), categorized("race", mechanicsByCategory.race), categorized("lineage", mechanicsByCategory.lineage), categorized("background", mechanicsByCategory.background), categorized("feat", mechanicsByCategory.feat), categorized("spell", mechanicsByCategory.spell),
  categorized("item", mechanicsByCategory.item), categorized("weapon", mechanicsByCategory.weapon), categorized("armor", mechanicsByCategory.armor), categorized("tool", mechanicsByCategory.tool), categorized("monster", mechanicsByCategory.monster), categorized("proficiency", mechanicsByCategory.proficiency), categorized("spell-list", mechanicsByCategory["spell-list"]),
  categorized("fighting-style", generic), categorized("weapon-mastery", generic), categorized("maneuver", generic), categorized("invocation", generic), categorized("metamagic", generic), categorized("infusion", generic), categorized("pact-boon", generic), categorized("condition", generic), categorized("resource", generic), categorized("rule", generic),
]);
const packSchema = z.object({
  id, name: z.string().min(1).max(240), description: z.string().max(20000).optional(), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/),
  coverage: coverage.default("complete"), rulesEditions: z.array(edition).min(1), visibility: z.enum(["public", "private"]), licenseType: license,
  exportRestricted: z.boolean(), includeFullText: z.boolean(), dependencies: z.array(id).default([]), optionalDependencies: z.array(id).default([]),
}).strict().superRefine((pack, context) => {
  if (!packCoverageMatchesIdentity(pack.id, pack.name, pack.coverage)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["coverage"], message: "Pack identity and coverage are inconsistent" });
});
export const contentPackSchema = z.object({
  schemaVersion: z.literal(2),
  pack: packSchema,
  sources: z.array(source).max(500), entries: z.array(contentEntrySchema).max(25000),
}).strict();
export type ContentPackDocument = z.infer<typeof contentPackSchema>;
export { effect as effectSchema, condition as conditionSchema, choice as choiceSchema, equipmentBundle as equipmentBundleSchema };
