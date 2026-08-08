/**
 * A ruleset whose class asks two genuinely large questions.
 *
 * Physical testing found Weapon Mastery and the level-based ability-score
 * improvement hard to scan, because a generic class choice renders every
 * possibility it has at once. Neither surface can be reproduced from the content
 * this repository ships: the built-in synthetic slice's weapon-mastery choice
 * offers a single option, and no public fixture schedules an improvement at
 * level 4. So the shapes are rebuilt here, in original material, at the sizes
 * that actually caused the problem.
 *
 * Two decisions, deliberately different from each other:
 *
 * - **Tideworn mastery**, at level 2, picks two of twelve — a multi-pick
 *   decision, so the summary has to track a partial answer rather than just
 *   "done" or "not done".
 * - **Seasoned training**, at level 4, picks one of ten — the shape of a
 *   level-based ability-score improvement: reached only by a build created at or
 *   above that level, and a single pick from a long list.
 *
 * A third, small decision (**Watch stance**, two options) is here as the
 * control. It must keep rendering as a plain list, because the disclosure is
 * keyed on how many options a decision has and nothing else. If a change ever
 * makes the app collapse that one too, a test here fails.
 *
 * Every name, number and effect is original material written for these tests.
 * Nothing here is transcribed from, or named after, any published rulebook.
 */
import type { ContentEntry, Effect } from "@/src/domain/model";
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";

const AT = "2026-08-08T09:00:00.000Z";
const VERSION = "1.0.0";

export const LARGE_SOURCE_ID = "source:tideworn-scan";
export const LARGE_PACK_ID = "pack:tideworn-scan";
export const LARGE_PACK_NAME = "Tideworn scanning slice";
export const LARGE_RULESET_ID = `ruleset:${LARGE_PACK_ID}`;

export const LARGE_IDS = {
  class: "class:tw-tidewarden",
  species: "species:tw-quaymark",
  background: "background:tw-lamp-tender",
} as const;

export const LARGE_CHOICES = {
  /** Twelve options, choose two: the weapon-mastery shape. */
  mastery: "choice:tw-tideworn-mastery",
  /** Ten options, choose one, reached at level 4: the improvement shape. */
  training: "choice:tw-seasoned-training",
  /** Two options: the small control that must not be collapsed. */
  stance: "choice:tw-watch-stance",
} as const;

/** How many options each large decision carries, asserted by the tests. */
export const MASTERY_OPTION_COUNT = 12;
export const TRAINING_OPTION_COUNT = 10;
export const MASTERY_PICKS = 2;

export const MASTERY_LABELS: readonly string[] = [
  "Backwash",
  "Bracewater",
  "Chainpull",
  "Driftcut",
  "Ebbstep",
  "Floodguard",
  "Gullwing",
  "Harbourlock",
  "Keelbite",
  "Lanternsweep",
  "Moorfast",
  "Netcast",
];

export const TRAINING_LABELS: readonly string[] = [
  "Anchorheart",
  "Beaconsight",
  "Cordwise",
  "Deepbreath",
  "Ferrywise",
  "Gale-Footed",
  "Hookhand",
  "Ironwrist",
  "Jettyborn",
  "Kelpreader",
];

export const LARGE_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: LARGE_SOURCE_ID,
  sourceLocator: { sourceId: LARGE_SOURCE_ID, page: "1", section: "Scanning slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 30, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "tideworn-scan"],
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

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const grant = (proficiencyId: string): Effect => ({
  id: `effect:grant-${proficiencyId}`,
  type: "grantProficiency",
  proficiencyId,
});

/**
 * Each option grants a distinct proficiency, so a selection is observable in
 * the resulting character rather than only in the draft.
 */
const proficiencyFor = (group: string, label: string) => `proficiency:tw-${group}-${slug(label)}`;

const proficiencyEntries: ContentEntry[] = [
  ...MASTERY_LABELS.map(label =>
    entry({
      id: proficiencyFor("mastery", label),
      slug: `tw-mastery-${slug(label)}`,
      name: `${label} technique`,
      category: "proficiency",
      mechanics: { type: "weapon", key: `tw-mastery-${slug(label)}` },
    }),
  ),
  ...TRAINING_LABELS.map(label =>
    entry({
      id: proficiencyFor("training", label),
      slug: `tw-training-${slug(label)}`,
      name: `${label} training`,
      category: "proficiency",
      mechanics: { type: "skill", key: `tw-training-${slug(label)}` },
    }),
  ),
  entry({
    id: "proficiency:tw-save-strength",
    slug: "tw-save-strength",
    name: "Strength save",
    category: "proficiency",
    mechanics: { type: "save", key: "strength" },
  }),
  entry({
    id: "proficiency:tw-save-constitution",
    slug: "tw-save-constitution",
    name: "Constitution save",
    category: "proficiency",
    mechanics: { type: "save", key: "constitution" },
  }),
  entry({
    id: "proficiency:tw-armor-light",
    slug: "tw-armor-light",
    name: "Light armour",
    category: "proficiency",
    mechanics: { type: "armor", key: "light" },
  }),
];

const optionsFor = (group: string, labels: readonly string[]) =>
  labels.map(label => ({
    id: `option:tw-${group}-${slug(label)}`,
    label,
    effects: [grant(proficiencyFor(group, label))],
  }));

const features: ContentEntry[] = [
  entry({
    id: "feature:tw-tide-watch",
    slug: "tw-tide-watch",
    name: "Tide Watch",
    category: "class-feature",
    summary: "You read a moving current the way others read a still road.",
    mechanics: { classId: LARGE_IDS.class, level: 1, featureType: "core" },
  }),
  entry({
    id: "feature:tw-tideworn-drill",
    slug: "tw-tideworn-drill",
    name: "Tideworn Drill",
    category: "class-feature",
    summary: "Second-level drill settles two techniques into habit.",
    mechanics: { classId: LARGE_IDS.class, level: 2, featureType: "core" },
  }),
  entry({
    id: "feature:tw-long-watch",
    slug: "tw-long-watch",
    name: "Long Watch",
    category: "class-feature",
    summary: "Standing a longer watch teaches something the drill cannot.",
    mechanics: { classId: LARGE_IDS.class, level: 3, featureType: "core" },
  }),
  entry({
    id: "feature:tw-seasoning",
    slug: "tw-seasoning",
    name: "Seasoning",
    category: "class-feature",
    summary: "Fourth-level experience hardens one part of the craft.",
    mechanics: { classId: LARGE_IDS.class, level: 4, featureType: "core" },
  }),
];

const tidewarden = entry({
  id: LARGE_IDS.class,
  slug: "tw-tidewarden",
  name: "Tidewarden",
  category: "class",
  summary: "A harbour hand who keeps a crossing open when the water will not cooperate.",
  choices: [
    {
      id: LARGE_CHOICES.stance,
      label: "Watch stance",
      min: 1,
      max: 1,
      repeatable: false,
      options: [
        { id: "option:tw-stance-braced", label: "Braced" },
        { id: "option:tw-stance-loose", label: "Loose" },
      ],
    },
    {
      id: LARGE_CHOICES.mastery,
      label: "Tideworn mastery",
      min: MASTERY_PICKS,
      max: MASTERY_PICKS,
      repeatable: false,
      options: optionsFor("mastery", MASTERY_LABELS),
    },
    {
      id: LARGE_CHOICES.training,
      label: "Seasoned training",
      min: 1,
      max: 1,
      repeatable: false,
      options: optionsFor("training", TRAINING_LABELS),
    },
  ],
  mechanics: {
    hitDie: 10,
    primaryAbilities: ["strength"],
    savingThrows: ["proficiency:tw-save-strength", "proficiency:tw-save-constitution"],
    startingProficiencyIds: ["proficiency:tw-armor-light"],
    progression: [
      { level: 1, proficiencyBonus: 2, featureIds: ["feature:tw-tide-watch"], choiceIds: [LARGE_CHOICES.stance], resourceChanges: {} },
      // The mastery wall arrives at level 2, as the pilot's did.
      { level: 2, proficiencyBonus: 2, featureIds: ["feature:tw-tideworn-drill"], choiceIds: [LARGE_CHOICES.mastery], resourceChanges: {} },
      { level: 3, proficiencyBonus: 2, featureIds: ["feature:tw-long-watch"], choiceIds: [], resourceChanges: {} },
      // And the improvement-shaped decision at level 4, reachable only by a
      // build created at or above it.
      { level: 4, proficiencyBonus: 2, featureIds: ["feature:tw-seasoning"], choiceIds: [LARGE_CHOICES.training], resourceChanges: {} },
    ],
    subclassLevel: 5,
    subclassIds: [],
  },
});

const quaymark = entry({
  id: LARGE_IDS.species,
  slug: "tw-quaymark",
  name: "Quaymark",
  category: "species",
  summary: "Harbour-born, sure on wet stone.",
  mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] },
});

/** The origin feat the background grants. Present so the schema is satisfied
 * honestly rather than with a placeholder identifier pointing at nothing. */
const lampFeat = entry({
  id: "feat:tw-steady-lamp",
  slug: "tw-steady-lamp",
  name: "Steady Lamp",
  category: "feat",
  summary: "A wick you trimmed stays lit longer than it should.",
  mechanics: { category: "origin", repeatable: false },
});

const lampTender = entry({
  id: LARGE_IDS.background,
  slug: "tw-lamp-tender",
  name: "Lamp Tender",
  category: "background",
  summary: "You kept the crossing lights burning through every tide.",
  mechanics: {
    abilityScoreChoices: { abilities: ["strength", "constitution", "wisdom"], increasePattern: [2, 1] },
    featId: "feat:tw-steady-lamp",
    proficiencyIds: [],
    equipmentChoiceIds: [],
    equipmentBundleIds: [],
  },
});

/**
 * The ruleset's own ability-generation methods.
 *
 * A ruleset that declares none leaves the Abilities step with no fixed array to
 * assign from, so the step cannot be completed and nothing downstream of it can
 * be exercised. These are the same two methods the other fixtures offer.
 */
const abilityRules: ContentEntry[] = [
  entry({
    id: "rule:tw-standard-array",
    slug: "tw-standard-array",
    name: "Standard array",
    category: "rule",
    summary: "Assign one fixed set of six base scores, then apply your origin's increases.",
    mechanics: {
      kind: "ability-generation",
      data: { method: "standard-array", scores: [...LARGE_ARRAY], label: "Standard array" },
    },
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

export const LARGE_ENTRIES: readonly ContentEntry[] = [
  tidewarden,
  ...features,
  quaymark,
  lampTender,
  lampFeat,
  ...abilityRules,
  ...proficiencyEntries,
];

/**
 * The importable document.
 *
 * Parsed through the real content-pack schema rather than cast, so the fixture
 * cannot drift out of schema and silently stop proving anything.
 */
export function largeChoicePack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: LARGE_PACK_ID,
      name: LARGE_PACK_NAME,
      description: "Original synthetic content whose class asks two deliberately large questions.",
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
        id: LARGE_SOURCE_ID,
        name: "Tideworn scanning reference",
        abbreviation: "TSR",
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
    entries: LARGE_ENTRIES,
  });
}

/** The pack as one JSON document, for the import pipeline. */
export const largeChoicePackJson = () => JSON.stringify(largeChoicePack());
