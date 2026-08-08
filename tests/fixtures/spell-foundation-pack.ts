/**
 * A pack that gains spell content between two versions.
 *
 * It exists to state the three Spell Foundation contracts in content a reader
 * can hold, and every entry is original synthetic material written for this
 * repository.
 *
 * Version 1 ships five entries and *no* spell category at all: a class, an
 * origin, a background, that background's feat and the class's two saves. That
 * is the shape of a ruleset installed before spells existed, which is precisely
 * the state a later version has to be able to advance.
 *
 * Version 2 keeps those five unchanged, revises the class to reach a spell list,
 * and adds the spell-shaped content:
 *
 *  - two spell lists, only one of which the class reaches;
 *  - five spells, one of which is on the unreachable list only;
 *  - one spell that is on both lists, as a single record;
 *  - a spellcasting declaration, so the derived sheet projects casting.
 *
 * Membership is deliberately declared inconsistently, because the schema allows
 * both directions and real content will use both. `undertow` names its list from
 * the spell side and is *absent* from that list's own `spellIds`; `salt-ward`
 * appears on both sides. An index that reads only one direction loses one of
 * them, and the reachability tests say which.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry } from "@/src/domain/model";

const AT = "2026-08-08T08:00:00.000Z";

export const SPELL_PACK_ID = "pack:tidecall-foundation";
export const SPELL_SOURCE_ID = "source:tidecall-foundation";
/** The profile ID `rulesetIdForPack` derives for this pack. */
export const SPELL_RULESET_ID = "ruleset:pack:tidecall-foundation";

/** The five entries version 1 ships. None of them is spell-shaped. */
export const SPELL_V1_IDS = {
  class: "class:tc-tidecaller",
  species: "species:tc-shoalborn",
  background: "background:tc-lampwright",
  feat: "feat:tc-steady-footing",
  saveInsight: "proficiency:tc-save-insight",
  saveResolve: "proficiency:tc-save-resolve",
} as const;

/** The lists version 2 adds. Only `litany` is reachable from the class. */
export const SPELL_LIST_IDS = {
  /** Granted to the class by an `addSpellList` effect. */
  litany: "spell-list:tc-tide-litany",
  /** Defined, valid, and reachable by nothing this character has. */
  deepChoir: "spell-list:tc-deep-choir",
} as const;

export const SPELL_IDS = {
  /** On the litany, and separately granted by an `addSpell` effect. */
  tidemark: "spell:tc-tidemark",
  /** On the litany, from both directions. Declares `ritual: true`. */
  saltWard: "spell:tc-salt-ward",
  /** On the litany from the spell side only, and omits `ritual` entirely. */
  undertow: "spell:tc-undertow",
  /** One record, on both lists. */
  sharedCurrent: "spell:tc-shared-current",
  /** On the deep choir only: reachable content this character cannot reach. */
  abyssalHymn: "spell:tc-abyssal-hymn",
} as const;

export const SPELLCASTING_RULE_ID = "rule:tc-spellcasting";

/** Spells the litany contains, whichever direction declares the membership. */
export const LITANY_MEMBER_IDS = [
  SPELL_IDS.saltWard,
  SPELL_IDS.sharedCurrent,
  SPELL_IDS.tidemark,
  SPELL_IDS.undertow,
].sort();

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: SPELL_SOURCE_ID,
  sourceLocator: { sourceId: SPELL_SOURCE_ID, page: "1", section: "Tidecall slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 42, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "tidecall"],
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

/**
 * A spell record.
 *
 * `ritual` is passed through rather than defaulted here, so a fixture that omits
 * it produces a document with the field genuinely absent — which is what makes
 * the backward-compatibility assertions mean something.
 */
const spell = (partial: {
  id: string;
  slug: string;
  name: string;
  summary: string;
  level: number;
  school: string;
  spellListIds: readonly string[];
  ritual?: boolean;
}): ContentEntry =>
  entry({
    id: partial.id,
    slug: partial.slug,
    name: partial.name,
    category: "spell",
    summary: partial.summary,
    mechanics: {
      level: partial.level,
      school: partial.school,
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "touch" },
      scaling: [],
      spellListIds: [...partial.spellListIds],
      ...(partial.ritual === undefined ? {} : { ritual: partial.ritual }),
    },
  });

/** The class as version 1 ships it: a caster in name only, with no spell reach. */
const classEntry = (options: { spellful: boolean }): ContentEntry =>
  entry({
    id: SPELL_V1_IDS.class,
    slug: "tc-tidecaller",
    name: "Tidecaller",
    category: "class",
    summary: "You read the set of the water and answer it.",
    revision: options.spellful ? 2 : 1,
    version: options.spellful ? "1.1.0" : "1.0.0",
    effects: options.spellful
      ? [
          // One spell is granted outright. Everything else the character can
          // reach comes from the list, and must not be granted by reaching it.
          {
            id: "effect:tc-grant-tidemark",
            type: "addSpell",
            spellId: SPELL_IDS.tidemark,
            alwaysPrepared: true,
          },
          { id: "effect:tc-litany", type: "addSpellList", spellListId: SPELL_LIST_IDS.litany },
        ]
      : [],
    mechanics: {
      hitDie: 8,
      primaryAbilities: ["wisdom"],
      savingThrows: [SPELL_V1_IDS.saveInsight, SPELL_V1_IDS.saveResolve],
      startingProficiencyIds: [],
      progression: [
        { level: 1, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
        { level: 2, proficiencyBonus: 2, featureIds: [], choiceIds: [], resourceChanges: {} },
      ],
      subclassLevel: 3,
      subclassIds: [],
    },
  });

/** The five entries version 1 ships, in a fixed order. */
const baseEntries = (): ContentEntry[] => [
  entry({
    id: SPELL_V1_IDS.saveInsight,
    slug: "tc-save-insight",
    name: "Insight save",
    category: "proficiency",
    mechanics: { type: "save", key: "wisdom" },
    tags: ["synthetic", "tidecall", "ability:wisdom"],
  }),
  entry({
    id: SPELL_V1_IDS.saveResolve,
    slug: "tc-save-resolve",
    name: "Resolve save",
    category: "proficiency",
    mechanics: { type: "save", key: "charisma" },
    tags: ["synthetic", "tidecall", "ability:charisma"],
  }),
  entry({
    id: SPELL_V1_IDS.feat,
    slug: "tc-steady-footing",
    name: "Steady footing",
    category: "feat",
    summary: "Wet stone is no worse to you than dry.",
    mechanics: { category: "origin", repeatable: false },
  }),
  entry({
    id: SPELL_V1_IDS.species,
    slug: "tc-shoalborn",
    name: "Shoalborn",
    category: "species",
    summary: "Raised where the water is never quite gone.",
    mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] },
  }),
  entry({
    id: SPELL_V1_IDS.background,
    slug: "tc-lampwright",
    name: "Lampwright",
    category: "background",
    summary: "You kept the channel lamps lit before you kept anything else.",
    mechanics: {
      abilityScoreChoices: { abilities: ["wisdom", "charisma"], increasePattern: [2, 1] },
      featId: SPELL_V1_IDS.feat,
      proficiencyIds: [],
      equipmentChoiceIds: [],
      equipmentBundleIds: [],
    },
  }),
];

/** Everything version 2 adds. Nothing here exists in version 1. */
const spellEntries = (): ContentEntry[] => [
  entry({
    id: SPELLCASTING_RULE_ID,
    slug: "tc-spellcasting",
    name: "Tidecalling",
    category: "rule",
    summary: "How a Tidecaller casts.",
    mechanics: {
      kind: "spellcasting",
      data: {
        classId: SPELL_V1_IDS.class,
        ability: "wisdom",
        attackProficient: true,
        saveDcBase: 8,
        slotResourceIds: [],
      },
    },
  }),
  entry({
    id: SPELL_LIST_IDS.litany,
    slug: "tc-tide-litany",
    name: "Tide litany",
    category: "spell-list",
    summary: "What a Tidecaller may learn.",
    // `undertow` is deliberately absent: it declares this list from its own side.
    mechanics: {
      spellIds: [SPELL_IDS.tidemark, SPELL_IDS.saltWard, SPELL_IDS.sharedCurrent],
      ownerIds: [SPELL_V1_IDS.class],
    },
  }),
  entry({
    id: SPELL_LIST_IDS.deepChoir,
    slug: "tc-deep-choir",
    name: "Deep choir",
    category: "spell-list",
    summary: "What sings under the shelf. Nothing in this pack reaches it.",
    mechanics: { spellIds: [SPELL_IDS.abyssalHymn, SPELL_IDS.sharedCurrent], ownerIds: [] },
  }),
  spell({
    id: SPELL_IDS.tidemark,
    slug: "tc-tidemark",
    name: "Tidemark",
    summary: "A wet line of light marks what you name.",
    level: 0,
    school: "divination",
    spellListIds: [SPELL_LIST_IDS.litany],
  }),
  spell({
    id: SPELL_IDS.saltWard,
    slug: "tc-salt-ward",
    name: "Salt Ward",
    summary: "A ring of drying salt refuses one thing passage.",
    level: 1,
    school: "abjuration",
    spellListIds: [SPELL_LIST_IDS.litany],
    ritual: true,
  }),
  spell({
    id: SPELL_IDS.undertow,
    slug: "tc-undertow",
    name: "Undertow",
    summary: "The water under a creature pulls the wrong way.",
    level: 1,
    school: "conjuration",
    spellListIds: [SPELL_LIST_IDS.litany],
  }),
  spell({
    id: SPELL_IDS.sharedCurrent,
    slug: "tc-shared-current",
    name: "Shared Current",
    summary: "Two bodies of water agree, briefly, to be one.",
    level: 1,
    school: "transmutation",
    spellListIds: [SPELL_LIST_IDS.litany, SPELL_LIST_IDS.deepChoir],
  }),
  spell({
    id: SPELL_IDS.abyssalHymn,
    slug: "tc-abyssal-hymn",
    name: "Abyssal Hymn",
    summary: "A note held below hearing.",
    level: 1,
    school: "enchantment",
    spellListIds: [SPELL_LIST_IDS.deepChoir],
  }),
];

/** Every entry version 1 installs. */
export const SPELL_V1_ENTRIES = (): ContentEntry[] => [classEntry({ spellful: false }), ...baseEntries()];

/** Every entry version 2 installs, including the revised class. */
export const SPELL_V2_ENTRIES = (): ContentEntry[] => [
  classEntry({ spellful: true }),
  ...baseEntries(),
  ...spellEntries(),
];

/** The entries version 2 adds and version 1 does not have. */
export const SPELL_V2_ADDED_IDS = [
  SPELLCASTING_RULE_ID,
  ...Object.values(SPELL_LIST_IDS),
  ...Object.values(SPELL_IDS),
].sort();

function tidecallPack({ version, entries }: { version: string; entries: ContentEntry[] }): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: SPELL_PACK_ID,
      name: "Tidecall foundation slice",
      description: "Original synthetic content used to pin spell-category, spell-list and ritual behaviour.",
      version,
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
        id: SPELL_SOURCE_ID,
        name: "Tidecall foundation reference",
        abbreviation: "TFR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 42,
        enabledByDefault: true,
        campaignIds: [],
        version: "1.0.0",
      },
    ],
    entries,
  });
}

/** Version 1: five entries, no spell category anywhere in the pack. */
export const spellPackV1 = () => tidecallPack({ version: "1.0.0", entries: SPELL_V1_ENTRIES() });
export const spellPackV1Json = () => JSON.stringify(spellPackV1());

/** Version 2: the same five, the class revised, and the spell content added. */
export const spellPackV2 = () => tidecallPack({ version: "1.1.0", entries: SPELL_V2_ENTRIES() });
export const spellPackV2Json = () => JSON.stringify(spellPackV2());

/**
 * The parsed entries as the importer would store them.
 *
 * Taken from the schema rather than from the raw fixture literals, so a pure
 * test reads exactly the shape persistence holds — including any default the
 * schema applies on the way through.
 */
export const spellPackV2StoredEntries = (): ContentEntry[] =>
  spellPackV2().entries as unknown as ContentEntry[];
