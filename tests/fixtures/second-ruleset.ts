/**
 * A second, deliberately different original synthetic ruleset.
 *
 * Its only job is to prove that the generic product layer contains no hidden
 * assumptions from the first slice. Everything it changes is something the
 * resolver or planner used to hard-code:
 *
 * - a d12 hit die instead of d8;
 * - different saving throws (Dexterity and Wisdom, not Strength and Constitution);
 * - a different skill set with different governing abilities;
 * - a different ability-generation array;
 * - a different equipment choice ID;
 * - a mastery attached to a different weapon.
 *
 * It also lives on its own source, so installing it must not disturb a character
 * built in the first ruleset.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry, RulesetProfile } from "@/src/domain/model";

const AT = "2026-08-03T08:00:00.000Z";
const VERSION = "1.0.0";

export const SECOND_SOURCE_ID = "source:tidewatch-synthetic";
export const SECOND_PACK_ID = "pack:tidewatch-synthetic";
export const SECOND_RULESET_ID = "ruleset:tidewatch-synthetic";

export const SECOND_IDS = {
  class: "class:tidewatcher",
  species: "species:duneborn",
  background: "background:signal-keeper",
  weapon: "weapon:harpoon",
  armor: "armor:scale-wrap",
  mastery: "mastery:tide-pull",
  attack: "action:harpoon-cast",
  resource: "resource:second-wind-tide",
  equipmentChoice: "equipment-choice:tidewatcher-kit",
  masteryChoice: "choice:tidewatcher-mastery",
  skillChoice: "choice:tidewatcher-skills",
} as const;

export const SECOND_HIT_DIE = 12;
export const SECOND_ARRAY = [16, 14, 13, 11, 10, 9] as const;

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: SECOND_SOURCE_ID,
  sourceLocator: { sourceId: SECOND_SOURCE_ID, page: "1", section: "Second synthetic slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 20, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "tidewatch-synthetic"],
  version: VERSION,
  revision: 1,
  editionRelations: [],
  legacy: false,
  optional: false,
  private: false,
  exportRestricted: false,
  createdAt: AT,
  updatedAt: AT,
  ...partial,
});

const proficiency = (id: string, slug: string, name: string, type: string, key: string, ability: string) =>
  entry({
    id,
    slug,
    name,
    category: "proficiency",
    mechanics: { type, key },
    tags: ["synthetic", "tidewatch-synthetic", `ability:${ability}`],
  });

export const SECOND_PROFICIENCIES = {
  saveDexterity: "proficiency:tw-save-dexterity",
  saveWisdom: "proficiency:tw-save-wisdom",
  skillTidereading: "proficiency:tw-skill-tidereading",
  skillRopework: "proficiency:tw-skill-ropework",
} as const;

const entries: ContentEntry[] = [
  entry({
    id: SECOND_IDS.class,
    slug: "tidewatcher",
    name: "Tidewatcher",
    category: "class",
    summary: "A harbour lookout trained to read water and hold a landing.",
    effects: [
      {
        id: "effect:tidewatcher-hit-point-base",
        type: "scaleAtLevel",
        scope: "class",
        classId: SECOND_IDS.class,
        target: "hitPoints.classBase",
        levels: { 1: { kind: "literal", value: 12 }, 2: { kind: "literal", value: 15 } },
      },
      { id: "effect:tidewatcher-kit", type: "grantEquipmentBundle", bundleId: "bundle:tidewatcher-kit" },
    ],
    equipmentBundles: [
      {
        id: "bundle:tidewatcher-kit",
        label: "Tidewatcher kit",
        entries: [
          { type: "item", itemId: SECOND_IDS.weapon, quantity: 1, status: "equipped" },
          { type: "item", itemId: SECOND_IDS.armor, quantity: 1, status: "equipped" },
          {
            type: "choice",
            id: SECOND_IDS.equipmentChoice,
            label: "Harbour gear",
            min: 1,
            max: 1,
            options: [
              { id: "equipment-option:tw-line", label: "Coiled line", entries: [{ type: "item", itemId: "item:tw-line", quantity: 1, status: "carried" }] },
              { id: "equipment-option:tw-glass", label: "Spotting glass", entries: [{ type: "item", itemId: "item:tw-glass", quantity: 1, status: "carried" }] },
            ],
          },
        ],
      },
    ],
    choices: [
      {
        id: SECOND_IDS.skillChoice,
        label: "Tidewatcher skills",
        min: 1,
        max: 1,
        repeatable: false,
        options: [
          {
            id: `option:${SECOND_PROFICIENCIES.skillTidereading}`,
            label: "Tidereading",
            effects: [{ id: "effect:tw-grant-tidereading", type: "grantProficiency", proficiencyId: SECOND_PROFICIENCIES.skillTidereading }],
          },
          {
            id: `option:${SECOND_PROFICIENCIES.skillRopework}`,
            label: "Ropework",
            effects: [{ id: "effect:tw-grant-ropework", type: "grantProficiency", proficiencyId: SECOND_PROFICIENCIES.skillRopework }],
          },
        ],
      },
      {
        id: SECOND_IDS.masteryChoice,
        label: "Tide mastery",
        min: 1,
        max: 1,
        repeatable: false,
        options: [{ id: "option:tide-pull", label: "Tide Pull", entryId: SECOND_IDS.mastery }],
      },
    ],
    mechanics: {
      hitDie: SECOND_HIT_DIE,
      primaryAbilities: ["dexterity"],
      // Deliberately different from the first ruleset's saves.
      savingThrows: [SECOND_PROFICIENCIES.saveDexterity, SECOND_PROFICIENCIES.saveWisdom],
      startingProficiencyIds: [],
      progression: [
        {
          level: 1,
          proficiencyBonus: 2,
          featureIds: ["feature:tidewatcher-hold"],
          choiceIds: [SECOND_IDS.skillChoice, SECOND_IDS.masteryChoice],
          resourceChanges: { [SECOND_IDS.resource]: 2 },
        },
        {
          level: 2,
          proficiencyBonus: 2,
          featureIds: [],
          choiceIds: [],
          resourceChanges: { [SECOND_IDS.resource]: 3 },
        },
      ],
      subclassLevel: 3,
      subclassIds: [],
    },
  }),
  entry({
    id: "feature:tidewatcher-hold",
    slug: "tidewatcher-hold",
    name: "Hold the Landing",
    category: "class-feature",
    summary: "Steady yourself against the pull of the water.",
    mechanics: { classId: SECOND_IDS.class, level: 1, featureType: "resource" },
    effects: [
      {
        id: "effect:tw-resource",
        type: "addResource",
        resource: {
          id: SECOND_IDS.resource,
          name: "Tide Wind",
          maximum: { kind: "path", path: `resource.${SECOND_IDS.resource}` },
          recharge: "long-rest",
        },
      },
      { id: "effect:tw-attack", type: "addAttack", definitionId: SECOND_IDS.attack },
    ],
  }),
  entry({
    id: SECOND_IDS.species,
    slug: "duneborn",
    name: "Duneborn",
    category: "species",
    summary: "Raised where the sand meets the tideline.",
    mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 25, traitIds: [], lineageIds: [] },
  }),
  entry({
    id: SECOND_IDS.background,
    slug: "signal-keeper",
    name: "Signal Keeper",
    category: "background",
    summary: "You kept the harbour lights answering.",
    mechanics: {
      abilityScoreChoices: { abilities: ["dexterity", "wisdom"], increasePattern: [2, 1] },
      featId: "feat:tw-vigil",
      proficiencyIds: [],
      equipmentChoiceIds: [],
      equipmentBundleIds: [],
    },
  }),
  entry({
    id: "feat:tw-vigil",
    slug: "tw-vigil",
    name: "Keeper's Vigil",
    category: "feat",
    summary: "You wake when the light gutters.",
    mechanics: { category: "origin", repeatable: false },
  }),
  entry({
    id: SECOND_IDS.mastery,
    slug: "tide-pull",
    name: "Tide Pull",
    category: "weapon-mastery",
    summary: "A drag on the line that pulls your target off balance.",
    // Attached to this ruleset's own weapon.
    mechanics: { kind: "weapon-mastery", data: { appliesToWeaponId: SECOND_IDS.weapon } },
    effects: [{ id: "effect:tw-mastery-grant", type: "addWeaponMastery", optionId: SECOND_IDS.mastery }],
  }),
  entry({
    id: SECOND_IDS.attack,
    slug: "harpoon-cast",
    name: "Harpoon Cast",
    category: "rule",
    summary: "A thrown harpoon on a line.",
    mechanics: {
      kind: "action-definition",
      data: {
        actionKind: "attack",
        usage: "melee",
        ability: "dexterity",
        proficient: true,
        weaponId: SECOND_IDS.weapon,
        damageDice: "1d10",
        damageType: "piercing",
        range: "20 ft.",
      },
    },
  }),
  entry({
    id: SECOND_IDS.weapon,
    slug: "harpoon",
    name: "Harpoon",
    category: "weapon",
    summary: "A barbed shaft on a coiled line.",
    mechanics: {
      category: "martial",
      usage: "melee",
      damage: { dice: "1d10", type: "piercing" },
      properties: ["thrown"],
      masteryId: SECOND_IDS.mastery,
      weight: 6,
      costGp: 20,
    },
  }),
  entry({
    id: SECOND_IDS.armor,
    slug: "scale-wrap",
    name: "Scale Wrap",
    category: "armor",
    summary: "Overlapping scale sewn onto oiled cloth.",
    mechanics: { category: "light", baseArmorClass: 12, dexterity: "full", stealthDisadvantage: false, weight: 10, costGp: 30 },
  }),
  entry({ id: "item:tw-line", slug: "tw-line", name: "Coiled line", category: "item", summary: "Fifty feet of waxed line.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  entry({ id: "item:tw-glass", slug: "tw-glass", name: "Spotting glass", category: "item", summary: "A brass spotting glass.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  proficiency(SECOND_PROFICIENCIES.saveDexterity, "tw-save-dexterity", "Dexterity save", "save", "dexterity", "dexterity"),
  proficiency(SECOND_PROFICIENCIES.saveWisdom, "tw-save-wisdom", "Wisdom save", "save", "wisdom", "wisdom"),
  proficiency(SECOND_PROFICIENCIES.skillTidereading, "tw-skill-tidereading", "Tidereading", "skill", "tidereading", "wisdom"),
  proficiency(SECOND_PROFICIENCIES.skillRopework, "tw-skill-ropework", "Ropework", "skill", "ropework", "dexterity"),
  entry({
    id: "rule:tw-ability-generation",
    slug: "tw-ability-generation",
    name: "Tidewatch array",
    category: "rule",
    summary: "This ruleset offers its own fixed spread.",
    mechanics: { kind: "ability-generation", data: { method: "standard-array", scores: [...SECOND_ARRAY], label: "Tidewatch array" } },
  }),
];

export const SECOND_RULESET: RulesetProfile = {
  id: SECOND_RULESET_ID,
  name: "Tidewatch synthetic",
  activeSourceIds: [SECOND_SOURCE_ID],
  editionPriority: ["homebrew"],
  allowedCategories: [
    "class", "class-feature", "species", "background", "feat", "item", "weapon", "armor",
    "weapon-mastery", "condition", "resource", "rule", "proficiency",
  ],
  allowLegacy: false,
  allowDuplicateVersions: false,
  conflictResolution: "source-priority",
  allowCustomOverrides: true,
  requirementEnforcement: "soft",
  createdAt: AT,
  updatedAt: AT,
};

export function secondSyntheticPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: SECOND_PACK_ID,
      name: "Tidewatch synthetic slice",
      description: "A second original synthetic ruleset used to prove the product layer is generic.",
      version: VERSION,
      coverage: "partial",
      rulesEditions: ["homebrew"],
      visibility: "public",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: false,
      dependencies: [],
      optionalDependencies: [],
    },
    sources: [
      {
        id: SECOND_SOURCE_ID,
        name: "Tidewatch synthetic reference",
        abbreviation: "TSR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 20,
        enabledByDefault: true,
        campaignIds: [],
        version: VERSION,
      },
    ],
    entries,
  });
}
