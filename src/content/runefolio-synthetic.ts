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
 *
 * Sereth's reference numbers (the spellcaster fixture, standard array with the
 * Caravan Warden +2 Dexterity / +1 Constitution):
 *
 *   Abilities   WIS 15, DEX 14+2=16, CON 13+1=14, INT 12, STR 10, CHA 8
 *   Hit points  level 1: class base 6 + Constitution +2 = 8
 *   Armour      Runewoven Vest 11 + Dexterity 3 = 14
 *   Attack      Emberline +4 to hit (Wisdom +2, proficiency +2), 1d10+2
 *   Casting     Wisdom; spell attack +4; save DC 8 + 2 + 2 = 12
 *   Slots       Rune slots 2 at level 1, 3 at level 2; return on a long rest
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
  /*
   * Three more origins, so the Species step is a real list rather than a list of
   * one. Each models a different shape of species-owned decision, which is what
   * the creation flow has to present correctly without knowing any of their
   * names:
   *
   *   Riverborn   two automatic traits, nothing to decide
   *   Stonevigil  a lineage choice, where the lineage replaces an inherited trait
   *   Emberkin    an inline ancestry choice, and a trait needing a table ruling
   */
  speciesLineage: "species:stonevigil",
  speciesAncestry: "species:emberkin",
  lineageDeepdelve: "lineage:deepdelve",
  /** A second background, so Background is a choice and not a formality. */
  backgroundSecond: "background:ferry-hand",
  style: "style:guarded-hand",
  heavyStyle: "style:reavers-grip",
  mastery: "mastery:measured-cut",
  weapon: "weapon:longblade",
  shield: "armor:round-guard",
  armor: "armor:travel-mail",
  attack: "action:longblade-strike",
  resource: "resource:rallying-breath",
} as const;

/** The spellcaster half of the fixture pair. All names are original. */
export const RUNECALLER_IDS = {
  class: "class:runecaller",
  staff: "weapon:reed-staff",
  vest: "armor:runewoven-vest",
  attack: "action:emberline-strike",
  slots: "resource:rune-slots",
  spellList: "spell-list:rune-repertoire",
  spellcastingRule: "rule:runecaller-spellcasting",
  spells: {
    emberline: "spell:emberline",
    wardOfReeds: "spell:ward-of-reeds",
    mendTheHour: "spell:mend-the-hour",
    riversGrasp: "spell:rivers-grasp",
    // Reachable through the repertoire and granted by nothing, so the class has
    // a genuine decision to make rather than a list it already owns.
    siltWhisper: "spell:silt-whisper",
    tallyMark: "spell:tally-mark",
    lanternRune: "spell:lantern-rune",
    stoneReading: "spell:stone-reading",
    quietTheWake: "spell:quiet-the-wake",
    borrowedFooting: "spell:borrowed-footing",
    ledgerOfDepths: "spell:ledger-of-depths",
  },
} as const;

/**
 * The spell decisions the Runecaller owes.
 *
 * Stable IDs, because a draft stores the player's answers under them. They live
 * beside the choice IDs for the same reason those do: a storage identity is not
 * a label and must not move when the wording does.
 */
export const RUNECALLER_SPELL_SELECTIONS = {
  cantrips: "spell-selection:runecaller-cantrips",
  runesKnown: "spell-selection:runecaller-runes-known",
} as const;

export const RUNECALLER_CHOICES = {
  classSkills: "choice:runecaller-skills",
} as const;

export const RUNECALLER_EQUIPMENT_BUNDLE = "bundle:runecaller-satchel";

/** Per-level class hit-point base for the Runecaller. */
export const RUNECALLER_HIT_POINT_BASE: Readonly<Record<number, number>> = { 1: 6, 2: 10 };
/** Per-level Rune slot maximum. */
export const RUNECALLER_RUNE_SLOTS: Readonly<Record<number, number>> = { 1: 2, 2: 3 };
export const RUNECALLER_HIT_DIE = 6;

/** Choice groups the builder resolves. Stable IDs outlive label refinement. */
export const SYNTHETIC_CHOICES = {
  fightingStyle: "choice:vanguard-stance",
  weaponMastery: "choice:vanguard-mastery",
  classSkills: "choice:vanguard-skills",
  backgroundLanguage: "choice:warden-languages",
  /** Species-owned: activates a lineage entry. */
  speciesLineage: "choice:stonevigil-lineage",
  /** Species-owned: options carry their own effects, with no entry behind them. */
  speciesAncestry: "choice:emberkin-ancestry",
  /** Background-owned, on the second background. */
  backgroundFerryCraft: "choice:ferry-hand-craft",
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
  saveWisdom: "proficiency:save-wisdom",
  saveIntelligence: "proficiency:save-intelligence",
  saveDexterity: "proficiency:save-dexterity",
  saveCharisma: "proficiency:save-charisma",
  armorLight: "proficiency:armor-light",
  weaponSimple: "proficiency:weapon-simple",
  skillStonecraft: "proficiency:skill-stonecraft",
  skillEmberlore: "proficiency:skill-emberlore",
  skillFerrylore: "proficiency:skill-ferrylore",
  /** Tool proficiencies, so a background can grant one and the step can say so. */
  toolCartwright: "proficiency:tool-cartwright",
  toolFerrywright: "proficiency:tool-ferrywright",
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
  proficiency(PROFICIENCY_IDS.saveWisdom, "save-wisdom", "Wisdom save", "save", "wisdom", "wisdom"),
  proficiency(PROFICIENCY_IDS.saveIntelligence, "save-intelligence", "Intelligence save", "save", "intelligence", "intelligence"),
  // A sheet lists all six saves and marks the proficient ones, so the ruleset
  // defines the full set even though no fixture class is proficient in these.
  proficiency(PROFICIENCY_IDS.saveDexterity, "save-dexterity", "Dexterity save", "save", "dexterity", "dexterity"),
  proficiency(PROFICIENCY_IDS.saveCharisma, "save-charisma", "Charisma save", "save", "charisma", "charisma"),
  proficiency(PROFICIENCY_IDS.armorLight, "armor-light", "Light armour", "armor", "light"),
  proficiency(PROFICIENCY_IDS.weaponSimple, "weapon-simple", "Simple weapons", "weapon", "simple"),
  proficiency(PROFICIENCY_IDS.skillStonecraft, "skill-stonecraft", "Stonecraft", "skill", "stonecraft", "intelligence"),
  proficiency(PROFICIENCY_IDS.skillEmberlore, "skill-emberlore", "Emberlore", "skill", "emberlore", "intelligence"),
  proficiency(PROFICIENCY_IDS.skillFerrylore, "skill-ferrylore", "Ferrylore", "skill", "ferrylore", "wisdom"),
  proficiency(PROFICIENCY_IDS.toolCartwright, "tool-cartwright", "Cartwright's tools", "tool", "cartwright"),
  proficiency(PROFICIENCY_IDS.toolFerrywright, "tool-ferrywright", "Ferrywright's tools", "tool", "ferrywright"),
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

/**
 * A species whose nested decision activates another entry.
 *
 * The lineage is reached through this species' own choice, so nothing is active
 * merely because `lineageIds` lists it. Taking Deepdelve swaps out Cavern Sense
 * through the typed `replacesTraitIds` relationship — not by any comparison of
 * trait names.
 */
const speciesWithLineage = entry({
  id: SYNTHETIC_IDS.speciesLineage,
  slug: "stonevigil",
  name: "Stonevigil",
  category: "species",
  summary: "Keepers of the deep waymarks, at home where the daylight stops.",
  choices: [
    {
      id: SYNTHETIC_CHOICES.speciesLineage,
      label: "Stonevigil lineage",
      min: 1,
      max: 1,
      repeatable: false,
      options: [{ id: "option:deepdelve", label: "Deepdelve", entryId: SYNTHETIC_IDS.lineageDeepdelve }],
    },
  ],
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: ["trait:cavern-sense", "trait:patient-hands"],
    lineageIds: [SYNTHETIC_IDS.lineageDeepdelve],
  },
});

const lineageEntry = entry({
  id: SYNTHETIC_IDS.lineageDeepdelve,
  slug: "deepdelve",
  name: "Deepdelve",
  category: "lineage",
  summary: "Stonevigil raised below the last stair, who navigate by sound alone.",
  mechanics: {
    parentSpeciesIds: [SYNTHETIC_IDS.speciesLineage],
    traitIds: ["trait:stone-listening"],
    replacesTraitIds: ["trait:cavern-sense"],
  },
});

/**
 * A species whose nested decision is declared inline.
 *
 * Its ancestry options carry their own effects rather than pointing at an
 * entry, which is the second shape a species-owned decision takes. It also
 * carries one trait the engine cannot settle, so the builder has something
 * genuinely manual to distinguish from the automatic traits beside it.
 */
const speciesWithAncestry = entry({
  id: SYNTHETIC_IDS.speciesAncestry,
  slug: "emberkin",
  name: "Emberkin",
  category: "species",
  summary: "Descended from the lamp-keepers who walked the long dark roads.",
  choices: [
    {
      id: SYNTHETIC_CHOICES.speciesAncestry,
      label: "Emberkin ancestry",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        {
          id: "option:hearth-kept",
          label: "Hearth-kept",
          effects: [{ id: "effect:grant-emberlore", type: "grantProficiency", proficiencyId: PROFICIENCY_IDS.skillEmberlore }],
        },
        {
          id: "option:ash-walking",
          label: "Ash-walking",
          effects: [{ id: "effect:grant-stonecraft", type: "grantProficiency", proficiencyId: PROFICIENCY_IDS.skillStonecraft }],
        },
      ],
    },
  ],
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: ["trait:cinder-step", "trait:ember-memory"],
    lineageIds: [],
  },
});

const speciesTraits: ContentEntry[] = [
  entry({
    id: "trait:cavern-sense",
    slug: "cavern-sense",
    name: "Cavern Sense",
    category: "feat",
    summary: "You judge depth and draught by the air on your face.",
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: "trait:patient-hands",
    slug: "patient-hands",
    name: "Patient Hands",
    category: "feat",
    summary: "Careful work does not tire you the way it tires others.",
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: "trait:stone-listening",
    slug: "stone-listening",
    name: "Stone Listening",
    category: "feat",
    summary: "You hear water and weight moving through rock long before you see either.",
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: "trait:cinder-step",
    slug: "cinder-step",
    name: "Cinder Step",
    category: "feat",
    summary: "Hot ground and loose ash do not slow your crossing.",
    effects: [
      { id: "effect:cinder-step-speed", type: "modifySpeed", operation: "add", value: { kind: "literal", value: 5 } },
    ],
    mechanics: { category: "other", repeatable: false },
  }),
  /*
   * A trait the engine deliberately does not settle.
   *
   * `manualAdjudication` is how content states that something needs a ruling.
   * The creation flow has to show it as such rather than list it beside the
   * automatic traits — a benefit the sheet is not tracking is the one thing a
   * player must not find out about at the table.
   */
  entry({
    id: "trait:ember-memory",
    slug: "ember-memory",
    name: "Ember Memory",
    category: "feat",
    summary: "Once between rests you recall a place you have never been, as your table judges it.",
    effects: [{ id: "effect:ember-memory-ruling", type: "manualAdjudication", reasonCode: "TABLE_RULING_REQUIRED" }],
    mechanics: { category: "other", repeatable: false },
  }),
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
    proficiencyIds: [PROFICIENCY_IDS.skillWatchcraft, PROFICIENCY_IDS.toolCartwright],
    equipmentChoiceIds: [],
    equipmentBundleIds: [],
  },
});

/**
 * A second background, so Background is a genuine decision.
 *
 * Between them the two backgrounds exercise every row the step presents:
 * ability increases, an origin feat, skill and tool proficiencies, a starting
 * kit that is partly granted and partly chosen, and a background-owned nested
 * decision. None of it is named anywhere in the UI.
 */
const secondBackgroundEntry = entry({
  id: SYNTHETIC_IDS.backgroundSecond,
  slug: "ferry-hand",
  name: "Ferry Hand",
  category: "background",
  summary: "You worked the crossings, reading the water and the people waiting on it.",
  choices: [
    {
      id: SYNTHETIC_CHOICES.backgroundFerryCraft,
      label: "Ferry craft",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        {
          id: "option:ferry-parley",
          label: "Reading passengers",
          effects: [{ id: "effect:grant-parley", type: "grantProficiency", proficiencyId: PROFICIENCY_IDS.skillParley }],
        },
        {
          id: "option:ferry-riverlore",
          label: "Reading the water",
          effects: [{ id: "effect:grant-ferry-riverlore", type: "grantProficiency", proficiencyId: PROFICIENCY_IDS.skillRiverlore }],
        },
      ],
    },
  ],
  equipmentBundles: [
    {
      id: "bundle:ferry-hand-kit",
      label: "Ferry hand's kit",
      entries: [
        { type: "item", itemId: "item:river-kit", quantity: 1, status: "carried" },
        {
          type: "choice",
          id: "equipment-choice:ferry-hand-tools",
          label: "Working tools",
          min: 1,
          max: 1,
          options: [
            { id: "equipment-option:ferry-warden-pack", label: "Warden pack", entries: [{ type: "item", itemId: "item:warden-pack", quantity: 1, status: "carried" }] },
            { id: "equipment-option:ferry-reed-staff", label: "Reed staff", entries: [{ type: "item", itemId: RUNECALLER_IDS.staff, quantity: 1, status: "carried" }] },
          ],
        },
      ],
    },
  ],
  mechanics: {
    /*
     * Two legal ways to spend the same allowance across three abilities. The
     * default stays `[2, 1]` so a reader that predates alternatives finds
     * exactly what it expects; `increasePatterns` adds the +1/+1/+1 spread.
     */
    abilityScoreChoices: {
      abilities: ["dexterity", "wisdom", "charisma"],
      increasePattern: [2, 1],
      increasePatterns: [
        [2, 1],
        [1, 1, 1],
      ],
    },
    featId: "feat:ferry-sense",
    proficiencyIds: [PROFICIENCY_IDS.skillFerrylore, PROFICIENCY_IDS.toolFerrywright],
    equipmentChoiceIds: [],
    equipmentBundleIds: ["bundle:ferry-hand-kit"],
  },
});

const secondBackgroundFeat = entry({
  id: "feat:ferry-sense",
  slug: "ferry-sense",
  name: "Ferry Sense",
  category: "feat",
  summary: "You read a crossing's mood — the water's and the queue's — before you push off.",
  mechanics: { category: "origin", repeatable: false },
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

/**
 * The Runecaller: the spellcaster half of the fixture pair.
 *
 * Its rune slots ride the existing resource machinery — the class progression
 * writes a level-keyed maximum and the feature adds a long-rest resource — so
 * slot tracking needs no new runtime concepts.
 *
 * Its spells arrive by both routes on purpose. Four runes are granted outright
 * by `addSpell` effects on the class entry — one of them always prepared — and
 * the rest of the repertoire is reachable but unowned, so the casting rule's
 * declared selections have genuine alternatives. That pairing is what makes the
 * Spells & resources step a decision rather than a list, and what demonstrates
 * in the app's own content that a granted spell does not spend a chosen one.
 */
const runecallerHitPointBaseEffect: Effect = {
  id: "effect:runecaller-hit-point-base",
  type: "scaleAtLevel",
  scope: "class",
  classId: RUNECALLER_IDS.class,
  target: "hitPoints.classBase",
  levels: Object.fromEntries(
    Object.entries(RUNECALLER_HIT_POINT_BASE).map(([level, base]) => [level, { kind: "literal", value: base }]),
  ),
  label: "Runecaller hit points",
};

const runecallerClassEntry = entry({
  id: RUNECALLER_IDS.class,
  slug: "runecaller",
  name: "Runecaller",
  category: "class",
  summary: "A reader of river runes who spends stored marks to bend the current of a moment.",
  effects: [
    runecallerHitPointBaseEffect,
    { id: "effect:runecaller-satchel", type: "grantEquipmentBundle", bundleId: RUNECALLER_EQUIPMENT_BUNDLE, label: "Runecaller satchel" },
    { id: "effect:runecaller-spell-emberline", type: "addSpell", spellId: RUNECALLER_IDS.spells.emberline, alwaysPrepared: true },
    { id: "effect:runecaller-spell-ward-of-reeds", type: "addSpell", spellId: RUNECALLER_IDS.spells.wardOfReeds },
    { id: "effect:runecaller-spell-mend-the-hour", type: "addSpell", spellId: RUNECALLER_IDS.spells.mendTheHour },
    { id: "effect:runecaller-spell-rivers-grasp", type: "addSpell", spellId: RUNECALLER_IDS.spells.riversGrasp },
    { id: "effect:runecaller-spell-list", type: "addSpellList", spellListId: RUNECALLER_IDS.spellList },
  ],
  equipmentBundles: [
    {
      id: RUNECALLER_EQUIPMENT_BUNDLE,
      label: "Runecaller satchel",
      entries: [
        { type: "item", itemId: RUNECALLER_IDS.staff, quantity: 1, status: "equipped" },
        { type: "item", itemId: RUNECALLER_IDS.vest, quantity: 1, status: "equipped" },
        {
          type: "choice",
          id: "equipment-choice:runecaller-kit",
          label: "Travelling gear",
          min: 1,
          max: 1,
          options: [
            { id: "equipment-option:runecaller-warden-pack", label: "Warden pack", entries: [{ type: "item", itemId: "item:warden-pack", quantity: 1, status: "carried" }] },
            { id: "equipment-option:runecaller-river-kit", label: "River kit", entries: [{ type: "item", itemId: "item:river-kit", quantity: 1, status: "carried" }] },
          ],
        },
      ],
    },
  ],
  choices: [
    {
      id: RUNECALLER_CHOICES.classSkills,
      label: "Runecaller skills",
      min: 1,
      max: 1,
      repeatable: false,
      options: (
        [
          [PROFICIENCY_IDS.skillRiverlore, "Riverlore"],
          [PROFICIENCY_IDS.skillWatchcraft, "Watchcraft"],
          [PROFICIENCY_IDS.skillParley, "Parley"],
        ] as const
      ).map(([id, label]) => ({
        id: `option:runecaller-${id}`,
        label,
        effects: [{ id: `effect:runecaller-grant-${id}`, type: "grantProficiency", proficiencyId: id } satisfies Effect],
      })),
    },
  ],
  mechanics: {
    hitDie: RUNECALLER_HIT_DIE,
    primaryAbilities: ["wisdom"],
    savingThrows: [PROFICIENCY_IDS.saveWisdom, PROFICIENCY_IDS.saveIntelligence],
    startingProficiencyIds: [PROFICIENCY_IDS.armorLight, PROFICIENCY_IDS.weaponSimple],
    progression: [
      {
        level: 1,
        proficiencyBonus: 2,
        featureIds: ["feature:runecaller-rune-slots", "feature:runecaller-repertoire"],
        choiceIds: [RUNECALLER_CHOICES.classSkills],
        resourceChanges: { [RUNECALLER_IDS.slots]: RUNECALLER_RUNE_SLOTS[1] },
      },
      {
        level: 2,
        proficiencyBonus: 2,
        featureIds: ["feature:runecaller-deep-reading"],
        choiceIds: [],
        resourceChanges: { [RUNECALLER_IDS.slots]: RUNECALLER_RUNE_SLOTS[2] },
      },
    ],
    subclassLevel: 3,
    subclassIds: [],
  },
});

const runecallerFeatures: ContentEntry[] = [
  entry({
    id: "feature:runecaller-rune-slots",
    slug: "runecaller-rune-slots",
    name: "Rune Slots",
    category: "class-feature",
    summary: "Marks traced at dawn hold power you can spend to cast. They fade and reform after a long rest.",
    mechanics: { classId: RUNECALLER_IDS.class, level: 1, featureType: "resource" },
    effects: [
      {
        id: "effect:runecaller-rune-slots",
        type: "addResource",
        resource: {
          id: RUNECALLER_IDS.slots,
          name: "Rune slots",
          maximum: { kind: "path", path: `resource.${RUNECALLER_IDS.slots}` },
          recharge: "long-rest",
        },
      },
      { id: "effect:runecaller-rune-slots-recharge", type: "rechargeOnLongRest", resourceId: RUNECALLER_IDS.slots },
    ],
  }),
  entry({
    id: "feature:runecaller-repertoire",
    slug: "runecaller-repertoire",
    name: "Runic Repertoire",
    category: "class-feature",
    summary: "You know a small set of runes by heart, and the Emberline rune answers as fast as a thrown stone.",
    mechanics: { classId: RUNECALLER_IDS.class, level: 1, featureType: "core" },
    effects: [{ id: "effect:runecaller-emberline-strike", type: "addAttack", definitionId: RUNECALLER_IDS.attack }],
  }),
  entry({
    id: "feature:runecaller-deep-reading",
    slug: "runecaller-deep-reading",
    name: "Deep Reading",
    category: "class-feature",
    summary: "Second-level study holds one more rune slot ready each dawn.",
    mechanics: { classId: RUNECALLER_IDS.class, level: 2, featureType: "core" },
  }),
];

/** The playable ranged rune attack, mirrored by the Emberline spell entry. */
const runecallerAttackEntry = entry({
  id: RUNECALLER_IDS.attack,
  slug: "emberline-strike",
  name: "Emberline",
  category: "rule",
  summary: "A thin line of ember light darts to a mark you can see.",
  mechanics: {
    kind: "action-definition",
    data: {
      actionKind: "attack",
      usage: "ranged",
      ability: "wisdom",
      proficient: true,
      damageDice: "1d10",
      damageType: "ember",
      range: "60 ft.",
    },
  },
});

/**
 * The declarative casting summary the sheet reads. The resolver computes the
 * spell attack as ability modifier plus proficiency, and the save DC as
 * `saveDcBase` plus ability modifier plus proficiency; nothing here is code.
 */
const runecallerSpellcastingRule = entry({
  id: RUNECALLER_IDS.spellcastingRule,
  slug: "runecaller-spellcasting",
  name: "Runecaller spellcasting",
  category: "rule",
  summary: "Runecaller casting uses Wisdom and spends rune slots.",
  mechanics: {
    kind: "spellcasting",
    data: {
      classId: RUNECALLER_IDS.class,
      ability: "wisdom",
      attackProficient: true,
      saveDcBase: 8,
      slotResourceIds: [RUNECALLER_IDS.slots],
      /*
       * What the player chooses, stated as data.
       *
       * The counts are cumulative totals at a level, not deltas, so a character
       * created at level 2 owes what a level 2 Runecaller owes without the
       * builder replaying level 1. Neither selection says
       * `grantedConsumesAllowance`, so the runes the class grants outright sit
       * beside these decisions rather than inside them — which is the whole
       * point of the distinction, and is visible on the step as granted rows in
       * the same list.
       */
      selections: [
        {
          id: RUNECALLER_SPELL_SELECTIONS.cantrips,
          model: "known",
          label: "Cantrips",
          spellLevels: { min: 0, max: 0 },
          progression: [{ level: 1, count: 2 }],
        },
        {
          id: RUNECALLER_SPELL_SELECTIONS.runesKnown,
          model: "known",
          label: "Runes known",
          spellLevels: { min: 1 },
          progression: [
            { level: 1, count: 2, maxSpellLevel: 1 },
            { level: 2, count: 3, maxSpellLevel: 1 },
          ],
        },
      ],
    },
  },
});

const spell = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "summary"> & { mechanics: Record<string, unknown> },
): ContentEntry =>
  entry({
    ...partial,
    category: "spell",
    mechanics: partial.mechanics,
  });

const runecallerSpells: ContentEntry[] = [
  spell({
    id: RUNECALLER_IDS.spells.emberline,
    slug: "emberline",
    name: "Emberline",
    summary: "A thin line of ember light darts to a mark you can see and scorches it.",
    mechanics: {
      level: 0,
      school: "evocation",
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "distance", distance: 60, unit: "feet" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.wardOfReeds,
    slug: "ward-of-reeds",
    name: "Ward of Reeds",
    summary: "Woven reeds of pale light brace one creature you touch against the next blows.",
    mechanics: {
      level: 1,
      school: "abjuration",
      components: { verbal: true, somatic: true, material: "a dried reed", consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "timed", amount: 10, unit: "minute", concentration: true },
      range: { type: "touch" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.mendTheHour,
    slug: "mend-the-hour",
    name: "Mend the Hour",
    summary: "Knits the last hour's hurts closed in one creature you touch.",
    mechanics: {
      level: 1,
      school: "abjuration",
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "touch" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.riversGrasp,
    slug: "rivers-grasp",
    name: "River's Grasp",
    summary: "The current itself grips a creature you can see, dragging at its every step.",
    mechanics: {
      level: 1,
      school: "conjuration",
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "timed", amount: 1, unit: "minute", concentration: true },
      range: { type: "distance", distance: 30, unit: "feet" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  /*
   * The repertoire the player actually chooses from.
   *
   * The four runes above are granted outright, and a class whose every reachable
   * spell is already granted has no decision to make — which left the Spells &
   * resources step with nothing to present but a list. These six are on the same
   * repertoire and granted by nothing, so the two selections declared on the
   * casting rule have real alternatives: two cantrips from three, and two runes
   * from three.
   */
  spell({
    id: RUNECALLER_IDS.spells.siltWhisper,
    slug: "silt-whisper",
    name: "Silt Whisper",
    summary: "A word carried in the river silt reaches one ear you choose nearby.",
    mechanics: {
      level: 0,
      school: "transmutation",
      components: { verbal: true, somatic: false, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "distance", distance: 30, unit: "feet" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.tallyMark,
    slug: "tally-mark",
    name: "Tally Mark",
    summary: "A counting rune settles on a surface and keeps its number until you clear it.",
    mechanics: {
      level: 0,
      school: "divination",
      components: { verbal: false, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "until-dispelled", concentration: false },
      range: { type: "touch" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
      ritual: true,
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.lanternRune,
    slug: "lantern-rune",
    name: "Lantern Rune",
    summary: "A drawn rune holds a steady light for as long as the ink lasts.",
    mechanics: {
      level: 0,
      school: "evocation",
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "timed", amount: 1, unit: "hour", concentration: false },
      range: { type: "touch" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.stoneReading,
    slug: "stone-reading",
    name: "Stone Reading",
    summary: "The last thing to cross a stretch of stone leaves its shape for you to read.",
    mechanics: {
      level: 1,
      school: "divination",
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "minute" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "touch" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
      ritual: true,
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.quietTheWake,
    slug: "quiet-the-wake",
    name: "Quiet the Wake",
    summary: "The water closes behind your party without a sound or a trace.",
    mechanics: {
      level: 1,
      school: "illusion",
      components: { verbal: false, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "timed", amount: 10, unit: "minute", concentration: true },
      range: { type: "self" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.ledgerOfDepths,
    slug: "ledger-of-depths",
    name: "Ledger of Depths",
    summary: "The water gives up what it is carrying, one line at a time.",
    mechanics: {
      level: 1,
      school: "divination",
      components: { verbal: true, somatic: false, consumed: false },
      castingTime: { amount: 10, unit: "minute" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "self" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
      ritual: true,
    },
  }),
  spell({
    id: RUNECALLER_IDS.spells.borrowedFooting,
    slug: "borrowed-footing",
    name: "Borrowed Footing",
    summary: "For a moment the current holds one creature up as though it were ground.",
    mechanics: {
      level: 1,
      school: "conjuration",
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "reaction", trigger: "A creature you can see begins to fall" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "distance", distance: 30, unit: "feet" },
      scaling: [],
      spellListIds: [RUNECALLER_IDS.spellList],
    },
  }),
];

const runecallerSpellList = entry({
  id: RUNECALLER_IDS.spellList,
  slug: "rune-repertoire",
  name: "Rune repertoire",
  category: "spell-list",
  summary: "The runes a Runecaller can learn.",
  mechanics: {
    spellIds: Object.values(RUNECALLER_IDS.spells),
    ownerIds: [RUNECALLER_IDS.class],
  },
});

const runecallerResourceEntry = entry({
  id: RUNECALLER_IDS.slots,
  slug: "rune-slots",
  name: "Rune slots",
  category: "resource",
  summary: "Marks traced at dawn that power your runes. They return after a long rest.",
  mechanics: { kind: "resource", data: { recharge: "long-rest" } },
});

const runecallerEquipment: ContentEntry[] = [
  entry({
    id: RUNECALLER_IDS.staff,
    slug: "reed-staff",
    name: "Reed staff",
    category: "weapon",
    summary: "A light staff of bound river reed, worn smooth by the current.",
    mechanics: {
      category: "simple",
      usage: "melee",
      damage: { dice: "1d6", type: "bludgeoning" },
      properties: ["versatile"],
      weight: 4,
      costGp: 2,
    },
  }),
  entry({
    id: RUNECALLER_IDS.vest,
    slug: "runewoven-vest",
    name: "Runewoven Vest",
    category: "armor",
    summary: "A quilted vest with warding marks stitched through the lining.",
    mechanics: { category: "light", baseArmorClass: 11, dexterity: "full", stealthDisadvantage: false, weight: 8, costGp: 10 },
  }),
];

export const SYNTHETIC_ENTRIES: readonly ContentEntry[] = [
  classEntry,
  ...classFeatures,
  speciesEntry,
  speciesWithLineage,
  speciesWithAncestry,
  lineageEntry,
  ...speciesTraits,
  backgroundEntry,
  backgroundFeat,
  secondBackgroundEntry,
  secondBackgroundFeat,
  styleEntry,
  heavyStyleEntry,
  masteryEntry,
  attackEntry,
  resourceEntry,
  ...conditionEntries,
  ...abilityGenerationEntries,
  ...equipmentEntries,
  ...proficiencyEntries,
  runecallerClassEntry,
  ...runecallerFeatures,
  runecallerAttackEntry,
  runecallerSpellcastingRule,
  ...runecallerSpells,
  runecallerSpellList,
  runecallerResourceEntry,
  ...runecallerEquipment,
];

export const SYNTHETIC_RULESET: RulesetProfile = {
  id: SYNTHETIC_RULESET_ID,
  name: "Runefolio 2024 synthetic",
  activeSourceIds: [SYNTHETIC_SOURCE_ID],
  editionPriority: ["homebrew"],
  /*
   * Every category this pack ships. A hand-written list is exactly the thing
   * that goes stale — `lineage` was missing here while the pack shipped one, so
   * the seeded ruleset activated a lineage entry it could never show. The
   * category-advancement contract in `tests/spell-category-reachability` is what
   * stops that being permanent; keeping this list honest is what stops it
   * happening in the first place.
   */
  allowedCategories: [
    "class", "class-feature", "subclass", "species", "lineage", "background", "feat", "item", "weapon", "armor",
    "tool", "fighting-style", "weapon-mastery", "condition", "resource", "rule", "proficiency", "spell", "spell-list",
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
