/**
 * The engine-correctness slice.
 *
 * Every name, number and phrase here is original material written for this
 * repository's tests. It models no published game and reproduces no third-party
 * vocabulary. It exists to pin three generic engine contracts that real-content
 * validation exposed, and nothing else:
 *
 *  1. **Maximum hit points.** The class declares a *cumulative* hit-point base
 *     per level. The Constitution modifier applies once per character level, not
 *     once per character. `TIDEWATCH_HIT_POINT_BASE[5]` is 34, so a Constitution
 *     modifier of +2 must produce 44 at level 5 — not 36.
 *  2. **Armour context.** One equipped body armour must satisfy a generic
 *     `wearingArmor` condition. The plated coat is AC 16 with no Dexterity
 *     contribution and the level 1 feature adds +1 while armour is worn, so the
 *     end-to-end answer is exactly 17. A shield alone, a rope alone, and an empty
 *     protection selection must all leave the condition unsatisfied.
 *  3. **Subclass unification.** Three classes declare their subclass decision
 *     three different ways: typed only, typed plus a fully redundant generic
 *     choice, and typed plus a partially overlapping generic choice. The engine
 *     must present one decision for the first two and diagnose the third.
 *
 * Read it as a specification of those three contracts, not as a game.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry, Effect } from "@/src/domain/model";

const AT = "2026-08-05T08:00:00.000Z";
const VERSION = "1.0.0";

export const TIDEWATCH_SOURCE_ID = "source:tidewatch-engine";
export const TIDEWATCH_PACK_ID = "pack:tidewatch-engine";
/** The profile ID `rulesetIdForPack` derives from the pack, prefix kept whole. */
export const TIDEWATCH_RULESET_ID = "ruleset:pack:tidewatch-engine";

export const TIDEWATCH_IDS = {
  /** The main class: typed subclass declaration only. */
  class: "class:tw-bulwark",
  /** Declares its subclass twice — typed, and again as a generic choice. */
  mirroredClass: "class:tw-mirrored-tide",
  /** Declares a generic choice that only partly overlaps its typed subclasses. */
  tangledClass: "class:tw-tangled-net",
  subclassHold: "subclass:tw-standing-hold",
  subclassSurge: "subclass:tw-rising-surge",
  mirroredFirst: "subclass:tw-mirror-ebb",
  mirroredSecond: "subclass:tw-mirror-flood",
  tangledFirst: "subclass:tw-net-hauler",
  tangledSecond: "subclass:tw-net-mender",
  species: "species:tw-shoalfolk",
  speciesTrait: "trait:tw-tide-read",
  background: "background:tw-harbour-hand",
  backgroundFeat: "feat:tw-steady-footing",
  /** The level 1 feature whose bonus is conditioned on wearing armour. */
  bracedStance: "feature:tw-braced-stance",
  resource: "resource:tw-held-breath",
  /** The attack every class in this slice grants, so every sheet is renderable. */
  attack: "action:tw-pike-thrust",
  weapon: "weapon:tw-boarding-pike",
  /** Body armour: AC 16 flat, no Dexterity contribution. */
  bodyArmor: "armor:tw-plated-coat",
  shield: "armor:tw-round-guard",
  /** Ordinary gear with no armour mechanics, deliberately equipped. */
  plainGear: "item:tw-coiled-rope",
} as const;

export const TIDEWATCH_CHOICES = {
  /** An ordinary class choice, unrelated to any subclass decision. */
  classSkills: "choice:tw-skills",
  /** Fully redundant with the mirrored class's typed subclass declaration. */
  mirroredPath: "choice:tw-mirrored-path",
  /** Partially overlapping: one subclass option and one that is not a subclass. */
  tangledPath: "choice:tw-tangled-path",
} as const;

export const TIDEWATCH_BUNDLES = {
  kit: "bundle:tw-deckhand-kit",
  /** Which protection, if any, the build actually wears. */
  protection: "equipment-choice:tw-protection",
} as const;

export const TIDEWATCH_EQUIPMENT_OPTIONS = {
  /** Body armour only. This is the end-to-end armour-class case. */
  coat: "equipment-option:tw-coat",
  /** A shield and no body armour. */
  shieldOnly: "equipment-option:tw-shield-only",
  /** Body armour and a shield together. */
  coatAndShield: "equipment-option:tw-coat-and-shield",
  /** Equipped gear that carries no armour mechanics at all. */
  ropeOnly: "equipment-option:tw-rope-only",
} as const;

export const TIDEWATCH_PROFICIENCIES = {
  saveStrength: "proficiency:tw-save-strength",
  saveConstitution: "proficiency:tw-save-constitution",
  skillRigging: "proficiency:tw-skill-rigging",
  skillTidelore: "proficiency:tw-skill-tidelore",
  armorHeavy: "proficiency:tw-armor-heavy",
} as const;

export const TIDEWATCH_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/**
 * Cumulative class hit-point base per level, excluding every ability
 * contribution. Level 5 is 34, which is the number the acceptance case is built
 * around: 34 + (5 x +2) = 44, where the defective engine produced 34 + 2 = 36.
 */
export const TIDEWATCH_HIT_POINT_BASE: Readonly<Record<number, number>> = { 1: 10, 2: 16, 3: 22, 4: 28, 5: 34 };
export const TIDEWATCH_HELD_BREATH: Readonly<Record<number, number>> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4 };
/** Flat armour class of the body armour, before any conditional bonus. */
export const TIDEWATCH_BODY_ARMOR_CLASS = 16;
/** The armour-conditioned bonus the level 1 feature contributes. */
export const TIDEWATCH_ARMOR_BONUS = 1;
export const TIDEWATCH_SHIELD_ARMOR_CLASS = 2;

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: TIDEWATCH_SOURCE_ID,
  sourceLocator: { sourceId: TIDEWATCH_SOURCE_ID, page: "1", section: "Engine-correctness slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 40, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "tidewatch-engine"],
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

const proficiency = (id: string, slug: string, name: string, type: string, key: string, ability?: string) =>
  entry({
    id,
    slug,
    name,
    category: "proficiency",
    mechanics: { type, key },
    tags: ability ? ["synthetic", "tidewatch-engine", `ability:${ability}`] : ["synthetic", "tidewatch-engine"],
  });

const grant = (proficiencyId: string): Effect => ({
  id: `effect:tw-grant-${proficiencyId}`,
  type: "grantProficiency",
  proficiencyId,
});

const proficiencyEntries: ContentEntry[] = [
  proficiency(TIDEWATCH_PROFICIENCIES.saveStrength, "tw-save-strength", "Strength save", "save", "strength", "strength"),
  proficiency(TIDEWATCH_PROFICIENCIES.saveConstitution, "tw-save-constitution", "Constitution save", "save", "constitution", "constitution"),
  proficiency(TIDEWATCH_PROFICIENCIES.skillRigging, "tw-skill-rigging", "Rigging", "skill", "rigging", "strength"),
  proficiency(TIDEWATCH_PROFICIENCIES.skillTidelore, "tw-skill-tidelore", "Tidelore", "skill", "tidelore", "intelligence"),
  proficiency(TIDEWATCH_PROFICIENCIES.armorHeavy, "tw-armor-heavy", "Plated coats", "armor", "heavy"),
];

/**
 * Every class grants the same braced attack.
 *
 * The automatic sheet's minimum includes at least one action, so a class that
 * granted none would open as a recovery view and the contracts under test would
 * be measured through the wrong screen.
 */
const pikeThrustEffect = (id: string): Effect => ({ id, type: "addAttack", definitionId: TIDEWATCH_IDS.attack });

/** Level-keyed cumulative base, so level 5 is read from data rather than derived. */
const hitPointBaseEffect = (classId: string, id: string): Effect => ({
  id,
  type: "scaleAtLevel",
  scope: "class",
  classId,
  target: "hitPoints.classBase",
  levels: Object.fromEntries(
    Object.entries(TIDEWATCH_HIT_POINT_BASE).map(([level, base]) => [level, { kind: "literal", value: base }]),
  ),
});

const bulwark = entry({
  id: TIDEWATCH_IDS.class,
  slug: "tw-bulwark",
  name: "Bulwark",
  category: "class",
  summary: "Stands where the water comes over the wall and does not move.",
  effects: [
    hitPointBaseEffect(TIDEWATCH_IDS.class, "effect:tw-bulwark-hit-point-base"),
    pikeThrustEffect("effect:tw-bulwark-pike-thrust"),
    { id: "effect:tw-deckhand-kit", type: "grantEquipmentBundle", bundleId: TIDEWATCH_BUNDLES.kit, label: "Deckhand kit" },
  ],
  equipmentBundles: [
    {
      id: TIDEWATCH_BUNDLES.kit,
      label: "Deckhand kit",
      entries: [
        { type: "item", itemId: TIDEWATCH_IDS.weapon, quantity: 1, status: "equipped" },
        {
          type: "choice",
          id: TIDEWATCH_BUNDLES.protection,
          label: "Protection",
          min: 1,
          max: 1,
          options: [
            {
              id: TIDEWATCH_EQUIPMENT_OPTIONS.coat,
              label: "Wear the coat",
              entries: [{ type: "item", itemId: TIDEWATCH_IDS.bodyArmor, quantity: 1, status: "equipped" }],
            },
            {
              id: TIDEWATCH_EQUIPMENT_OPTIONS.shieldOnly,
              label: "Carry the guard",
              entries: [{ type: "item", itemId: TIDEWATCH_IDS.shield, quantity: 1, status: "equipped" }],
            },
            {
              id: TIDEWATCH_EQUIPMENT_OPTIONS.coatAndShield,
              label: "Coat and guard together",
              entries: [
                { type: "item", itemId: TIDEWATCH_IDS.bodyArmor, quantity: 1, status: "equipped" },
                { type: "item", itemId: TIDEWATCH_IDS.shield, quantity: 1, status: "equipped" },
              ],
            },
            {
              id: TIDEWATCH_EQUIPMENT_OPTIONS.ropeOnly,
              label: "Rope and nothing else",
              entries: [{ type: "item", itemId: TIDEWATCH_IDS.plainGear, quantity: 1, status: "equipped" }],
            },
          ],
        },
      ],
    },
  ],
  choices: [
    {
      id: TIDEWATCH_CHOICES.classSkills,
      label: "Bulwark skills",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: `option:${TIDEWATCH_PROFICIENCIES.skillRigging}`, label: "Rigging", effects: [grant(TIDEWATCH_PROFICIENCIES.skillRigging)] },
        { id: `option:${TIDEWATCH_PROFICIENCIES.skillTidelore}`, label: "Tidelore", effects: [grant(TIDEWATCH_PROFICIENCIES.skillTidelore)] },
      ],
    },
  ],
  mechanics: {
    hitDie: 10,
    primaryAbilities: ["strength"],
    savingThrows: [TIDEWATCH_PROFICIENCIES.saveStrength, TIDEWATCH_PROFICIENCIES.saveConstitution],
    startingProficiencyIds: [TIDEWATCH_PROFICIENCIES.armorHeavy],
    progression: [
      {
        level: 1,
        proficiencyBonus: 2,
        featureIds: [TIDEWATCH_IDS.bracedStance],
        choiceIds: [TIDEWATCH_CHOICES.classSkills],
        resourceChanges: { [TIDEWATCH_IDS.resource]: TIDEWATCH_HELD_BREATH[1] },
      },
      { level: 2, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: { [TIDEWATCH_IDS.resource]: TIDEWATCH_HELD_BREATH[2] } },
      { level: 3, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: { [TIDEWATCH_IDS.resource]: TIDEWATCH_HELD_BREATH[3] } },
      { level: 4, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: { [TIDEWATCH_IDS.resource]: TIDEWATCH_HELD_BREATH[4] } },
      { level: 5, proficiencyBonus: 3, featureIds: [], choiceIds: [], resourceChanges: { [TIDEWATCH_IDS.resource]: TIDEWATCH_HELD_BREATH[5] } },
    ],
    subclassLevel: 3,
    subclassIds: [TIDEWATCH_IDS.subclassHold, TIDEWATCH_IDS.subclassSurge],
  },
});

/**
 * The redundant declaration.
 *
 * `subclassIds` and `subclassLevel` say the decision exists, and the level 3
 * progression row *also* names a generic choice whose two options resolve to
 * exactly those two subclasses. One conceptual decision, declared twice.
 */
const mirroredTide = entry({
  id: TIDEWATCH_IDS.mirroredClass,
  slug: "tw-mirrored-tide",
  name: "Mirrored Tide",
  category: "class",
  summary: "A class whose pack declares its one subclass decision in two places.",
  // The same kit the main class grants, so a committed character of this class
  // resolves an armour class and opens as an ordinary sheet. The bundle is
  // defined once and referenced by ID; definitions are collected across entries.
  effects: [
    hitPointBaseEffect(TIDEWATCH_IDS.mirroredClass, "effect:tw-mirrored-hit-point-base"),
    pikeThrustEffect("effect:tw-mirrored-pike-thrust"),
    { id: "effect:tw-mirrored-kit", type: "grantEquipmentBundle", bundleId: TIDEWATCH_BUNDLES.kit, label: "Deckhand kit" },
  ],
  choices: [
    {
      id: TIDEWATCH_CHOICES.mirroredPath,
      label: "Mirrored path",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:tw-mirror-ebb", label: "Ebb", entryId: TIDEWATCH_IDS.mirroredFirst },
        { id: "option:tw-mirror-flood", label: "Flood", entryId: TIDEWATCH_IDS.mirroredSecond },
      ],
    },
  ],
  mechanics: {
    hitDie: 10,
    primaryAbilities: ["strength"],
    savingThrows: [TIDEWATCH_PROFICIENCIES.saveStrength, TIDEWATCH_PROFICIENCIES.saveConstitution],
    startingProficiencyIds: [],
    progression: [
      { level: 1, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      { level: 2, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      { level: 3, proficiencyBonus: 2, featureIds: [], choiceIds: [TIDEWATCH_CHOICES.mirroredPath], resourceChanges: {} },
      { level: 4, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      { level: 5, proficiencyBonus: 3, featureIds: [], choiceIds: [], resourceChanges: {} },
    ],
    subclassLevel: 3,
    subclassIds: [TIDEWATCH_IDS.mirroredFirst, TIDEWATCH_IDS.mirroredSecond],
  },
});

/**
 * The ambiguous declaration.
 *
 * The level 3 generic choice offers one of the class's declared subclasses and
 * one entry that is not a subclass at all. That is not one decision written
 * twice, so it must not be unified away — but it is not obviously two decisions
 * either, so it has to be named rather than silently accepted.
 */
const tangledNet = entry({
  id: TIDEWATCH_IDS.tangledClass,
  slug: "tw-tangled-net",
  name: "Tangled Net",
  category: "class",
  summary: "A class whose level 3 choice mixes a subclass with something that is not one.",
  effects: [
    hitPointBaseEffect(TIDEWATCH_IDS.tangledClass, "effect:tw-tangled-hit-point-base"),
    pikeThrustEffect("effect:tw-tangled-pike-thrust"),
    { id: "effect:tw-tangled-kit", type: "grantEquipmentBundle", bundleId: TIDEWATCH_BUNDLES.kit, label: "Deckhand kit" },
  ],
  choices: [
    {
      id: TIDEWATCH_CHOICES.tangledPath,
      label: "Tangled path",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:tw-net-hauler", label: "Hauler", entryId: TIDEWATCH_IDS.tangledFirst },
        { id: "option:tw-steady-footing", label: "Steady footing", entryId: TIDEWATCH_IDS.backgroundFeat },
      ],
    },
  ],
  mechanics: {
    hitDie: 10,
    primaryAbilities: ["strength"],
    savingThrows: [TIDEWATCH_PROFICIENCIES.saveStrength, TIDEWATCH_PROFICIENCIES.saveConstitution],
    startingProficiencyIds: [],
    progression: [
      { level: 1, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      { level: 2, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      { level: 3, proficiencyBonus: 2, featureIds: [], choiceIds: [TIDEWATCH_CHOICES.tangledPath], resourceChanges: {} },
      { level: 4, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      { level: 5, proficiencyBonus: 3, featureIds: [], choiceIds: [], resourceChanges: {} },
    ],
    subclassLevel: 3,
    subclassIds: [TIDEWATCH_IDS.tangledFirst, TIDEWATCH_IDS.tangledSecond],
  },
});

const subclassFeature = (id: string, slug: string, name: string, classId: string, level: number, summary: string) =>
  entry({ id, slug, name, category: "class-feature", summary, mechanics: { classId, level, featureType: "subclass" } });

const subclass = (id: string, slug: string, name: string, classId: string, featureId: string, summary: string) =>
  entry({
    id,
    slug,
    name,
    category: "subclass",
    summary,
    mechanics: { classId, progression: [{ level: 3, featureIds: [featureId], choiceIds: [] }] },
  });

const subclasses: ContentEntry[] = [
  subclass(TIDEWATCH_IDS.subclassHold, "tw-standing-hold", "Standing Hold", TIDEWATCH_IDS.class, "feature:tw-standing-hold", "You give no ground at all."),
  subclass(TIDEWATCH_IDS.subclassSurge, "tw-rising-surge", "Rising Surge", TIDEWATCH_IDS.class, "feature:tw-rising-surge", "You give ground, then take it back."),
  subclass(TIDEWATCH_IDS.mirroredFirst, "tw-mirror-ebb", "Ebb", TIDEWATCH_IDS.mirroredClass, "feature:tw-mirror-ebb", "You draw back with the water."),
  subclass(TIDEWATCH_IDS.mirroredSecond, "tw-mirror-flood", "Flood", TIDEWATCH_IDS.mirroredClass, "feature:tw-mirror-flood", "You come in with the water."),
  subclass(TIDEWATCH_IDS.tangledFirst, "tw-net-hauler", "Net Hauler", TIDEWATCH_IDS.tangledClass, "feature:tw-net-hauler", "You pull the net in."),
  subclass(TIDEWATCH_IDS.tangledSecond, "tw-net-mender", "Net Mender", TIDEWATCH_IDS.tangledClass, "feature:tw-net-mender", "You keep the net whole."),
];

const features: ContentEntry[] = [
  entry({
    id: TIDEWATCH_IDS.bracedStance,
    slug: "tw-braced-stance",
    name: "Braced Stance",
    category: "class-feature",
    summary: "While you are wearing armour your stance holds a little better.",
    mechanics: { classId: TIDEWATCH_IDS.class, level: 1, featureType: "core" },
    effects: [
      {
        id: "effect:tw-held-breath",
        type: "addResource",
        resource: {
          id: TIDEWATCH_IDS.resource,
          name: "Held Breath",
          maximum: { kind: "path", path: `resource.${TIDEWATCH_IDS.resource}` },
          recharge: "short-rest",
        },
      },
      /*
       * The generic armour-dependent effect.
       *
       * It names no item and no category: it asks only whether armour is worn.
       * Before the armour-context correction this could never apply, because the
       * context reported `worn: false` unconditionally.
       */
      {
        id: "effect:tw-braced-stance-armor",
        type: "modifyArmorClass",
        operation: "add",
        value: { kind: "literal", value: TIDEWATCH_ARMOR_BONUS },
        condition: { type: "wearingArmor" },
        label: "Braced stance",
      },
    ],
  }),
  subclassFeature("feature:tw-standing-hold", "tw-standing-hold", "Standing Hold", TIDEWATCH_IDS.class, 3, "You plant and stay planted."),
  subclassFeature("feature:tw-rising-surge", "tw-rising-surge", "Rising Surge", TIDEWATCH_IDS.class, 3, "You answer the wave with your own."),
  subclassFeature("feature:tw-mirror-ebb", "tw-mirror-ebb", "Ebbing Step", TIDEWATCH_IDS.mirroredClass, 3, "You move as the water leaves."),
  subclassFeature("feature:tw-mirror-flood", "tw-mirror-flood", "Flooding Step", TIDEWATCH_IDS.mirroredClass, 3, "You move as the water returns."),
  subclassFeature("feature:tw-net-hauler", "tw-net-hauler", "Hauling Grip", TIDEWATCH_IDS.tangledClass, 3, "Your grip does not slip on wet line."),
  subclassFeature("feature:tw-net-mender", "tw-net-mender", "Mending Hands", TIDEWATCH_IDS.tangledClass, 3, "You close a tear before it opens."),
];

const species = entry({
  id: TIDEWATCH_IDS.species,
  slug: "tw-shoalfolk",
  name: "Shoalfolk",
  category: "species",
  summary: "Raised on the shifting bars where the harbour meets the open water.",
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: [TIDEWATCH_IDS.speciesTrait],
    lineageIds: [],
  },
});

const background = entry({
  id: TIDEWATCH_IDS.background,
  slug: "tw-harbour-hand",
  name: "Harbour Hand",
  category: "background",
  summary: "You worked the quayside from the first tide to the last.",
  mechanics: {
    abilityScoreChoices: { abilities: ["strength", "constitution", "wisdom"], increasePattern: [2, 1] },
    featId: TIDEWATCH_IDS.backgroundFeat,
    proficiencyIds: [],
    equipmentChoiceIds: [],
    equipmentBundleIds: [],
  },
});

const traitsAndFeats: ContentEntry[] = [
  entry({
    id: TIDEWATCH_IDS.speciesTrait,
    slug: "tw-tide-read",
    name: "Tide Read",
    category: "feat",
    summary: "You know what the water is about to do.",
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: TIDEWATCH_IDS.backgroundFeat,
    slug: "tw-steady-footing",
    name: "Steady Footing",
    category: "feat",
    summary: "A wet deck is the same as a dry one to you.",
    mechanics: { category: "origin", repeatable: false },
  }),
];

const equipment: ContentEntry[] = [
  entry({
    id: TIDEWATCH_IDS.weapon,
    slug: "tw-boarding-pike",
    name: "Boarding pike",
    category: "weapon",
    summary: "A long haft for keeping trouble at the rail.",
    mechanics: {
      category: "simple",
      usage: "melee",
      damage: { dice: "1d8", type: "piercing" },
      properties: ["reach"],
      weight: 6,
      costGp: 10,
    },
  }),
  entry({
    id: TIDEWATCH_IDS.bodyArmor,
    slug: "tw-plated-coat",
    name: "Plated coat",
    category: "armor",
    // Flat 16 with no Dexterity contribution, so the acceptance arithmetic has
    // exactly two terms: the armour and the armour-conditioned feature bonus.
    mechanics: {
      category: "heavy",
      baseArmorClass: TIDEWATCH_BODY_ARMOR_CLASS,
      dexterity: "none",
      stealthDisadvantage: true,
      weight: 55,
      costGp: 70,
    },
  }),
  entry({
    id: TIDEWATCH_IDS.shield,
    slug: "tw-round-guard",
    name: "Round guard",
    category: "armor",
    mechanics: {
      category: "shield",
      baseArmorClass: TIDEWATCH_SHIELD_ARMOR_CLASS,
      dexterity: "none",
      stealthDisadvantage: false,
      weight: 6,
      costGp: 10,
    },
  }),
  entry({
    id: TIDEWATCH_IDS.plainGear,
    slug: "tw-coiled-rope",
    name: "Coiled rope",
    category: "item",
    summary: "Fifty feet of tarred line. It protects nobody.",
    mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] },
  }),
];

const supporting: ContentEntry[] = [
  entry({
    id: TIDEWATCH_IDS.attack,
    slug: "tw-pike-thrust",
    name: "Pike Thrust",
    category: "rule",
    summary: "A braced thrust with the boarding pike.",
    mechanics: {
      kind: "action-definition",
      data: {
        actionKind: "attack",
        usage: "melee",
        ability: "strength",
        proficient: true,
        weaponId: TIDEWATCH_IDS.weapon,
        damageDice: "1d8",
        damageType: "piercing",
        range: "10 ft.",
      },
    },
  }),
  entry({
    id: TIDEWATCH_IDS.resource,
    slug: "tw-held-breath",
    name: "Held Breath",
    category: "resource",
    summary: "A moment of held effort you can spend once and then recover.",
    mechanics: { kind: "resource", data: { recharge: "short-rest" } },
  }),
  entry({
    id: "rule:tw-standard-array",
    slug: "tw-standard-array",
    name: "Standard array",
    category: "rule",
    summary: "Assign one fixed set of six base scores, then apply your origin's increases.",
    mechanics: { kind: "ability-generation", data: { method: "standard-array", scores: [...TIDEWATCH_ARRAY], label: "Standard array" } },
  }),
  entry({
    id: "rule:tw-manual",
    slug: "tw-manual",
    name: "Enter scores manually",
    category: "rule",
    summary: "Record base scores your table generated another way.",
    mechanics: { kind: "ability-generation", data: { method: "manual", label: "Enter scores manually" } },
  }),
];

export const TIDEWATCH_ENTRIES: readonly ContentEntry[] = [
  bulwark,
  mirroredTide,
  tangledNet,
  ...subclasses,
  ...features,
  species,
  background,
  ...traitsAndFeats,
  ...equipment,
  ...supporting,
  ...proficiencyEntries,
];

/** The importable document, parsed through the real schema rather than cast. */
export function tidewatchPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: TIDEWATCH_PACK_ID,
      name: "Tidewatch engine-correctness slice",
      description: "Original synthetic content that pins the hit-point, armour-context and subclass contracts.",
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
        id: TIDEWATCH_SOURCE_ID,
        name: "Tidewatch engine reference",
        abbreviation: "TER",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 40,
        enabledByDefault: true,
        campaignIds: [],
        version: VERSION,
      },
    ],
    entries: TIDEWATCH_ENTRIES,
  });
}

export const tidewatchPackJson = () => JSON.stringify(tidewatchPack());
