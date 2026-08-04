/**
 * An original synthetic ruleset with real level 1–5 progression.
 *
 * The first slice stopped at level 2 with one class choice, which is not enough
 * to exercise creation at a target level or sequential level-up. This fixture
 * supplies the shapes those features actually depend on:
 *
 * - a class whose progression runs 1–5;
 * - a subclass granted at level 3, with its own level-3 choice;
 * - a species trait that carries its own choice;
 * - a background with an automatic skill grant, so a class list can offer
 *   something the build already holds;
 * - a background feat with a nested choice, reachable only once it is selected;
 * - equipment that is partly granted and partly chosen;
 * - level 2 with no choices at all;
 * - level 4 with two new choices at once.
 *
 * Every name here is invented. Nothing reproduces rulebook prose, and no ID
 * matches any private or official identifier.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry, RulesetProfile } from "@/src/domain/model";

const AT = "2026-08-04T08:00:00.000Z";
const VERSION = "1.0.0";

export const PROG_SOURCE_ID = "source:stonewake-synthetic";
export const PROG_PACK_ID = "pack:stonewake-synthetic";
export const PROG_RULESET_ID = "ruleset:stonewake-synthetic";

export const PROG_IDS = {
  class: "class:wayfinder",
  subclassA: "subclass:cairn-marker",
  subclassB: "subclass:river-reader",
  species: "species:stoneborn",
  speciesTrait: "trait:stoneborn-attunement",
  background: "background:road-warden",
  backgroundFeat: "feat:road-sense",
  feature1: "class-feature:wayfinder-survey",
  feature2: "class-feature:wayfinder-endurance",
  feature3: "class-feature:wayfinder-pathcraft",
  feature4: "class-feature:wayfinder-refinement",
  feature5: "class-feature:wayfinder-mastery",
  subclassFeature3: "class-feature:cairn-marker-sighting",
  subclassFeature5: "class-feature:cairn-marker-beacon",
  weapon: "weapon:walking-staff",
  armor: "armor:banded-coat",
  pack: "item:warden-bundle",
  rope: "item:climbing-line",
  lantern: "item:shuttered-lantern",
  equipmentBundle: "equipment-bundle:wayfinder-kit",
} as const;

export const PROG_CHOICES = {
  /** Level 1, on the class: two skills from a list the background overlaps. */
  classSkills: "choice:wayfinder-skills",
  /** Level 3, on the class: which subclass path. Identity is stored separately. */
  subclassPath: "choice:wayfinder-path",
  /** Level 4, on the class: a feat. */
  feat: "choice:wayfinder-feat",
  /** Level 4, on the class: a travel technique. Two choices at one level. */
  technique: "choice:wayfinder-technique",
  /** Level 3, on the subclass itself. */
  subclassMark: "choice:cairn-marker-mark",
  /** On the species trait, not the species. */
  speciesStone: "choice:stoneborn-stone",
  /** Nested inside the background feat's own option. */
  featNested: "choice:road-sense-focus",
  /** Equipment. */
  equipment: "equipment-choice:wayfinder-kit",
} as const;

export const PROG_PROFICIENCIES = {
  skillPathfinding: "proficiency:skill-pathfinding",
  skillMasonry: "proficiency:skill-masonry",
  skillWeatherlore: "proficiency:skill-weatherlore",
  skillHaggling: "proficiency:skill-haggling",
  /** The background grants this automatically; the class list also offers it. */
  skillWatchkeeping: "proficiency:skill-watchkeeping",
  saveStrength: "proficiency:save-strength",
  saveWisdom: "proficiency:save-wisdom",
} as const;

export const PROG_ARRAY = [15, 14, 13, 12, 10, 8] as const;
export const PROG_HIT_DIE = 10;
export const PROG_SUBCLASS_LEVEL = 3;
export const PROG_MAX_LEVEL = 5;

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: PROG_SOURCE_ID,
  sourceLocator: { sourceId: PROG_SOURCE_ID, page: "1", section: "Stonewake synthetic progression" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 30, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "stonewake-synthetic"],
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

const proficiency = (id: string, name: string, type: string, key: string) =>
  entry({ id, slug: id.split(":").pop() ?? id, name, category: "proficiency", mechanics: { type, key } });

const proficiencies = [
  proficiency(PROG_PROFICIENCIES.skillPathfinding, "Pathfinding", "skill", "pathfinding"),
  proficiency(PROG_PROFICIENCIES.skillMasonry, "Masonry", "skill", "masonry"),
  proficiency(PROG_PROFICIENCIES.skillWeatherlore, "Weatherlore", "skill", "weatherlore"),
  proficiency(PROG_PROFICIENCIES.skillHaggling, "Haggling", "skill", "haggling"),
  proficiency(PROG_PROFICIENCIES.skillWatchkeeping, "Watchkeeping", "skill", "watchkeeping"),
  proficiency(PROG_PROFICIENCIES.saveStrength, "Strength save", "save", "strength"),
  proficiency(PROG_PROFICIENCIES.saveWisdom, "Wisdom save", "save", "wisdom"),
];

/** A species trait that owns a choice, so trait choices must be discovered. */
const speciesTrait = entry({
  id: PROG_IDS.speciesTrait,
  slug: "stoneborn-attunement",
  name: "Stone Attunement",
  category: "rule",
  mechanics: { kind: "trait", data: {} },
  choices: [
    {
      id: PROG_CHOICES.speciesStone,
      label: "Attuned stone",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:stone-granite", label: "Granite" },
        { id: "option:stone-slate", label: "Slate" },
      ],
    },
  ],
});

const species = entry({
  id: PROG_IDS.species,
  slug: "stoneborn",
  name: "Stoneborn",
  category: "species",
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: [PROG_IDS.speciesTrait],
    lineageIds: [],
  },
});

/** A feat whose own option carries a nested choice. */
const backgroundFeat = entry({
  id: PROG_IDS.backgroundFeat,
  slug: "road-sense",
  name: "Road Sense",
  category: "feat",
  mechanics: { category: "origin", repeatable: false },
  choices: [
    {
      id: "choice:road-sense-approach",
      label: "Road Sense approach",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        {
          id: "option:road-sense-terrain",
          label: "Read the terrain",
          // The nested choice only becomes due once this option is selected.
          childChoices: [
            {
              id: PROG_CHOICES.featNested,
              label: "Terrain focus",
              min: 1,
              max: 1,
              repeatable: false,
              options: [
                { id: "option:focus-uplands", label: "Uplands" },
                { id: "option:focus-marsh", label: "Marsh" },
              ],
            },
          ],
        },
        { id: "option:road-sense-weather", label: "Read the weather" },
      ],
    },
  ],
});

const background = entry({
  id: PROG_IDS.background,
  slug: "road-warden",
  name: "Road Warden",
  category: "background",
  mechanics: {
    abilityScoreChoices: { abilities: ["strength", "constitution", "wisdom"], increasePattern: [2, 1] },
    featId: PROG_IDS.backgroundFeat,
    // Automatic grant that the class skill list also offers.
    proficiencyIds: [PROG_PROFICIENCIES.skillWatchkeeping],
    equipmentChoiceIds: [],
    equipmentBundleIds: [PROG_IDS.equipmentBundle],
  },
  equipmentBundles: [
    {
      id: PROG_IDS.equipmentBundle,
      label: "Wayfinder kit",
      entries: [
        // Granted outright, no decision to make.
        { type: "item", itemId: PROG_IDS.rope, quantity: 1, status: "carried" },
        {
          type: "choice",
          id: PROG_CHOICES.equipment,
          label: "Travelling gear",
          min: 1,
          max: 1,
          options: [
            { id: "equipment-option:lantern", label: "Shuttered lantern", entries: [{ type: "item", itemId: PROG_IDS.lantern, quantity: 1, status: "carried" }] },
            { id: "equipment-option:spare-line", label: "Spare climbing line", entries: [{ type: "item", itemId: PROG_IDS.rope, quantity: 1, status: "carried" }] },
          ],
        },
      ],
    },
  ],
});

const classFeature = (id: string, name: string, level: number) =>
  entry({
    id,
    slug: id.split(":").pop() ?? id,
    name,
    category: "class-feature",
    mechanics: { classId: PROG_IDS.class, level, featureType: "core" },
  });

/** The subclass feature that owns a level-3 choice. */
const subclassFeature3 = entry({
  id: PROG_IDS.subclassFeature3,
  slug: "cairn-marker-sighting",
  name: "Cairn Sighting",
  category: "class-feature",
  mechanics: { classId: PROG_IDS.class, level: 3, featureType: "subclass" },
});

const subclassA = entry({
  id: PROG_IDS.subclassA,
  slug: "cairn-marker",
  name: "Cairn Marker",
  category: "subclass",
  mechanics: {
    classId: PROG_IDS.class,
    progression: [
      { level: 3, featureIds: [PROG_IDS.subclassFeature3], choiceIds: [PROG_CHOICES.subclassMark] },
      { level: 5, featureIds: [PROG_IDS.subclassFeature5], choiceIds: [] },
    ],
  },
  choices: [
    {
      id: PROG_CHOICES.subclassMark,
      label: "Marking style",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:mark-stacked", label: "Stacked cairn" },
        { id: "option:mark-painted", label: "Painted blaze" },
      ],
    },
  ],
});

const subclassB = entry({
  id: PROG_IDS.subclassB,
  slug: "river-reader",
  name: "River Reader",
  category: "subclass",
  mechanics: {
    classId: PROG_IDS.class,
    progression: [{ level: 3, featureIds: [], choiceIds: [] }],
  },
});

const wayfinder = entry({
  id: PROG_IDS.class,
  slug: "wayfinder",
  name: "Wayfinder",
  category: "class",
  mechanics: {
    hitDie: PROG_HIT_DIE,
    primaryAbilities: ["wisdom"],
    savingThrows: [PROG_PROFICIENCIES.saveStrength, PROG_PROFICIENCIES.saveWisdom],
    startingProficiencyIds: [],
    progression: [
      { level: 1, proficiencyBonus: 2, featureIds: [PROG_IDS.feature1], choiceIds: [PROG_CHOICES.classSkills], resourceChanges: {} },
      // Level 2 deliberately grants a feature and no choice at all.
      { level: 2, proficiencyBonus: 2, featureIds: [PROG_IDS.feature2], choiceIds: [], resourceChanges: {} },
      { level: 3, proficiencyBonus: 2, featureIds: [PROG_IDS.feature3], choiceIds: [PROG_CHOICES.subclassPath], resourceChanges: {} },
      // Level 4 deliberately opens two choices at once.
      {
        level: 4,
        proficiencyBonus: 2,
        featureIds: [PROG_IDS.feature4],
        choiceIds: [PROG_CHOICES.feat, PROG_CHOICES.technique],
        resourceChanges: {},
      },
      { level: 5, proficiencyBonus: 3, featureIds: [PROG_IDS.feature5], choiceIds: [], resourceChanges: {} },
    ],
    subclassLevel: PROG_SUBCLASS_LEVEL,
    subclassIds: [PROG_IDS.subclassA, PROG_IDS.subclassB],
  },
  choices: [
    {
      id: PROG_CHOICES.classSkills,
      label: "Wayfinder skills",
      min: 2,
      max: 2,
      repeatable: false,
      options: [
        { id: "option:skill-pathfinding", label: "Pathfinding", entryId: PROG_PROFICIENCIES.skillPathfinding },
        { id: "option:skill-masonry", label: "Masonry", entryId: PROG_PROFICIENCIES.skillMasonry },
        { id: "option:skill-weatherlore", label: "Weatherlore", entryId: PROG_PROFICIENCIES.skillWeatherlore },
        // Already granted by the background: the list must say so.
        { id: "option:skill-watchkeeping", label: "Watchkeeping", entryId: PROG_PROFICIENCIES.skillWatchkeeping },
      ],
    },
    {
      id: PROG_CHOICES.subclassPath,
      label: "Wayfinder path",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:path-cairn", label: "Cairn Marker", entryId: PROG_IDS.subclassA },
        { id: "option:path-river", label: "River Reader", entryId: PROG_IDS.subclassB },
      ],
    },
    {
      id: PROG_CHOICES.feat,
      label: "Level 4 feat",
      min: 1,
      max: 1,
      repeatable: false,
      options: [{ id: "option:feat-road-sense", label: "Road Sense", entryId: PROG_IDS.backgroundFeat }],
    },
    {
      id: PROG_CHOICES.technique,
      label: "Travel technique",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:technique-forced-march", label: "Forced march" },
        { id: "option:technique-quiet-camp", label: "Quiet camp" },
      ],
    },
  ],
  effects: [
    {
      id: "effect:wayfinder-hit-point-base",
      type: "scaleAtLevel",
      scope: "class",
      classId: PROG_IDS.class,
      target: "hitPoints.classBase",
      levels: Object.fromEntries(
        [1, 2, 3, 4, 5].map(level => [level, { kind: "literal", value: PROG_HIT_DIE + (level - 1) * 6 }]),
      ),
    },
    { id: "effect:wayfinder-kit", type: "grantEquipmentBundle", bundleId: PROG_IDS.equipmentBundle, label: "Wayfinder kit" },
  ],
});

const items = [
  entry({ id: PROG_IDS.rope, slug: "climbing-line", name: "Climbing line", category: "item", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  entry({ id: PROG_IDS.lantern, slug: "shuttered-lantern", name: "Shuttered lantern", category: "item", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
];

const abilityMethodRule = entry({
  id: "rule:stonewake-ability-methods",
  slug: "stonewake-ability-methods",
  name: "Stonewake ability generation",
  category: "rule",
  mechanics: {
    kind: "ability-generation",
    data: { methods: [{ method: "standard-array", scores: [...PROG_ARRAY] }, { method: "manual" }] },
  },
});

export const PROG_ENTRIES: readonly ContentEntry[] = [
  ...proficiencies,
  speciesTrait,
  species,
  backgroundFeat,
  background,
  classFeature(PROG_IDS.feature1, "Survey", 1),
  classFeature(PROG_IDS.feature2, "Endurance", 2),
  classFeature(PROG_IDS.feature3, "Pathcraft", 3),
  classFeature(PROG_IDS.feature4, "Refinement", 4),
  classFeature(PROG_IDS.feature5, "Wayfinder Mastery", 5),
  subclassFeature3,
  classFeature(PROG_IDS.subclassFeature5, "Cairn Beacon", 5),
  subclassA,
  subclassB,
  wayfinder,
  ...items,
  abilityMethodRule,
];

export const PROG_RULESET: RulesetProfile = {
  id: PROG_RULESET_ID,
  name: "Stonewake synthetic progression",
  activeSourceIds: [PROG_SOURCE_ID],
  editionPriority: ["homebrew"],
  allowedCategories: [
    "class", "class-feature", "subclass", "species", "background", "feat",
    "proficiency", "item", "rule",
  ],
  allowLegacy: false,
  allowDuplicateVersions: false,
  conflictResolution: "source-priority",
  allowCustomOverrides: false,
  requirementEnforcement: "hard",
  createdAt: AT,
  updatedAt: AT,
};

/** A schema-valid pack document, so import paths can be exercised end to end. */
export function progressionPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: PROG_PACK_ID,
      name: "Stonewake synthetic progression",
      version: VERSION,
      coverage: "complete",
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
        id: PROG_SOURCE_ID,
        name: "Stonewake synthetic progression",
        edition: "homebrew",
        priority: 30,
        visibility: "public-original",
        licenseType: "original",
        enabledByDefault: true,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    entries: PROG_ENTRIES,
  });
}
