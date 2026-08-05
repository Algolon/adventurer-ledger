/**
 * The accepted M2.1 synthetic content set.
 *
 * Every name, summary and number here is original test material written for this
 * repository. It exists to prove one vertical slice, not to model any published
 * game: `docs/product/M2_DECISIONS.md` fixes the vocabulary and bounds it to
 * levels 1 and 2. Progression is level-keyed by stable ID so the same structure
 * extends to level 20 later without changing a committed character.
 *
 * Brammel's reference numbers, which the level-up preview must reproduce:
 *
 *   Abilities   standard array 15/14/13/12/10/8 with the Caravan Warden +2/+1
 *               becomes STR 16, DEX 15, CON 14, INT 12, WIS 10, CHA 8
 *   Hit points  level 1: class base 8 + Constitution +2 = 10
 *               level 2: class base 10 + Constitution +2 twice = 14  (+4 maximum)
 *               The Constitution modifier applies once per character level; the
 *               class base is the cumulative class contribution for that level.
 *   Resource    Rallying Breath 3 uses at level 1, 4 at level 2 (+1 maximum)
 *   Armour      Travel Mail 14 + Dexterity 2 (capped) + Round Guard 2 = 18
 *   Attack      Longblade Strike +5 to hit, 1d8+4 damage
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry, Effect, RulesetProfile } from "@/src/domain/model";

const AT = "2026-08-03T08:00:00.000Z";
const VERSION = "1.0.0";

export const SYNTHETIC_SOURCE_ID = "source:runefolio-synthetic";
export const SYNTHETIC_PACK_ID = "pack:runefolio-2024-synthetic";
export const SYNTHETIC_RULESET_ID = "ruleset:runefolio-2024-synthetic";

export const SYNTHETIC_IDS = {
  class: "class:vanguard",
  species: "species:riverborn",
  background: "background:caravan-warden",
  style: "style:guarded-hand",
  heavyStyle: "style:reavers-grip",
  mastery: "mastery:measured-cut",
  weapon: "weapon:longblade",
  shield: "armor:round-guard",
  armor: "armor:travel-mail",
  attack: "action:longblade-strike",
  resource: "resource:rallying-breath",
} as const;

/** Choice groups the builder resolves. Stable IDs outlive label refinement. */
export const SYNTHETIC_CHOICES = {
  fightingStyle: "choice:vanguard-stance",
  weaponMastery: "choice:vanguard-mastery",
  classSkills: "choice:vanguard-skills",
  backgroundLanguage: "choice:warden-languages",
} as const;

export const SYNTHETIC_EQUIPMENT_BUNDLE = "bundle:vanguard-field-kit";
export const SYNTHETIC_EQUIPMENT_CHOICE = "equipment-choice:vanguard-pack";

/** Standard array offered by the synthetic ruleset, highest first. */
export const STANDARD_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Per-level class hit-point base, level-keyed so later levels only add rows. */
export const VANGUARD_HIT_POINT_BASE: Readonly<Record<number, number>> = { 1: 8, 2: 10 };
/** Per-level Rallying Breath maximum. */
export const VANGUARD_RALLYING_BREATH: Readonly<Record<number, number>> = { 1: 3, 2: 4 };
export const VANGUARD_HIT_DIE = 8;

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: SYNTHETIC_SOURCE_ID,
  sourceLocator: { sourceId: SYNTHETIC_SOURCE_ID, page: "1", section: "Synthetic slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 10, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "runefolio-2024-synthetic"],
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

/**
 * `ability:<name>` is the declarative convention the resolver reads to associate
 * a save or skill with the ability it is rolled with. It uses the existing
 * `tags` field, so no shared schema changes for it.
 */
const proficiency = (id: string, slug: string, name: string, type: string, key: string, ability?: string) =>
  entry({
    id,
    slug,
    name,
    category: "proficiency",
    mechanics: { type, key },
    ...(ability ? { tags: ["synthetic", "runefolio-2024-synthetic", `ability:${ability}`] } : {}),
  });

export const PROFICIENCY_IDS = {
  saveStrength: "proficiency:save-strength",
  saveConstitution: "proficiency:save-constitution",
  skillWatchcraft: "proficiency:skill-watchcraft",
  skillHaulage: "proficiency:skill-haulage",
  skillRiverlore: "proficiency:skill-riverlore",
  skillParley: "proficiency:skill-parley",
  armorMedium: "proficiency:armor-medium",
  armorShield: "proficiency:armor-shield",
  weaponMartial: "proficiency:weapon-martial",
  languageTradeCant: "proficiency:language-trade-cant",
  languageRiverSigns: "proficiency:language-river-signs",
} as const;

const proficiencyEntries: ContentEntry[] = [
  proficiency(PROFICIENCY_IDS.saveStrength, "save-strength", "Strength save", "save", "strength", "strength"),
  proficiency(PROFICIENCY_IDS.saveConstitution, "save-constitution", "Constitution save", "save", "constitution", "constitution"),
  proficiency(PROFICIENCY_IDS.skillWatchcraft, "skill-watchcraft", "Watchcraft", "skill", "watchcraft", "wisdom"),
  proficiency(PROFICIENCY_IDS.skillHaulage, "skill-haulage", "Haulage", "skill", "haulage", "strength"),
  proficiency(PROFICIENCY_IDS.skillRiverlore, "skill-riverlore", "Riverlore", "skill", "riverlore", "intelligence"),
  proficiency(PROFICIENCY_IDS.skillParley, "skill-parley", "Parley", "skill", "parley", "charisma"),
  proficiency(PROFICIENCY_IDS.armorMedium, "armor-medium", "Medium armour", "armor", "medium"),
  proficiency(PROFICIENCY_IDS.armorShield, "armor-shield", "Shields", "armor", "shield"),
  proficiency(PROFICIENCY_IDS.weaponMartial, "weapon-martial", "Martial weapons", "weapon", "martial"),
  proficiency(PROFICIENCY_IDS.languageTradeCant, "language-trade-cant", "Trade Cant", "language", "trade-cant"),
  proficiency(PROFICIENCY_IDS.languageRiverSigns, "language-river-signs", "River Signs", "language", "river-signs"),
];

/**
 * Level-keyed class hit-point base. `scaleAtLevel` picks the highest row at or
 * below the current class level, so adding levels 3-20 is a data change only.
 */
const hitPointBaseEffect: Effect = {
  id: "effect:vanguard-hit-point-base",
  type: "scaleAtLevel",
  scope: "class",
  classId: SYNTHETIC_IDS.class,
  target: "hitPoints.classBase",
  levels: Object.fromEntries(
    Object.entries(VANGUARD_HIT_POINT_BASE).map(([level, base]) => [level, { kind: "literal", value: base }]),
  ),
  label: "Vanguard hit points",
};

const classEntry = entry({
  id: SYNTHETIC_IDS.class,
  slug: "vanguard",
  name: "Vanguard",
  category: "class",
  summary: "A front-rank escort trained to hold a line and steady the people behind it.",
  effects: [
    hitPointBaseEffect,
    { id: "effect:vanguard-field-kit", type: "grantEquipmentBundle", bundleId: SYNTHETIC_EQUIPMENT_BUNDLE, label: "Vanguard field kit" },
  ],
  equipmentBundles: [
    {
      id: SYNTHETIC_EQUIPMENT_BUNDLE,
      label: "Vanguard field kit",
      entries: [
        { type: "item", itemId: SYNTHETIC_IDS.weapon, quantity: 1, status: "equipped" },
        { type: "item", itemId: SYNTHETIC_IDS.armor, quantity: 1, status: "equipped" },
        { type: "item", itemId: SYNTHETIC_IDS.shield, quantity: 1, status: "equipped" },
        {
          type: "choice",
          id: SYNTHETIC_EQUIPMENT_CHOICE,
          label: "Travelling gear",
          min: 1,
          max: 1,
          options: [
            { id: "equipment-option:warden-pack", label: "Warden pack", entries: [{ type: "item", itemId: "item:warden-pack", quantity: 1, status: "carried" }] },
            { id: "equipment-option:river-kit", label: "River kit", entries: [{ type: "item", itemId: "item:river-kit", quantity: 1, status: "carried" }] },
          ],
        },
      ],
    },
  ],
  choices: [
    {
      id: SYNTHETIC_CHOICES.fightingStyle,
      label: "Vanguard stance",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:guarded-hand", label: "Guarded Hand", entryId: SYNTHETIC_IDS.style },
        // Deliberately out of reach for a standard-array Vanguard, so the
        // product can demonstrate an incompatible choice and its repair.
        { id: "option:reavers-grip", label: "Reaver's Grip", entryId: SYNTHETIC_IDS.heavyStyle },
      ],
    },
    {
      id: SYNTHETIC_CHOICES.weaponMastery,
      label: "Weapon mastery",
      min: 1,
      max: 1,
      repeatable: false,
      options: [{ id: "option:measured-cut", label: "Measured Cut", entryId: SYNTHETIC_IDS.mastery }],
    },
    {
      id: SYNTHETIC_CHOICES.classSkills,
      label: "Vanguard skills",
      min: 2,
      max: 2,
      repeatable: false,
      options: (
        [
          [PROFICIENCY_IDS.skillWatchcraft, "Watchcraft"],
          [PROFICIENCY_IDS.skillHaulage, "Haulage"],
          [PROFICIENCY_IDS.skillRiverlore, "Riverlore"],
          [PROFICIENCY_IDS.skillParley, "Parley"],
        ] as const
      ).map(([id, label]) => ({
        id: `option:${id}`,
        label,
        effects: [{ id: `effect:grant-${id}`, type: "grantProficiency", proficiencyId: id } satisfies Effect],
      })),
    },
  ],
  mechanics: {
    hitDie: VANGUARD_HIT_DIE,
    primaryAbilities: ["strength"],
    savingThrows: [PROFICIENCY_IDS.saveStrength, PROFICIENCY_IDS.saveConstitution],
    startingProficiencyIds: [PROFICIENCY_IDS.armorMedium, PROFICIENCY_IDS.armorShield, PROFICIENCY_IDS.weaponMartial],
    progression: [
      {
        level: 1,
        proficiencyBonus: 2,
        featureIds: ["feature:vanguard-hold-the-line", "feature:vanguard-longblade-training"],
        choiceIds: [SYNTHETIC_CHOICES.fightingStyle, SYNTHETIC_CHOICES.classSkills],
        resourceChanges: { [SYNTHETIC_IDS.resource]: VANGUARD_RALLYING_BREATH[1] },
      },
      {
        level: 2,
        proficiencyBonus: 2,
        featureIds: ["feature:vanguard-measured-advance"],
        choiceIds: [SYNTHETIC_CHOICES.weaponMastery],
        resourceChanges: { [SYNTHETIC_IDS.resource]: VANGUARD_RALLYING_BREATH[2] },
      },
    ],
    // Subclass selection is deferred past M2.1; the slot stays reserved.
    subclassLevel: 3,
    subclassIds: [],
  },
});

const classFeatures: ContentEntry[] = [
  entry({
    id: "feature:vanguard-hold-the-line",
    slug: "vanguard-hold-the-line",
    name: "Hold the Line",
    category: "class-feature",
    summary: "Draw a steadying breath to rally yourself and the people at your back.",
    mechanics: { classId: SYNTHETIC_IDS.class, level: 1, featureType: "resource" },
    effects: [
      {
        id: "effect:vanguard-rallying-breath",
        type: "addResource",
        resource: {
          id: SYNTHETIC_IDS.resource,
          name: "Rallying Breath",
          // The class progression writes the level-keyed maximum into this path.
          maximum: { kind: "path", path: `resource.${SYNTHETIC_IDS.resource}` },
          recharge: "short-rest",
        },
      },
      { id: "effect:vanguard-rallying-breath-recharge", type: "rechargeOnShortRest", resourceId: SYNTHETIC_IDS.resource },
    ],
  }),
  entry({
    id: "feature:vanguard-longblade-training",
    slug: "vanguard-longblade-training",
    name: "Longblade Training",
    category: "class-feature",
    summary: "Your drill with the longblade makes its measured strike an action you always have ready.",
    mechanics: { classId: SYNTHETIC_IDS.class, level: 1, featureType: "core" },
    effects: [{ id: "effect:vanguard-longblade-strike", type: "addAttack", definitionId: SYNTHETIC_IDS.attack }],
  }),
  entry({
    id: "feature:vanguard-measured-advance",
    slug: "vanguard-measured-advance",
    name: "Measured Advance",
    category: "class-feature",
    summary: "Second-level drill adds a weapon mastery and one more Rallying Breath.",
    mechanics: { classId: SYNTHETIC_IDS.class, level: 2, featureType: "core" },
  }),
];

const speciesEntry = entry({
  id: SYNTHETIC_IDS.species,
  slug: "riverborn",
  name: "Riverborn",
  category: "species",
  summary: "Raised on shifting banks and crossings, sure-footed where the ground gives way.",
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: ["trait:river-footing", "trait:steady-lungs"],
    lineageIds: [],
  },
});

const speciesTraits: ContentEntry[] = [
  entry({
    id: "trait:river-footing",
    slug: "river-footing",
    name: "River Footing",
    category: "feat",
    summary: "Wet stone and loose gravel do not slow your crossing.",
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: "trait:steady-lungs",
    slug: "steady-lungs",
    name: "Steady Lungs",
    category: "feat",
    summary: "You hold a breath far longer than most.",
    mechanics: { category: "other", repeatable: false },
  }),
];

const backgroundEntry = entry({
  id: SYNTHETIC_IDS.background,
  slug: "caravan-warden",
  name: "Caravan Warden",
  category: "background",
  summary: "Years walking beside loaded carts, counting heads at every stop.",
  choices: [
    {
      id: SYNTHETIC_CHOICES.backgroundLanguage,
      label: "Warden languages",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: `option:${PROFICIENCY_IDS.languageTradeCant}`, label: "Trade Cant", effects: [{ id: "effect:grant-trade-cant", type: "grantProficiency", proficiencyId: PROFICIENCY_IDS.languageTradeCant }] },
        { id: `option:${PROFICIENCY_IDS.languageRiverSigns}`, label: "River Signs", effects: [{ id: "effect:grant-river-signs", type: "grantProficiency", proficiencyId: PROFICIENCY_IDS.languageRiverSigns }] },
      ],
    },
  ],
  mechanics: {
    abilityScoreChoices: { abilities: ["strength", "constitution", "dexterity"], increasePattern: [2, 1] },
    featId: "feat:warden-vigil",
    proficiencyIds: [PROFICIENCY_IDS.skillWatchcraft],
    equipmentChoiceIds: [],
    equipmentBundleIds: [],
  },
});

const backgroundFeat = entry({
  id: "feat:warden-vigil",
  slug: "warden-vigil",
  name: "Warden's Vigil",
  category: "feat",
  summary: "You wake at the first wrong sound in a camp.",
  mechanics: { category: "origin", repeatable: false },
});

const styleEntry = entry({
  id: SYNTHETIC_IDS.style,
  slug: "guarded-hand",
  name: "Guarded Hand",
  category: "fighting-style",
  summary: "A close, shield-side grip that lends weight to every melee swing.",
  mechanics: { kind: "fighting-style", data: { stance: "guarded" } },
  effects: [
    {
      id: "effect:guarded-hand-damage",
      type: "modifyDamage",
      selector: { usage: "melee" },
      operation: "add",
      value: { kind: "literal", value: 1 },
      label: "Guarded Hand",
    },
  ],
});

const heavyStyleEntry = entry({
  id: SYNTHETIC_IDS.heavyStyle,
  slug: "reavers-grip",
  name: "Reaver's Grip",
  category: "fighting-style",
  summary: "A two-handed grip that only a very strong arm can hold steady.",
  mechanics: { kind: "fighting-style", data: { stance: "reaving" } },
  prerequisites: [
    {
      id: "prerequisite:reavers-grip-strength",
      label: "Strength 18 or higher",
      condition: { type: "ability", ability: "strength", operator: "gte", value: 18 },
      enforcement: "hard",
    },
  ],
  effects: [
    {
      id: "effect:reavers-grip-damage",
      type: "modifyDamage",
      selector: { usage: "melee" },
      operation: "add",
      value: { kind: "literal", value: 2 },
      label: "Reaver's Grip",
    },
  ],
});

const masteryEntry = entry({
  id: SYNTHETIC_IDS.mastery,
  slug: "measured-cut",
  name: "Measured Cut",
  category: "weapon-mastery",
  summary: "A deliberate cut that leaves your opponent's next swing hurried.",
  mechanics: { kind: "weapon-mastery", data: { appliesToWeaponId: SYNTHETIC_IDS.weapon } },
  effects: [{ id: "effect:measured-cut-grant", type: "addWeaponMastery", optionId: SYNTHETIC_IDS.mastery }],
});

/**
 * The playable action. Its metadata is validated at the resolver boundary before
 * any value is used; nothing here is executed.
 */
const attackEntry = entry({
  id: SYNTHETIC_IDS.attack,
  slug: "longblade-strike",
  name: "Longblade Strike",
  category: "rule",
  summary: "A measured swing with a longblade.",
  mechanics: {
    kind: "action-definition",
    data: {
      actionKind: "attack",
      usage: "melee",
      ability: "strength",
      proficient: true,
      weaponId: SYNTHETIC_IDS.weapon,
      damageDice: "1d8",
      damageType: "slashing",
      range: "5 ft.",
    },
  },
});

/**
 * Ability generation as declarative rule content, so the planner reads the
 * ruleset's method rather than importing a hard-coded array.
 */
const abilityGenerationEntries: ContentEntry[] = [
  entry({
    id: "rule:ability-generation-standard-array",
    slug: "ability-generation-standard-array",
    name: "Standard array",
    category: "rule",
    summary: "Assign one fixed set of six scores, then apply your origin's increases.",
    mechanics: { kind: "ability-generation", data: { method: "standard-array", scores: [...STANDARD_ARRAY], label: "Standard array" } },
  }),
  entry({
    id: "rule:ability-generation-manual",
    slug: "ability-generation-manual",
    name: "Enter scores manually",
    category: "rule",
    summary: "Record scores your table generated another way.",
    mechanics: { kind: "ability-generation", data: { method: "manual", label: "Enter scores manually" } },
  }),
];

/** Conditions the play sheet can apply. Tracking only; no derived effect in M2.1. */
export const SYNTHETIC_CONDITION_IDS = ["condition:winded", "condition:braced"] as const;

const conditionEntries: ContentEntry[] = [
  entry({
    id: "condition:winded",
    slug: "winded",
    name: "Winded",
    category: "condition",
    summary: "You are short of breath after a hard push.",
    mechanics: { kind: "condition", data: { track: true } },
  }),
  entry({
    id: "condition:braced",
    slug: "braced",
    name: "Braced",
    category: "condition",
    summary: "You have set your footing against the next hit.",
    mechanics: { kind: "condition", data: { track: true } },
  }),
];

const resourceEntry = entry({
  id: SYNTHETIC_IDS.resource,
  slug: "rallying-breath",
  name: "Rallying Breath",
  category: "resource",
  summary: "A steadying breath you can spend to rally. Returns on a short rest.",
  mechanics: { kind: "resource", data: { recharge: "short-rest" } },
});

const equipmentEntries: ContentEntry[] = [
  entry({
    id: SYNTHETIC_IDS.weapon,
    slug: "longblade",
    name: "Longblade",
    category: "weapon",
    summary: "A straight, single-handed blade favoured by caravan escorts.",
    mechanics: {
      category: "martial",
      usage: "melee",
      damage: { dice: "1d8", type: "slashing" },
      properties: ["versatile"],
      masteryId: SYNTHETIC_IDS.mastery,
      weight: 3,
      costGp: 15,
    },
  }),
  entry({
    id: SYNTHETIC_IDS.armor,
    slug: "travel-mail",
    name: "Travel Mail",
    category: "armor",
    summary: "Layered mail cut short for long days on the road.",
    mechanics: { category: "medium", baseArmorClass: 14, dexterity: "max-2", stealthDisadvantage: false, weight: 20, costGp: 50 },
  }),
  entry({
    id: SYNTHETIC_IDS.shield,
    slug: "round-guard",
    name: "Round Guard",
    category: "armor",
    summary: "A banded round shield light enough to carry all day.",
    mechanics: { category: "shield", baseArmorClass: 2, dexterity: "none", stealthDisadvantage: false, weight: 6, costGp: 10 },
  }),
  entry({
    id: "item:warden-pack",
    slug: "warden-pack",
    name: "Warden pack",
    category: "item",
    summary: "Rope, tally sticks, a lantern and three days of rations.",
    mechanics: { itemType: "pack", rarity: "none", attunement: { required: false }, weight: 22, attackIds: [], resourceIds: [] },
  }),
  entry({
    id: "item:river-kit",
    slug: "river-kit",
    name: "River kit",
    category: "item",
    summary: "Floats, a coil of waxed line and a folding pole.",
    mechanics: { itemType: "pack", rarity: "none", attunement: { required: false }, weight: 18, attackIds: [], resourceIds: [] },
  }),
];

export const SYNTHETIC_ENTRIES: readonly ContentEntry[] = [
  classEntry,
  ...classFeatures,
  speciesEntry,
  ...speciesTraits,
  backgroundEntry,
  backgroundFeat,
  styleEntry,
  heavyStyleEntry,
  masteryEntry,
  attackEntry,
  resourceEntry,
  ...conditionEntries,
  ...abilityGenerationEntries,
  ...equipmentEntries,
  ...proficiencyEntries,
];

export const SYNTHETIC_RULESET: RulesetProfile = {
  id: SYNTHETIC_RULESET_ID,
  name: "Runefolio 2024 synthetic",
  activeSourceIds: [SYNTHETIC_SOURCE_ID],
  editionPriority: ["homebrew"],
  allowedCategories: [
    "class", "class-feature", "subclass", "species", "background", "feat", "item", "weapon", "armor", "tool",
    "fighting-style", "weapon-mastery", "condition", "resource", "rule", "proficiency",
  ],
  allowLegacy: false,
  allowDuplicateVersions: false,
  conflictResolution: "source-priority",
  allowCustomOverrides: true,
  requirementEnforcement: "soft",
  createdAt: AT,
  updatedAt: AT,
};

/**
 * The importable pack document.
 *
 * It is parsed through the existing content-pack schema rather than cast, so the
 * seed cannot silently drift out of schema and the returned value carries the
 * schema's own narrowed type.
 */
export function syntheticRunefolioPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: SYNTHETIC_PACK_ID,
      name: "Runefolio synthetic slice",
      description: "Original synthetic level 1-2 content for the Runefolio character slice.",
      version: VERSION,
      // Honest coverage: the slice implements levels 1 and 2 only.
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
        id: SYNTHETIC_SOURCE_ID,
        name: "Runefolio synthetic reference",
        abbreviation: "RSR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 10,
        enabledByDefault: true,
        campaignIds: [],
        version: VERSION,
      },
    ],
    entries: SYNTHETIC_ENTRIES,
  });
}
