/**
 * The M2.1a acceptance ruleset.
 *
 * Every name, number and phrase here is original material written for this
 * repository's tests. It models no published game and reproduces no third-party
 * vocabulary. Its only job is to exercise, in one importable pack, each property
 * the real-content foundation claims:
 *
 *  1. it can be imported and turned into a selectable ruleset profile;
 *  2. a character can be created directly at level 5;
 *  3. a species trait carries its own choice;
 *  4. a background grants a proficiency automatically;
 *  5. a class offers proficiency choices;
 *  6. a subclass is chosen at an intermediate level and brings its own choices;
 *  7. a feat taken through a choice has a further nested choice of its own;
 *  8. equipment is partly automatic and partly selectable, from two sources;
 *  9. one level grants only automatic features and asks for nothing;
 * 10. one class skill option duplicates the background's automatic grant;
 * 11. a second class stops its progression short of level 5;
 * 12. a typed `ContentLink` activates an entry, honours its level and survives a cycle;
 * 13. a lineage replaces one of its parent species' traits;
 * 14. a legacy `race` origin remains selectable alongside `species`;
 * 15. two different entries grant the same equipment bundle.
 *
 * Read it as a specification of those fifteen facts, not as a game.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry, Effect } from "@/src/domain/model";

const AT = "2026-08-04T08:00:00.000Z";
const VERSION = "1.0.0";

export const ACCEPTANCE_SOURCE_ID = "source:emberline-acceptance";
export const ACCEPTANCE_PACK_ID = "pack:emberline-acceptance";
/**
 * The profile ID `rulesetIdForPack` derives from the pack.
 *
 * It keeps the pack ID whole, prefix included. Stripping the `pack:` prefix
 * made `pack:x` and `x` derive the same profile.
 */
export const ACCEPTANCE_RULESET_ID = "ruleset:pack:emberline-acceptance";

export const ACCEPTANCE_IDS = {
  class: "class:eb-beaconkeeper",
  /** A second class whose content deliberately stops at level 3. */
  shortClass: "class:eb-lamplighter",
  subclassWatch: "subclass:eb-kindled-watch",
  subclassLedger: "subclass:eb-quiet-ledger",
  species: "species:eb-cairnfolk",
  traitWithChoice: "trait:eb-cairn-sense",
  traitPlain: "trait:eb-sure-step",
  /** A lineage of the species, reached through the species' own choice. */
  lineage: "lineage:eb-deepcairn",
  /** The lineage's own trait, which stands in for the one it replaces. */
  lineageTrait: "trait:eb-deep-listening",
  /** A legacy `race` origin, to prove the older identifier still resolves. */
  legacyRace: "race:eb-hillfolk",
  /** Reached only through a required `ContentLink` on the level 5 feature. */
  linkedEcho: "feature:eb-beacon-echo",
  /** Linked at a level beyond this pack's range, so it must never activate. */
  linkedFarBeacon: "feature:eb-far-beacon",
  /** Two entries that link to each other, so a cycle has to terminate. */
  linkedCycleA: "feature:eb-mirror-a",
  linkedCycleB: "feature:eb-mirror-b",
  background: "background:eb-ferry-clerk",
  backgroundFeat: "feat:eb-clerks-eye",
  featWithChoice: "feat:eb-attentive",
  featPlain: "feat:eb-stonewise",
  resource: "resource:eb-emberlight",
  attack: "action:eb-hook-strike",
  weapon: "weapon:eb-hook-spear",
  armor: "armor:eb-quilted-coat",
} as const;

export const ACCEPTANCE_CHOICES = {
  /** Class skills; one option duplicates the background's automatic grant. */
  classSkills: "choice:eb-skills",
  /** Level 4 choice whose options are feats. */
  boon: "choice:eb-boon",
  /** The nested choice the chosen feat brings with it. */
  featFocus: "choice:eb-attentive-focus",
  /** Declared by the species trait, not by the species. */
  speciesTrait: "choice:eb-cairn-sense",
  /** Declared by one subclass, reachable only once that subclass is chosen. */
  subclassFlare: "choice:eb-kw-flare-shape",
  /**
   * Optional (`min: 0`) lineage decision declared by the species itself. It is
   * optional so a build that ignores lineages stays complete, which is what
   * lets the same pack prove both paths.
   */
  lineage: "choice:eb-cairn-lineage",
} as const;

export const ACCEPTANCE_BUNDLES = {
  classKit: "bundle:eb-warden-kit",
  backgroundKit: "bundle:eb-clerk-satchel",
  classChoice: "equipment-choice:eb-travel",
  backgroundChoice: "equipment-choice:eb-satchel",
} as const;

export const ACCEPTANCE_PROFICIENCIES = {
  saveStrength: "proficiency:eb-save-strength",
  saveWisdom: "proficiency:eb-save-wisdom",
  saveDexterity: "proficiency:eb-save-dexterity",
  /** Granted automatically by the background and offered again by the class. */
  skillSignalling: "proficiency:eb-skill-signalling",
  skillLedgerwork: "proficiency:eb-skill-ledgerwork",
  skillStonecraft: "proficiency:eb-skill-stonecraft",
  skillBeastlore: "proficiency:eb-skill-beastlore",
  skillCairnlore: "proficiency:eb-skill-cairnlore",
  skillNightwatch: "proficiency:eb-skill-nightwatch",
  skillEmberlore: "proficiency:eb-skill-emberlore",
  armorLight: "proficiency:eb-armor-light",
  weaponSimple: "proficiency:eb-weapon-simple",
  toolSignalLamp: "proficiency:eb-tool-signal-lamp",
  languageFerryCant: "proficiency:eb-language-ferry-cant",
} as const;

export const ACCEPTANCE_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];
/** Class hit-point base per level, so level 5 is a data fact, not a formula. */
export const ACCEPTANCE_HIT_POINT_BASE: Readonly<Record<number, number>> = { 1: 10, 2: 13, 3: 16, 4: 19, 5: 22 };
export const ACCEPTANCE_EMBERLIGHT: Readonly<Record<number, number>> = { 1: 2, 2: 3, 3: 3, 4: 4, 5: 4 };

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: ACCEPTANCE_SOURCE_ID,
  sourceLocator: { sourceId: ACCEPTANCE_SOURCE_ID, page: "1", section: "Acceptance slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 30, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "emberline-acceptance"],
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
    tags: ability
      ? ["synthetic", "emberline-acceptance", `ability:${ability}`]
      : ["synthetic", "emberline-acceptance"],
  });

const grant = (proficiencyId: string): Effect => ({
  id: `effect:grant-${proficiencyId}`,
  type: "grantProficiency",
  proficiencyId,
});

const classFeature = (id: string, slug: string, name: string, level: number, summary: string, extra: Partial<ContentEntry> = {}) =>
  entry({
    id,
    slug,
    name,
    category: "class-feature",
    summary,
    mechanics: { classId: ACCEPTANCE_IDS.class, level, featureType: "core" },
    ...extra,
  });

const proficiencyEntries: ContentEntry[] = [
  proficiency(ACCEPTANCE_PROFICIENCIES.saveStrength, "eb-save-strength", "Strength save", "save", "strength", "strength"),
  proficiency(ACCEPTANCE_PROFICIENCIES.saveWisdom, "eb-save-wisdom", "Wisdom save", "save", "wisdom", "wisdom"),
  proficiency(ACCEPTANCE_PROFICIENCIES.saveDexterity, "eb-save-dexterity", "Dexterity save", "save", "dexterity", "dexterity"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillSignalling, "eb-skill-signalling", "Signalling", "skill", "signalling", "wisdom"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillLedgerwork, "eb-skill-ledgerwork", "Ledgerwork", "skill", "ledgerwork", "intelligence"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillStonecraft, "eb-skill-stonecraft", "Stonecraft", "skill", "stonecraft", "strength"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillBeastlore, "eb-skill-beastlore", "Beastlore", "skill", "beastlore", "wisdom"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillCairnlore, "eb-skill-cairnlore", "Cairnlore", "skill", "cairnlore", "intelligence"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillNightwatch, "eb-skill-nightwatch", "Nightwatch", "skill", "nightwatch", "wisdom"),
  proficiency(ACCEPTANCE_PROFICIENCIES.skillEmberlore, "eb-skill-emberlore", "Emberlore", "skill", "emberlore", "intelligence"),
  proficiency(ACCEPTANCE_PROFICIENCIES.armorLight, "eb-armor-light", "Light coats", "armor", "light"),
  proficiency(ACCEPTANCE_PROFICIENCIES.weaponSimple, "eb-weapon-simple", "Simple hafted weapons", "weapon", "simple"),
  proficiency(ACCEPTANCE_PROFICIENCIES.toolSignalLamp, "eb-tool-signal-lamp", "Signal lamp", "tool", "signal-lamp"),
  proficiency(ACCEPTANCE_PROFICIENCIES.languageFerryCant, "eb-language-ferry-cant", "Ferry Cant", "language", "ferry-cant"),
];

/** Levels 1 to 5, so creating directly at 5 is reading data rather than guessing. */
const hitPointBaseEffect: Effect = {
  id: "effect:eb-hit-point-base",
  type: "scaleAtLevel",
  scope: "class",
  classId: ACCEPTANCE_IDS.class,
  target: "hitPoints.classBase",
  levels: Object.fromEntries(
    Object.entries(ACCEPTANCE_HIT_POINT_BASE).map(([level, base]) => [level, { kind: "literal", value: base }]),
  ),
  label: "Beaconkeeper hit points",
};

const beaconkeeper = entry({
  id: ACCEPTANCE_IDS.class,
  slug: "eb-beaconkeeper",
  name: "Beaconkeeper",
  category: "class",
  summary: "Keeps a crossing lit and the people using it counted.",
  effects: [
    hitPointBaseEffect,
    { id: "effect:eb-warden-kit", type: "grantEquipmentBundle", bundleId: ACCEPTANCE_BUNDLES.classKit, label: "Warden kit" },
  ],
  equipmentBundles: [
    {
      id: ACCEPTANCE_BUNDLES.classKit,
      label: "Warden kit",
      entries: [
        { type: "item", itemId: ACCEPTANCE_IDS.weapon, quantity: 1, status: "equipped" },
        { type: "item", itemId: ACCEPTANCE_IDS.armor, quantity: 1, status: "equipped" },
        {
          type: "choice",
          id: ACCEPTANCE_BUNDLES.classChoice,
          label: "Travelling gear",
          min: 1,
          max: 1,
          options: [
            { id: "equipment-option:eb-ledger-case", label: "Ledger case", entries: [{ type: "item", itemId: "item:eb-ledger-case", quantity: 1, status: "carried" }] },
            { id: "equipment-option:eb-lamp-kit", label: "Lamp kit", entries: [{ type: "item", itemId: "item:eb-lamp-kit", quantity: 1, status: "carried" }] },
          ],
        },
      ],
    },
  ],
  choices: [
    {
      id: ACCEPTANCE_CHOICES.classSkills,
      label: "Beaconkeeper skills",
      min: 2,
      max: 2,
      repeatable: false,
      options: [
        // Signalling is deliberately also the background's automatic grant, so
        // the duplicate-selection path has something real to detect.
        { id: `option:${ACCEPTANCE_PROFICIENCIES.skillSignalling}`, label: "Signalling", effects: [grant(ACCEPTANCE_PROFICIENCIES.skillSignalling)] },
        { id: `option:${ACCEPTANCE_PROFICIENCIES.skillLedgerwork}`, label: "Ledgerwork", effects: [grant(ACCEPTANCE_PROFICIENCIES.skillLedgerwork)] },
        { id: `option:${ACCEPTANCE_PROFICIENCIES.skillStonecraft}`, label: "Stonecraft", effects: [grant(ACCEPTANCE_PROFICIENCIES.skillStonecraft)] },
        { id: `option:${ACCEPTANCE_PROFICIENCIES.skillBeastlore}`, label: "Beastlore", effects: [grant(ACCEPTANCE_PROFICIENCIES.skillBeastlore)] },
      ],
    },
    {
      id: ACCEPTANCE_CHOICES.boon,
      label: "Beacon boon",
      min: 1,
      max: 1,
      repeatable: false,
      // Both options are feats. One of them declares a further choice, which the
      // builder must discover only once that option is actually selected.
      options: [
        { id: "option:eb-attentive", label: "Attentive Clerk", entryId: ACCEPTANCE_IDS.featWithChoice },
        { id: "option:eb-stonewise", label: "Stonewise", entryId: ACCEPTANCE_IDS.featPlain },
      ],
    },
  ],
  mechanics: {
    hitDie: 10,
    primaryAbilities: ["strength"],
    savingThrows: [ACCEPTANCE_PROFICIENCIES.saveStrength, ACCEPTANCE_PROFICIENCIES.saveWisdom],
    startingProficiencyIds: [ACCEPTANCE_PROFICIENCIES.armorLight, ACCEPTANCE_PROFICIENCIES.weaponSimple],
    progression: [
      {
        level: 1,
        proficiencyBonus: 2,
        featureIds: ["feature:eb-hold-the-light"],
        choiceIds: [ACCEPTANCE_CHOICES.classSkills],
        resourceChanges: { [ACCEPTANCE_IDS.resource]: ACCEPTANCE_EMBERLIGHT[1] },
      },
      {
        // The level that asks for nothing: automatic features only.
        level: 2,
        proficiencyBonus: 2,
        featureIds: ["feature:eb-steady-hand"],
        choiceIds: [],
        resourceChanges: { [ACCEPTANCE_IDS.resource]: ACCEPTANCE_EMBERLIGHT[2] },
      },
      {
        level: 3,
        proficiencyBonus: 2,
        featureIds: ["feature:eb-warden-path"],
        choiceIds: [],
        resourceChanges: { [ACCEPTANCE_IDS.resource]: ACCEPTANCE_EMBERLIGHT[3] },
      },
      {
        level: 4,
        proficiencyBonus: 2,
        featureIds: ["feature:eb-refinement"],
        choiceIds: [ACCEPTANCE_CHOICES.boon],
        resourceChanges: { [ACCEPTANCE_IDS.resource]: ACCEPTANCE_EMBERLIGHT[4] },
      },
      {
        level: 5,
        proficiencyBonus: 3,
        featureIds: ["feature:eb-second-beacon"],
        choiceIds: [],
        resourceChanges: { [ACCEPTANCE_IDS.resource]: ACCEPTANCE_EMBERLIGHT[5] },
      },
    ],
    // Chosen partway through the covered range, not at level 1 and not beyond 5.
    subclassLevel: 3,
    subclassIds: [ACCEPTANCE_IDS.subclassWatch, ACCEPTANCE_IDS.subclassLedger],
  },
});

/** A second class that stops at level 3, to exercise the coverage guard. */
const lamplighter = entry({
  id: ACCEPTANCE_IDS.shortClass,
  slug: "eb-lamplighter",
  name: "Lamplighter",
  category: "class",
  summary: "Walks the lamps at dusk. This pack describes only the first three levels.",
  effects: [
    {
      id: "effect:eb-lamplighter-hit-point-base",
      type: "scaleAtLevel",
      scope: "class",
      classId: ACCEPTANCE_IDS.shortClass,
      target: "hitPoints.classBase",
      levels: { 1: { kind: "literal", value: 8 }, 2: { kind: "literal", value: 10 }, 3: { kind: "literal", value: 12 } },
    },
  ],
  mechanics: {
    hitDie: 8,
    primaryAbilities: ["dexterity"],
    savingThrows: [ACCEPTANCE_PROFICIENCIES.saveDexterity, ACCEPTANCE_PROFICIENCIES.saveWisdom],
    startingProficiencyIds: [ACCEPTANCE_PROFICIENCIES.armorLight],
    progression: [
      { level: 1, proficiencyBonus: 2, featureIds: ["feature:eb-ll-spark"], choiceIds: [], resourceChanges: {} },
      { level: 2, proficiencyBonus: 2, featureIds: ["feature:eb-ll-wick"], choiceIds: [], resourceChanges: {} },
      { level: 3, proficiencyBonus: 2, featureIds: ["feature:eb-ll-glow"], choiceIds: [], resourceChanges: {} },
    ],
    subclassLevel: 3,
    subclassIds: [],
  },
});

const features: ContentEntry[] = [
  classFeature("feature:eb-hold-the-light", "eb-hold-the-light", "Hold the Light", 1, "Steady the lamp and the people behind it.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 1, featureType: "resource" },
    effects: [
      {
        id: "effect:eb-emberlight",
        type: "addResource",
        resource: {
          id: ACCEPTANCE_IDS.resource,
          name: "Emberlight",
          maximum: { kind: "path", path: `resource.${ACCEPTANCE_IDS.resource}` },
          recharge: "short-rest",
        },
      },
      { id: "effect:eb-hook-strike", type: "addAttack", definitionId: ACCEPTANCE_IDS.attack },
    ],
  }),
  classFeature("feature:eb-steady-hand", "eb-steady-hand", "Steady Hand", 2, "Second-level drill: your grip no longer wavers on a wet deck.", {
    // A required link with no level of its own is due as soon as its owner is.
    links: [{ type: "feature", targetId: ACCEPTANCE_IDS.linkedCycleA, required: true }],
  }),
  classFeature("feature:eb-warden-path", "eb-warden-path", "Warden's Path", 3, "You commit to how you keep your crossing.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 3, featureType: "subclass" },
  }),
  classFeature("feature:eb-refinement", "eb-refinement", "Refinement", 4, "Practice sharpens one habit into a lasting one.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 4, featureType: "improvement" },
  }),
  classFeature("feature:eb-second-beacon", "eb-second-beacon", "Second Beacon", 5, "You can keep a second light burning.", {
    // Two typed links from one entry: one due at level 5, one at a level this
    // pack never reaches. Only the first may ever activate.
    links: [
      { type: "feature", targetId: ACCEPTANCE_IDS.linkedEcho, required: true, level: 5 },
      { type: "feature", targetId: ACCEPTANCE_IDS.linkedFarBeacon, required: true, level: 7 },
    ],
  }),
  classFeature("feature:eb-beacon-echo", "eb-beacon-echo", "Beacon Echo", 5, "The second light answers the first."),
  classFeature("feature:eb-far-beacon", "eb-far-beacon", "Far Beacon", 7, "A light for a crossing this pack does not describe."),
  // A link cycle. Traversal has to terminate and activate each entry once.
  classFeature("feature:eb-mirror-a", "eb-mirror-a", "Mirror Signal", 1, "You bounce your light off the far bank.", {
    links: [{ type: "feature", targetId: ACCEPTANCE_IDS.linkedCycleB, required: true }],
  }),
  classFeature("feature:eb-mirror-b", "eb-mirror-b", "Answering Mirror", 1, "The far bank answers.", {
    links: [{ type: "feature", targetId: ACCEPTANCE_IDS.linkedCycleA, required: true }],
  }),
  classFeature("feature:eb-kw-flare", "eb-kw-flare", "Signal Flare", 3, "Your light can be seen from the far bank.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 3, featureType: "subclass" },
  }),
  classFeature("feature:eb-kw-brighter", "eb-kw-brighter", "Brighter Still", 5, "The flare carries further.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 5, featureType: "subclass" },
  }),
  classFeature("feature:eb-ql-margin", "eb-ql-margin", "Margin Note", 3, "You keep a private column no one else reads.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 3, featureType: "subclass" },
  }),
  classFeature("feature:eb-ql-audit", "eb-ql-audit", "Quiet Audit", 5, "You reconcile the day without saying a word.", {
    mechanics: { classId: ACCEPTANCE_IDS.class, level: 5, featureType: "subclass" },
  }),
  entry({
    id: "feature:eb-ll-spark",
    slug: "eb-ll-spark",
    name: "Spark",
    category: "class-feature",
    summary: "You never lack a light.",
    mechanics: { classId: ACCEPTANCE_IDS.shortClass, level: 1, featureType: "core" },
  }),
  entry({
    id: "feature:eb-ll-wick",
    slug: "eb-ll-wick",
    name: "Trimmed Wick",
    category: "class-feature",
    summary: "Your lamps burn longer than anyone else's.",
    mechanics: { classId: ACCEPTANCE_IDS.shortClass, level: 2, featureType: "core" },
  }),
  entry({
    id: "feature:eb-ll-glow",
    slug: "eb-ll-glow",
    name: "Afterglow",
    category: "class-feature",
    summary: "The last light of your round lingers.",
    mechanics: { classId: ACCEPTANCE_IDS.shortClass, level: 3, featureType: "core" },
  }),
];

const subclasses: ContentEntry[] = [
  entry({
    id: ACCEPTANCE_IDS.subclassWatch,
    slug: "eb-kindled-watch",
    name: "Kindled Watch",
    category: "subclass",
    summary: "You keep the loudest light on the river.",
    choices: [
      {
        id: ACCEPTANCE_CHOICES.subclassFlare,
        label: "Flare shape",
        min: 1,
        max: 1,
        repeatable: false,
        options: [
          {
            id: "option:eb-flare-wide",
            label: "Wide flare",
            effects: [grant(ACCEPTANCE_PROFICIENCIES.skillEmberlore)],
          },
          {
            id: "option:eb-flare-narrow",
            label: "Narrow flare",
            effects: [
              {
                id: "effect:eb-flare-narrow",
                type: "modifyInitiative",
                operation: "add",
                value: { kind: "literal", value: 1 },
                label: "Narrow flare",
              },
            ],
          },
        ],
      },
    ],
    mechanics: {
      classId: ACCEPTANCE_IDS.class,
      progression: [
        { level: 3, featureIds: ["feature:eb-kw-flare"], choiceIds: [ACCEPTANCE_CHOICES.subclassFlare] },
        { level: 5, featureIds: ["feature:eb-kw-brighter"], choiceIds: [] },
      ],
    },
  }),
  entry({
    id: ACCEPTANCE_IDS.subclassLedger,
    slug: "eb-quiet-ledger",
    name: "Quiet Ledger",
    category: "subclass",
    summary: "You keep the most accurate book on the river.",
    mechanics: {
      classId: ACCEPTANCE_IDS.class,
      progression: [
        { level: 3, featureIds: ["feature:eb-ql-margin"], choiceIds: [] },
        { level: 5, featureIds: ["feature:eb-ql-audit"], choiceIds: [] },
      ],
    },
  }),
];

const species = entry({
  id: ACCEPTANCE_IDS.species,
  slug: "eb-cairnfolk",
  name: "Cairnfolk",
  category: "species",
  summary: "Raised among stacked waymarkers on the high crossings.",
  // The lineage is a decision the species declares. Choosing it is what makes
  // the lineage active, so nothing is activated by the mere existence of a
  // `lineageIds` entry.
  choices: [
    {
      id: ACCEPTANCE_CHOICES.lineage,
      label: "Cairnfolk lineage",
      min: 0,
      max: 1,
      repeatable: false,
      options: [{ id: "option:eb-deepcairn", label: "Deepcairn", entryId: ACCEPTANCE_IDS.lineage }],
    },
  ],
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: [ACCEPTANCE_IDS.traitWithChoice, ACCEPTANCE_IDS.traitPlain],
    lineageIds: [ACCEPTANCE_IDS.lineage],
  },
});

/**
 * A lineage that swaps one inherited trait for its own.
 *
 * `replacesTraitIds` names Sure Step, which the parent species grants. A build
 * that takes this lineage must end up with Deep Listening and not with Sure
 * Step: holding both would give the character two traits where the content
 * describes one.
 */
const lineage = entry({
  id: ACCEPTANCE_IDS.lineage,
  slug: "eb-deepcairn",
  name: "Deepcairn",
  category: "lineage",
  summary: "Cairnfolk raised below the waterline, where footing matters less than hearing.",
  mechanics: {
    parentSpeciesIds: [ACCEPTANCE_IDS.species],
    traitIds: [ACCEPTANCE_IDS.lineageTrait],
    replacesTraitIds: [ACCEPTANCE_IDS.traitPlain],
  },
});

/**
 * A legacy `race` origin.
 *
 * The category predates `species` and is still in the public schema, so an
 * origin recorded under it has to remain selectable and has to activate its
 * traits by the same rules. Nothing here is matched by name.
 */
const legacyRace = entry({
  id: ACCEPTANCE_IDS.legacyRace,
  slug: "eb-hillfolk",
  name: "Hillfolk",
  category: "race",
  summary: "An older way of writing an origin, kept so existing records keep resolving.",
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: [ACCEPTANCE_IDS.traitPlain],
    legacyAbilityScores: { strength: 1 },
  },
});

const speciesTraits: ContentEntry[] = [
  entry({
    id: ACCEPTANCE_IDS.traitWithChoice,
    slug: "eb-cairn-sense",
    name: "Cairn Sense",
    category: "feat",
    summary: "You read the waymarkers others walk past.",
    // The choice belongs to the trait, not to the species. Discovering it means
    // walking from species to trait to choice, which is the point.
    choices: [
      {
        id: ACCEPTANCE_CHOICES.speciesTrait,
        label: "Cairn Sense focus",
        min: 1,
        max: 1,
        repeatable: false,
        options: [
          { id: `option:${ACCEPTANCE_PROFICIENCIES.skillCairnlore}`, label: "Cairnlore", effects: [grant(ACCEPTANCE_PROFICIENCIES.skillCairnlore)] },
          { id: `option:${ACCEPTANCE_PROFICIENCIES.skillNightwatch}`, label: "Nightwatch", effects: [grant(ACCEPTANCE_PROFICIENCIES.skillNightwatch)] },
        ],
      },
    ],
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: ACCEPTANCE_IDS.traitPlain,
    slug: "eb-sure-step",
    name: "Sure Step",
    category: "feat",
    summary: "Loose scree does not slow you.",
    mechanics: { category: "other", repeatable: false },
  }),
  entry({
    id: ACCEPTANCE_IDS.lineageTrait,
    slug: "eb-deep-listening",
    name: "Deep Listening",
    category: "feat",
    summary: "You hear the river through the stone before you see it.",
    mechanics: { category: "other", repeatable: false },
  }),
];

const background = entry({
  id: ACCEPTANCE_IDS.background,
  slug: "eb-ferry-clerk",
  name: "Ferry Clerk",
  category: "background",
  summary: "You counted every crossing and signalled every delay.",
  equipmentBundles: [
    {
      id: ACCEPTANCE_BUNDLES.backgroundKit,
      label: "Clerk's satchel",
      entries: [
        { type: "item", itemId: "item:eb-tally-sticks", quantity: 1, status: "carried" },
        {
          type: "choice",
          id: ACCEPTANCE_BUNDLES.backgroundChoice,
          label: "Marking set",
          min: 1,
          max: 1,
          options: [
            { id: "equipment-option:eb-ink-set", label: "Ink set", entries: [{ type: "item", itemId: "item:eb-ink-set", quantity: 1, status: "carried" }] },
            { id: "equipment-option:eb-chalk-set", label: "Chalk set", entries: [{ type: "item", itemId: "item:eb-chalk-set", quantity: 1, status: "carried" }] },
          ],
        },
      ],
    },
  ],
  mechanics: {
    abilityScoreChoices: { abilities: ["strength", "wisdom", "constitution"], increasePattern: [2, 1] },
    featId: ACCEPTANCE_IDS.backgroundFeat,
    // Automatic, with no decision. The class offers the same skill as a choice.
    proficiencyIds: [ACCEPTANCE_PROFICIENCIES.skillSignalling],
    equipmentChoiceIds: [],
    equipmentBundleIds: [ACCEPTANCE_BUNDLES.backgroundKit],
  },
});

const feats: ContentEntry[] = [
  entry({
    id: ACCEPTANCE_IDS.backgroundFeat,
    slug: "eb-clerks-eye",
    name: "Clerk's Eye",
    category: "feat",
    summary: "A miscount never gets past you twice.",
    mechanics: { category: "origin", repeatable: false },
  }),
  entry({
    id: ACCEPTANCE_IDS.featWithChoice,
    slug: "eb-attentive",
    name: "Attentive Clerk",
    category: "feat",
    summary: "Your attention settles on one craft in particular.",
    // Reachable only through the level 4 boon choice, and only once selected.
    choices: [
      {
        id: ACCEPTANCE_CHOICES.featFocus,
        label: "Attentive focus",
        min: 1,
        max: 1,
        repeatable: false,
        options: [
          { id: `option:${ACCEPTANCE_PROFICIENCIES.toolSignalLamp}`, label: "Signal lamp", effects: [grant(ACCEPTANCE_PROFICIENCIES.toolSignalLamp)] },
          { id: `option:${ACCEPTANCE_PROFICIENCIES.languageFerryCant}`, label: "Ferry Cant", effects: [grant(ACCEPTANCE_PROFICIENCIES.languageFerryCant)] },
        ],
      },
    ],
    mechanics: { category: "general", repeatable: false },
  }),
  entry({
    id: ACCEPTANCE_IDS.featPlain,
    slug: "eb-stonewise",
    name: "Stonewise",
    category: "feat",
    summary: "You know which stones will hold.",
    // Deliberately grants the same bundle the background already grants. Two
    // sources, one bundle: Review must state the contents once and still name
    // both sources.
    effects: [
      {
        id: "effect:eb-stonewise-satchel",
        type: "grantEquipmentBundle",
        bundleId: ACCEPTANCE_BUNDLES.backgroundKit,
        label: "Clerk's satchel",
      },
    ],
    mechanics: { category: "general", repeatable: false },
  }),
];

const equipment: ContentEntry[] = [
  entry({
    id: ACCEPTANCE_IDS.weapon,
    slug: "eb-hook-spear",
    name: "Hook spear",
    category: "weapon",
    summary: "A long haft with a hooked head, for boats and for trouble.",
    mechanics: {
      category: "simple",
      usage: "melee",
      damage: { dice: "1d8", type: "piercing" },
      properties: ["reach"],
      weight: 5,
      costGp: 12,
    },
  }),
  entry({
    id: ACCEPTANCE_IDS.armor,
    slug: "eb-quilted-coat",
    name: "Quilted coat",
    category: "armor",
    summary: "Layered river cloth, warm and quietly protective.",
    mechanics: { category: "light", baseArmorClass: 12, dexterity: "full", stealthDisadvantage: false, weight: 8, costGp: 20 },
  }),
  entry({ id: "item:eb-ledger-case", slug: "eb-ledger-case", name: "Ledger case", category: "item", summary: "A hard case for the day's book.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  entry({ id: "item:eb-lamp-kit", slug: "eb-lamp-kit", name: "Lamp kit", category: "item", summary: "Wicks, oil and a spare glass.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  entry({ id: "item:eb-tally-sticks", slug: "eb-tally-sticks", name: "Tally sticks", category: "item", summary: "A bundle of notched crossing tallies.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  entry({ id: "item:eb-ink-set", slug: "eb-ink-set", name: "Ink set", category: "item", summary: "Iron-gall ink and two nibs.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
  entry({ id: "item:eb-chalk-set", slug: "eb-chalk-set", name: "Chalk set", category: "item", summary: "Chalks that survive a wet morning.", mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] } }),
];

const supporting: ContentEntry[] = [
  entry({
    id: ACCEPTANCE_IDS.attack,
    slug: "eb-hook-strike",
    name: "Hook Strike",
    category: "rule",
    summary: "A braced thrust with the hook spear.",
    mechanics: {
      kind: "action-definition",
      data: {
        actionKind: "attack",
        usage: "melee",
        ability: "strength",
        proficient: true,
        weaponId: ACCEPTANCE_IDS.weapon,
        damageDice: "1d8",
        damageType: "piercing",
        range: "10 ft.",
      },
    },
  }),
  entry({
    id: ACCEPTANCE_IDS.resource,
    slug: "eb-emberlight",
    name: "Emberlight",
    category: "resource",
    summary: "Banked warmth you can spend to steady someone. Returns on a short rest.",
    mechanics: { kind: "resource", data: { recharge: "short-rest" } },
  }),
  entry({
    id: "rule:eb-standard-array",
    slug: "eb-standard-array",
    name: "Standard array",
    category: "rule",
    summary: "Assign one fixed set of six base scores, then apply your origin's increases.",
    mechanics: { kind: "ability-generation", data: { method: "standard-array", scores: [...ACCEPTANCE_ARRAY], label: "Standard array" } },
  }),
  entry({
    id: "rule:eb-manual",
    slug: "eb-manual",
    name: "Enter scores manually",
    category: "rule",
    summary: "Record base scores your table generated another way.",
    mechanics: { kind: "ability-generation", data: { method: "manual", label: "Enter scores manually" } },
  }),
];

export const ACCEPTANCE_ENTRIES: readonly ContentEntry[] = [
  beaconkeeper,
  lamplighter,
  ...features,
  ...subclasses,
  species,
  lineage,
  legacyRace,
  ...speciesTraits,
  background,
  ...feats,
  ...equipment,
  ...supporting,
  ...proficiencyEntries,
];

/**
 * The importable document.
 *
 * Parsed through the real content-pack schema rather than cast, so the fixture
 * cannot drift out of schema and silently stop proving anything.
 */
export function acceptancePack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: ACCEPTANCE_PACK_ID,
      name: "Emberline acceptance slice",
      description: "Original synthetic content covering levels 1 to 5 for one class and 1 to 3 for another.",
      version: VERSION,
      // Honest: one class stops at level 3, so this is not a complete source.
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
        id: ACCEPTANCE_SOURCE_ID,
        name: "Emberline acceptance reference",
        abbreviation: "EAR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 30,
        enabledByDefault: true,
        campaignIds: [],
        version: VERSION,
      },
    ],
    entries: ACCEPTANCE_ENTRIES,
  });
}

/** The pack as one JSON document, for the import pipeline. */
export const acceptancePackJson = () => JSON.stringify(acceptancePack());

export const COLLISION_PACK_ID = "pack:emberline-collision";
export const COLLISION_CLASS_ID = "class:eb-tollkeeper";

/**
 * An adversarial pack that deliberately reuses an installed source ID.
 *
 * It declares no source of its own; every entry sits on the acceptance pack's
 * source, which the pipeline accepts because that source is already installed.
 * A profile that decides membership by source would therefore activate this
 * pack's class inside the *acceptance* ruleset — content the user never added to
 * that ruleset, appearing in the builder of a character built against it.
 *
 * The pack is otherwise ordinary and importable. That is the point: nothing
 * about it is malformed, so nothing but explicit entry-identity membership stops
 * it widening the other profile's scope.
 */
export function sourceCollisionPack(): ContentPackDocument {
  const tollkeeper = entry({
    id: COLLISION_CLASS_ID,
    slug: "eb-tollkeeper",
    name: "Tollkeeper",
    category: "class",
    summary: "Counts what crosses and takes a cut. Belongs to a different pack entirely.",
    mechanics: {
      hitDie: 8,
      primaryAbilities: ["charisma"],
      savingThrows: [ACCEPTANCE_PROFICIENCIES.saveDexterity, ACCEPTANCE_PROFICIENCIES.saveWisdom],
      startingProficiencyIds: [],
      progression: [{ level: 1, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} }],
      subclassLevel: 3,
      subclassIds: [],
    },
  });
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: COLLISION_PACK_ID,
      name: "Emberline collision probe",
      description: "Original synthetic content that reuses an installed source ID on purpose.",
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
    // No sources of its own: the entries point at the already-installed one.
    sources: [],
    entries: [tollkeeper],
  });
}

export const sourceCollisionPackJson = () => JSON.stringify(sourceCollisionPack());

/* -------------------------------------------------------------------------- */
/* A dependent pack, so two installed profiles can genuinely overlap           */
/* -------------------------------------------------------------------------- */

export const OVERLAP_PACK_ID = "pack:emberline-overlap";
export const OVERLAP_SOURCE_ID = "source:emberline-overlap";
/** The profile `rulesetIdForPack` derives for the dependent pack. */
export const OVERLAP_RULESET_ID = "ruleset:pack:emberline-overlap";
export const OVERLAP_BACKGROUND_ID = "background:eb-lampwright";

/**
 * A pack that adds one background and depends on the acceptance pack.
 *
 * This exists so a test can switch a draft between two rulesets that share
 * content. Every other fixture pair is disjoint, which makes "the ruleset ID
 * changed" and "this value is no longer valid" indistinguishable — exactly the
 * confusion the per-value change contract exists to resolve. Because membership
 * is `packEntries + dependencyEntries`, this profile resolves every acceptance
 * entry *and* its own, so a class chosen under the acceptance profile is still a
 * real class here.
 */
export function overlapPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: OVERLAP_PACK_ID,
      name: "Emberline overlap addition",
      description: "Original synthetic add-on that depends on the acceptance slice and adds one background.",
      version: VERSION,
      coverage: "partial",
      rulesEditions: ["homebrew"],
      visibility: "public",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: false,
      dependencies: [ACCEPTANCE_PACK_ID],
      optionalDependencies: [],
    },
    sources: [
      {
        id: OVERLAP_SOURCE_ID,
        name: "Emberline overlap reference",
        abbreviation: "EOR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 31,
        enabledByDefault: true,
        campaignIds: [],
        version: VERSION,
      },
    ],
    entries: [
      {
        id: OVERLAP_BACKGROUND_ID,
        slug: "eb-lampwright",
        name: "Lampwright",
        aliases: [],
        category: "background",
        rulesEdition: "homebrew",
        sourceId: OVERLAP_SOURCE_ID,
        sourceLocator: { sourceId: OVERLAP_SOURCE_ID, page: "1", section: "Overlap addition" },
        reviewStatus: "engine-verified",
        licenseType: "original",
        visibility: "public-original",
        summary: "You keep the lamps burning along the crossing.",
        prerequisites: [],
        choices: [],
        equipmentBundles: [],
        effects: [],
        links: [],
        mechanics: {
          abilityScoreChoices: { abilities: ["dexterity", "intelligence"], increasePattern: [2, 1] },
          featId: ACCEPTANCE_IDS.featPlain,
          proficiencyIds: [ACCEPTANCE_PROFICIENCIES.skillEmberlore],
          equipmentChoiceIds: [],
          equipmentBundleIds: [],
        },
        conflict: { sourcePriority: 31, conflictKey: OVERLAP_BACKGROUND_ID, resolution: "source-priority" },
        tags: ["synthetic", "emberline-overlap"],
        version: VERSION,
        revision: 1,
        editionRelations: [],
        legacy: false,
        optional: false,
        private: false,
        exportRestricted: false,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
  });
}

export const overlapPackJson = () => JSON.stringify(overlapPack());
