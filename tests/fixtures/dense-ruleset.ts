/**
 * A deliberately dense public-original ruleset, for complexity contracts.
 *
 * Planning cost has to scale with the *content*, not with the number of options
 * inside it. A planner that re-walks the activation graph once per option looks
 * correct on the acceptance slice — which has a handful of options — and becomes
 * quadratic on anything real. This fixture is the smallest thing that makes that
 * difference measurable: several proficiency choices, dozens of mastery-style
 * options per choice, a nested choice under a selected option, and five levels
 * of progression that all accumulate into one planning pass.
 *
 * Every name and number here is original material written for these tests.
 */
import type { ContentEntry, Effect } from "@/src/domain/model";

const AT = "2026-08-04T08:00:00.000Z";
const VERSION = "1.0.0";

export const DENSE_SOURCE_ID = "source:tidewright-density";

export const DENSE_IDS = {
  class: "class:tw-tidewright",
  species: "species:tw-shoalborn",
  background: "background:tw-net-mender",
  trait: "trait:tw-tide-reader",
  feat: "feat:tw-deep-practice",
} as const;

/** How many options each mastery-style choice carries. */
export const DENSE_OPTIONS_PER_CHOICE = 40;
/** How many proficiency choices the class schedules across levels 1 to 5. */
export const DENSE_PROFICIENCY_CHOICES = 5;

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: DENSE_SOURCE_ID,
  sourceLocator: { sourceId: DENSE_SOURCE_ID, page: "1", section: "Density slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 30, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "tidewright-density"],
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

const grant = (proficiencyId: string): Effect => ({
  id: `effect:grant-${proficiencyId}`,
  type: "grantProficiency",
  proficiencyId,
});

export const denseProficiencyId = (choice: number, option: number) =>
  `proficiency:tw-c${choice}-o${option}`;
export const denseChoiceId = (choice: number) => `choice:tw-mastery-${choice}`;
/** The nested choice the selectable feat brings with it. */
export const DENSE_NESTED_CHOICE_ID = "choice:tw-deep-focus";
export const DENSE_FEAT_CHOICE_ID = "choice:tw-practice";

const proficiencies: ContentEntry[] = [];
for (let choice = 1; choice <= DENSE_PROFICIENCY_CHOICES; choice += 1)
  for (let option = 1; option <= DENSE_OPTIONS_PER_CHOICE; option += 1)
    proficiencies.push(
      entry({
        id: denseProficiencyId(choice, option),
        slug: `tw-c${choice}-o${option}`,
        name: `Tidework ${choice}-${option}`,
        category: "proficiency",
        mechanics: { type: "skill", key: `tw-c${choice}-o${option}` },
        tags: ["synthetic", "tidewright-density", "ability:wisdom"],
      }),
    );

/** Nested-choice proficiencies, reachable only once the feat is selected. */
const nestedProficiencies: ContentEntry[] = Array.from({ length: DENSE_OPTIONS_PER_CHOICE }, (_, index) =>
  entry({
    id: `proficiency:tw-focus-${index + 1}`,
    slug: `tw-focus-${index + 1}`,
    name: `Deep focus ${index + 1}`,
    category: "proficiency",
    mechanics: { type: "tool", key: `tw-focus-${index + 1}` },
  }),
);

const masteryChoice = (choice: number) => ({
  id: denseChoiceId(choice),
  label: `Tidework mastery ${choice}`,
  min: 1,
  max: 1,
  repeatable: false,
  options: Array.from({ length: DENSE_OPTIONS_PER_CHOICE }, (_, index) => ({
    id: `option:tw-c${choice}-o${index + 1}`,
    label: `Tidework ${choice}-${index + 1}`,
    effects: [grant(denseProficiencyId(choice, index + 1))],
  })),
});

const feat = entry({
  id: DENSE_IDS.feat,
  slug: "tw-deep-practice",
  name: "Deep Practice",
  category: "feat",
  summary: "One craft becomes a habit.",
  choices: [
    {
      id: DENSE_NESTED_CHOICE_ID,
      label: "Deep focus",
      min: 1,
      max: 1,
      repeatable: false,
      options: nestedProficiencies.map(item => ({
        id: `option:${item.id}`,
        label: item.name,
        effects: [grant(item.id)],
      })),
    },
  ],
  mechanics: { category: "general", repeatable: false },
});

const features: ContentEntry[] = Array.from({ length: 5 }, (_, index) =>
  entry({
    id: `feature:tw-level-${index + 1}`,
    slug: `tw-level-${index + 1}`,
    name: `Tidewright ${index + 1}`,
    category: "class-feature",
    mechanics: { classId: DENSE_IDS.class, level: index + 1, featureType: "core" },
  }),
);

const tidewright = entry({
  id: DENSE_IDS.class,
  slug: "tw-tidewright",
  name: "Tidewright",
  category: "class",
  summary: "Reads a tide the way a clerk reads a ledger.",
  choices: [
    ...Array.from({ length: DENSE_PROFICIENCY_CHOICES }, (_, index) => masteryChoice(index + 1)),
    {
      id: DENSE_FEAT_CHOICE_ID,
      label: "Practice",
      min: 1,
      max: 1,
      repeatable: false,
      options: [{ id: "option:tw-deep-practice", label: "Deep Practice", entryId: DENSE_IDS.feat }],
    },
  ],
  mechanics: {
    hitDie: 8,
    primaryAbilities: ["wisdom"],
    savingThrows: [denseProficiencyId(1, 1), denseProficiencyId(1, 2)],
    startingProficiencyIds: [],
    // Every level schedules another choice, so a level 5 plan accumulates all
    // of them in one pass rather than one level at a time.
    progression: Array.from({ length: 5 }, (_, index) => ({
      level: index + 1,
      proficiencyBonus: index >= 4 ? 3 : 2,
      featureIds: [`feature:tw-level-${index + 1}`],
      choiceIds:
        index + 1 === 5
          ? [denseChoiceId(5), DENSE_FEAT_CHOICE_ID]
          : [denseChoiceId(index + 1)],
      resourceChanges: {},
    })),
    subclassLevel: 20,
    subclassIds: [],
  },
});

const species = entry({
  id: DENSE_IDS.species,
  slug: "tw-shoalborn",
  name: "Shoalborn",
  category: "species",
  summary: "Born where the water is never quite still.",
  mechanics: {
    creatureType: "humanoid",
    sizeChoices: ["medium"],
    speed: 30,
    traitIds: [DENSE_IDS.trait],
    lineageIds: [],
  },
});

const trait = entry({
  id: DENSE_IDS.trait,
  slug: "tw-tide-reader",
  name: "Tide Reader",
  category: "feat",
  summary: "You know when the water is about to turn.",
  mechanics: { category: "other", repeatable: false },
});

const background = entry({
  id: DENSE_IDS.background,
  slug: "tw-net-mender",
  name: "Net Mender",
  category: "background",
  summary: "You repaired what the sea tore, every morning.",
  mechanics: {
    abilityScoreChoices: { abilities: ["wisdom", "dexterity", "constitution"], increasePattern: [2, 1] },
    featId: DENSE_IDS.feat,
    proficiencyIds: [],
    equipmentChoiceIds: [],
    equipmentBundleIds: [],
  },
});

export const DENSE_ENTRIES: readonly ContentEntry[] = [
  tidewright,
  ...features,
  species,
  trait,
  background,
  feat,
  ...proficiencies,
  ...nestedProficiencies,
];

/** A level 5 build that answers every dense choice, including the nested one. */
export function denseBuild() {
  const choiceSelections: Record<string, readonly string[]> = {
    [DENSE_FEAT_CHOICE_ID]: ["option:tw-deep-practice"],
    [DENSE_NESTED_CHOICE_ID]: [`option:${nestedProficiencies[0].id}`],
  };
  for (let choice = 1; choice <= DENSE_PROFICIENCY_CHOICES; choice += 1)
    choiceSelections[denseChoiceId(choice)] = [`option:tw-c${choice}-o1`];
  return {
    name: "Density",
    level: 5,
    classId: DENSE_IDS.class,
    speciesId: DENSE_IDS.species,
    backgroundId: DENSE_IDS.background,
    abilityMethod: "manual" as const,
    abilityScores: { strength: 10, dexterity: 12, constitution: 13, intelligence: 11, wisdom: 17, charisma: 8 },
    abilityBaseScores: { strength: 10, dexterity: 12, constitution: 13, intelligence: 11, wisdom: 15, charisma: 8 },
    abilityIncreases: { wisdom: 2 },
    choiceSelections,
    equipmentSelections: {},
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
  };
}
