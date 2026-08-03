type JsonObject = Record<string, unknown>;
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, fallback: string) => typeof value === "string" && value.length > 0 ? value : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function defaultMechanics(category: string, entry: JsonObject): JsonObject {
  if (isObject(entry.mechanics)) return entry.mechanics;
  switch (category) {
    case "class": return { hitDie: 8, primaryAbilities: ["strength"], savingThrows: ["save:strength", "save:constitution"], progression: [{ level: 1, proficiencyBonus: 2, featureIds: [], resourceChanges: {} }], subclassLevel: 3, subclassIds: [] };
    case "class-feature": return { classId: text(entry.classId, "class:unresolved"), level: typeof entry.level === "number" ? entry.level : 1, featureType: "core" };
    case "subclass": return { classId: text(entry.classId, "class:unresolved"), progression: [{ level: 3, featureIds: [text(entry.id, "feature:unresolved")] }] };
    case "species": return { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] };
    case "race": return { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], legacyAbilityScores: {} };
    case "lineage": return { parentSpeciesIds: [], traitIds: [], replacesTraitIds: [] };
    case "background": return { abilityScoreChoices: { abilities: ["strength", "dexterity"], increasePattern: [1, 1] }, featId: "feat:unresolved", proficiencyIds: [], equipmentChoiceIds: [] };
    case "feat": return { category: text(entry.featType, "other"), repeatable: false };
    case "spell": return { level: typeof entry.level === "number" ? entry.level : 0, school: "evocation", components: { verbal: false, somatic: false, consumed: false }, castingTime: { amount: 1, unit: "action" }, duration: { type: "instantaneous", concentration: false }, range: { type: "self" }, scaling: [], spellListIds: ["spell-list:unresolved"] };
    case "item": return { itemType: "other", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] };
    case "weapon": return { category: "simple", usage: "melee", damage: { dice: "1d4", type: "bludgeoning" }, properties: [], weight: 0, costGp: 0 };
    case "armor": return { category: "light", baseArmorClass: 10, dexterity: "full", stealthDisadvantage: false, weight: 0, costGp: 0 };
    case "tool": return { toolType: "other", abilitySuggestions: [] };
    case "monster": return { size: "medium", creatureType: "unknown", armorClass: 10, hitPoints: { average: 1, formula: "1d1" }, speeds: {}, abilities: { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }, challengeRating: "0", proficiencyBonus: 2, actionIds: [], eligibility: { wildShape: false, familiar: false, summon: false, companion: false } };
    case "proficiency": return { type: "skill", key: text(entry.slug, "unresolved") };
    case "spell-list": return { spellIds: [], ownerIds: [] };
    default: return { kind: category, data: {} };
  }
}

export function migrateContentEntryToV2(item: JsonObject, sourcePriority = 0): JsonObject {
  const category = text(item.category, "rule"), sourceId = text(item.sourceId, "source:unresolved");
  return {
    ...item, category,
    sourceLocator: isObject(item.sourceLocator) ? item.sourceLocator : { sourceId, page: text(item.sourcePage, "unlocated"), section: typeof item.sourceSection === "string" ? item.sourceSection : undefined },
    reviewStatus: text(item.reviewStatus, "extracted"), links: Array.isArray(item.links) ? item.links : [],
    mechanics: defaultMechanics(category, item),
    conflict: isObject(item.conflict) ? item.conflict : { sourcePriority, resolution: "source-priority" },
    editionRelations: strings(item.editionRelations),
  };
}

export interface ContentPackMigrationResult { value: unknown; migratedFrom?: number }

export function migrateContentPackToV2(input: unknown): ContentPackMigrationResult {
  if (!isObject(input) || (input.schemaVersion !== 0 && input.schemaVersion !== 1)) return { value: input };
  if (!isObject(input.pack) || !Array.isArray(input.sources) || !Array.isArray(input.entries)) return { value: input };
  const sourcePriorities = new Map<string, number>();
  for (const item of input.sources) if (isObject(item) && typeof item.id === "string") sourcePriorities.set(item.id, typeof item.priority === "number" ? item.priority : 0);
  const entries = input.entries.map(item => isObject(item) ? migrateContentEntryToV2(item, sourcePriorities.get(text(item.sourceId, "source:unresolved")) ?? 0) : item);
  return {
    migratedFrom: typeof input.schemaVersion === "number" ? input.schemaVersion : 1,
    value: { ...input, schemaVersion: 2, pack: { ...input.pack, dependencies: strings(input.pack.dependencies), optionalDependencies: strings(input.pack.optionalDependencies) }, entries },
  };
}
