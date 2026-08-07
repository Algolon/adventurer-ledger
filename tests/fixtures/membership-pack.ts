/**
 * The smallest pack that can stand as a ruleset, and a later version of it.
 *
 * It exists to state the ruleset-membership contract in numbers a reader can
 * hold: version 1 ships exactly three entries, version 2 ships those same three
 * plus two new ones, and every entry is original synthetic material written for
 * this repository.
 *
 * Three entries is the floor for a usable ruleset — a class, an origin and a
 * background — and the references those three make (two saving throws and the
 * background's feat) are satisfied by a separate scaffold pack. The scaffold is
 * deliberately *not* a declared dependency of the subject pack, so its entries
 * resolve as installed content without ever joining the subject's membership.
 * That makes "the profile activates exactly the pack's own entries" an assertion
 * about identity rather than a coincidence of the fixture being alone on the
 * device. `dependentMembershipPack` is the opposite case: it declares the
 * scaffold, so its profile legitimately includes the scaffold's entries too.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry } from "@/src/domain/model";

const AT = "2026-08-05T08:00:00.000Z";

export const SCAFFOLD_PACK_ID = "pack:emberline-scaffold";
export const SCAFFOLD_SOURCE_ID = "source:emberline-scaffold";
export const SCAFFOLD_IDS = {
  saveMight: "proficiency:mb-save-might",
  saveWit: "proficiency:mb-save-wit",
  feat: "feat:mb-steady-hand",
} as const;

export const MEMBERSHIP_PACK_ID = "pack:emberline-membership";
export const MEMBERSHIP_SOURCE_ID = "source:emberline-membership";
/** The profile ID `rulesetIdForPack` derives for the subject pack. */
export const MEMBERSHIP_RULESET_ID = "ruleset:pack:emberline-membership";

/** The three entries version 1 ships. */
export const MEMBERSHIP_V1_IDS = {
  class: "class:mb-warden",
  species: "species:mb-hillfolk",
  background: "background:mb-ferryhand",
} as const;

/** The two entries version 2 adds, and nothing else. */
export const MEMBERSHIP_V2_ADDED_IDS = {
  species: "species:mb-fenfolk",
  feat: "feat:mb-marshwise",
} as const;

const entry = (
  sourceId: string,
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId,
  sourceLocator: { sourceId, page: "1", section: "Membership slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 40, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "emberline-membership"],
  version: "1.0.0",
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

const source = (id: string, name: string, abbreviation: string, priority: number) => ({
  id,
  name,
  abbreviation,
  edition: "homebrew",
  type: "homebrew",
  licenseType: "original",
  visibility: "public",
  priority,
  enabledByDefault: true,
  campaignIds: [],
  version: "1.0.0",
});

/**
 * The references the subject pack's three entries make.
 *
 * Installed first and left without a ruleset of its own, so the subject pack's
 * profile has something legitimate to point at outside itself without that
 * content ever being part of it.
 */
export function scaffoldPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: SCAFFOLD_PACK_ID,
      name: "Emberline scaffold",
      description: "Original synthetic saves and one feat, referenced by the membership slice.",
      version: "1.0.0",
      coverage: "partial",
      rulesEditions: ["homebrew"],
      visibility: "public",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: false,
      dependencies: [],
      optionalDependencies: [],
    },
    sources: [source(SCAFFOLD_SOURCE_ID, "Emberline scaffold reference", "ESR", 40)],
    entries: [
      entry(SCAFFOLD_SOURCE_ID, {
        id: SCAFFOLD_IDS.saveMight,
        slug: "mb-save-might",
        name: "Might save",
        category: "proficiency",
        mechanics: { type: "save", key: "strength" },
        tags: ["synthetic", "emberline-membership", "ability:strength"],
      }),
      entry(SCAFFOLD_SOURCE_ID, {
        id: SCAFFOLD_IDS.saveWit,
        slug: "mb-save-wit",
        name: "Wit save",
        category: "proficiency",
        mechanics: { type: "save", key: "intelligence" },
        tags: ["synthetic", "emberline-membership", "ability:intelligence"],
      }),
      entry(SCAFFOLD_SOURCE_ID, {
        id: SCAFFOLD_IDS.feat,
        slug: "mb-steady-hand",
        name: "Steady hand",
        category: "feat",
        summary: "You keep your grip when the deck pitches.",
        mechanics: { category: "origin", repeatable: false },
      }),
    ],
  });
}

const subjectEntries = (): ContentEntry[] => [
  entry(MEMBERSHIP_SOURCE_ID, {
    id: MEMBERSHIP_V1_IDS.class,
    slug: "mb-warden",
    name: "Crossing warden",
    category: "class",
    summary: "You hold the crossing while others pass.",
    mechanics: {
      hitDie: 8,
      primaryAbilities: ["strength"],
      savingThrows: [SCAFFOLD_IDS.saveMight, SCAFFOLD_IDS.saveWit],
      startingProficiencyIds: [],
      progression: [{ level: 1, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} }],
      subclassLevel: 3,
      subclassIds: [],
    },
  }),
  entry(MEMBERSHIP_SOURCE_ID, {
    id: MEMBERSHIP_V1_IDS.species,
    slug: "mb-hillfolk",
    name: "Hillfolk",
    category: "species",
    summary: "Raised on the long slopes above the crossing.",
    mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] },
  }),
  entry(MEMBERSHIP_SOURCE_ID, {
    id: MEMBERSHIP_V1_IDS.background,
    slug: "mb-ferryhand",
    name: "Ferryhand",
    category: "background",
    summary: "You worked the rope ferry before you carried a blade.",
    mechanics: {
      abilityScoreChoices: { abilities: ["strength", "intelligence"], increasePattern: [2, 1] },
      featId: SCAFFOLD_IDS.feat,
      proficiencyIds: [],
      equipmentChoiceIds: [],
      equipmentBundleIds: [],
    },
  }),
];

/** The two entries that make version 2 larger than version 1. */
const addedEntries = (): ContentEntry[] => [
  entry(MEMBERSHIP_SOURCE_ID, {
    id: MEMBERSHIP_V2_ADDED_IDS.species,
    slug: "mb-fenfolk",
    name: "Fenfolk",
    category: "species",
    summary: "Raised in the reed channels below the crossing.",
    mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] },
  }),
  entry(MEMBERSHIP_SOURCE_ID, {
    id: MEMBERSHIP_V2_ADDED_IDS.feat,
    slug: "mb-marshwise",
    name: "Marshwise",
    category: "feat",
    summary: "You read standing water the way others read a road.",
    mechanics: { category: "general", repeatable: false },
  }),
];

/**
 * The subject pack at a chosen version.
 *
 * `entries` defaults to the three of version 1; the update passes those three
 * unchanged plus the two new ones, which is what makes the import an additive
 * update rather than a rewrite.
 */
export function membershipPack({
  version = "1.0.0",
  entries = subjectEntries(),
  dependencies = [] as readonly string[],
} = {}): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: MEMBERSHIP_PACK_ID,
      name: "Emberline membership slice",
      description: "Original synthetic class, origin and background used to pin ruleset membership.",
      version,
      coverage: "partial",
      rulesEditions: ["homebrew"],
      visibility: "public",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: false,
      dependencies: [...dependencies],
      optionalDependencies: [],
    },
    sources: [source(MEMBERSHIP_SOURCE_ID, "Emberline membership reference", "EMR", 41)],
    entries,
  });
}

/** Version 1: exactly three entries. */
export const membershipPackV1Json = () => JSON.stringify(membershipPack());

/** Version 2: the original three, unchanged, plus two new ones. */
export const membershipPackV2Json = () =>
  JSON.stringify(membershipPack({ version: "1.1.0", entries: [...subjectEntries(), ...addedEntries()] }));

/** The same two versions, but declaring the scaffold as a dependency. */
export const dependentMembershipPackV1Json = () =>
  JSON.stringify(membershipPack({ dependencies: [SCAFFOLD_PACK_ID] }));

export const dependentMembershipPackV2Json = () =>
  JSON.stringify(
    membershipPack({
      version: "1.1.0",
      entries: [...subjectEntries(), ...addedEntries()],
      dependencies: [SCAFFOLD_PACK_ID],
    }),
  );

/**
 * A third pack whose entry is published against the subject pack's own source.
 *
 * Legitimate content, installed the ordinary way. It must never join the subject
 * pack's profile, before or after a reconciliation: sharing a source is not
 * membership.
 */
export const SOURCE_SHARER_PACK_ID = "pack:emberline-sharer";
export const SOURCE_SHARER_ENTRY_ID = "feat:mb-outsider";

export function sourceSharingPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: SOURCE_SHARER_PACK_ID,
      name: "Emberline sharer",
      description: "Original synthetic feat published against the membership slice's source.",
      version: "1.0.0",
      coverage: "partial",
      rulesEditions: ["homebrew"],
      visibility: "public",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: false,
      dependencies: [],
      optionalDependencies: [],
    },
    sources: [],
    entries: [
      entry(MEMBERSHIP_SOURCE_ID, {
        id: SOURCE_SHARER_ENTRY_ID,
        slug: "mb-outsider",
        name: "Outsider's knack",
        category: "feat",
        summary: "A knack learned somewhere else entirely.",
        mechanics: { category: "general", repeatable: false },
      }),
    ],
  });
}

export const sourceSharingPackJson = () => JSON.stringify(sourceSharingPack());
