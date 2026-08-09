/**
 * Two synthetic casters that owe player spell selections.
 *
 * The foundation pack next door proves what a build can *reach*. This one proves
 * what it *owes*, and it is deliberately a second pack rather than an extension of
 * the first: the reachability contracts are pinned against that content exactly as
 * it stands, and growing it to carry selection obligations would change what those
 * tests are asserting about.
 *
 * Every entry is original synthetic material written for this repository. Names
 * and mechanics are invented and are not drawn from any published game.
 *
 * Two classes, one per generic casting model:
 *
 *  - **Runescribe** — `known`. Two separate obligations, cantrips and known
 *    spells, on two different progressions, so a level change can move one without
 *    moving the other. Grants nothing, so its allowance is entirely the player's.
 *  - **Warden** — `prepared`. One obligation, plus an outright grant and an
 *    always-prepared grant, so "granted does not consume the allowance" and
 *    "always-prepared is not deselectable" have content to be true of.
 *
 * The spell set is shaped to make the awkward cases reachable:
 *
 *  - `whisper-of-salt` is on both class lists as a single record, so one canonical
 *    identity has to survive two access routes;
 *  - `sealed-verse` is on a list neither class reaches, so an ineligible spell
 *    exists to be rejected;
 *  - `steady-flame` is granted to the Warden *and* on the Warden's list, so the
 *    granted-and-available overlap is real rather than hypothetical;
 *  - spell levels run 0 to 3, and the Runescribe's known-spell progression raises
 *    its reachable spell level at 3 and 5, so a level change genuinely unlocks
 *    something.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry } from "@/src/domain/model";

const AT = "2026-08-09T09:00:00.000Z";

export const CASTER_PACK_ID = "pack:emberreach-casters";
export const CASTER_SOURCE_ID = "source:emberreach-casters";
/** The profile ID `rulesetIdForPack` derives for this pack. */
export const CASTER_RULESET_ID = "ruleset:pack:emberreach-casters";

export const CASTER_IDS = {
  runescribe: "class:cs-runescribe",
  warden: "class:cs-warden",
  species: "species:cs-emberkin",
  background: "background:cs-tollkeeper",
  feat: "feat:cs-even-hand",
  saveOne: "proficiency:cs-save-focus",
  saveTwo: "proficiency:cs-save-nerve",
  runescribeRule: "rule:cs-runescribe-casting",
  wardenRule: "rule:cs-warden-casting",
} as const;

export const CASTER_LIST_IDS = {
  /** Reached by the Runescribe. */
  glyphs: "spell-list:cs-glyphs",
  /** Reached by the Warden. */
  vigil: "spell-list:cs-vigil",
  /** Defined, valid, and reached by neither class. */
  sealed: "spell-list:cs-sealed",
} as const;

export const CASTER_SPELL_IDS = {
  /** Cantrip, glyphs. */
  markOfPassage: "spell:cs-mark-of-passage",
  /** Cantrip, glyphs. */
  emberSpark: "spell:cs-ember-spark",
  /** Cantrip, vigil. */
  steadyFlame: "spell:cs-steady-flame",
  /** Cantrip, vigil. Granted to the Warden as always prepared. */
  wardensEye: "spell:cs-wardens-eye",
  /** Level 1, glyphs. */
  bindingScript: "spell:cs-binding-script",
  /** Level 1, vigil. Granted to the Warden outright, and on its list. */
  holdTheLine: "spell:cs-hold-the-line",
  /** Level 1, on *both* class lists, as one record. */
  whisperOfSalt: "spell:cs-whisper-of-salt",
  /** Level 2, glyphs. Out of reach until the Runescribe's level 3 row. */
  scriveningWard: "spell:cs-scrivening-ward",
  /** Level 2, vigil. */
  unbrokenVigil: "spell:cs-unbroken-vigil",
  /** Level 3, glyphs. Out of reach until the Runescribe's level 5 row. */
  chapterOfAsh: "spell:cs-chapter-of-ash",
  /** Level 1, sealed list only. Reachable by neither class. */
  sealedVerse: "spell:cs-sealed-verse",
} as const;

/** Stable selection IDs the declarations define. Selections are stored under these. */
export const CASTER_SELECTION_IDS = {
  runescribeCantrips: "spell-selection:cs-runescribe-cantrips",
  runescribeKnown: "spell-selection:cs-runescribe-known",
  wardenPrepared: "spell-selection:cs-warden-prepared",
} as const;

/** Every spell the Runescribe's list contains, sorted. */
export const GLYPH_MEMBER_IDS = [
  CASTER_SPELL_IDS.markOfPassage,
  CASTER_SPELL_IDS.emberSpark,
  CASTER_SPELL_IDS.bindingScript,
  CASTER_SPELL_IDS.whisperOfSalt,
  CASTER_SPELL_IDS.scriveningWard,
  CASTER_SPELL_IDS.chapterOfAsh,
].sort();

/** Every spell the Warden's list contains, sorted. */
export const VIGIL_MEMBER_IDS = [
  CASTER_SPELL_IDS.steadyFlame,
  CASTER_SPELL_IDS.wardensEye,
  CASTER_SPELL_IDS.holdTheLine,
  CASTER_SPELL_IDS.whisperOfSalt,
  CASTER_SPELL_IDS.unbrokenVigil,
].sort();

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: CASTER_SOURCE_ID,
  sourceLocator: { sourceId: CASTER_SOURCE_ID, page: "1", section: "Emberreach casters" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 43, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "emberreach"],
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

const spell = (partial: {
  id: string;
  slug: string;
  name: string;
  summary: string;
  level: number;
  school: string;
  spellListIds: readonly string[];
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
      components: { verbal: true, somatic: false, consumed: false },
      castingTime: { amount: 1, unit: "action" },
      duration: { type: "instantaneous", concentration: false },
      range: { type: "self" },
      scaling: [],
      spellListIds: [...partial.spellListIds],
      ritual: false,
    },
  });

/** Six contiguous progression rows, so a level 5 start is genuinely supported. */
const progression = () =>
  [1, 2, 3, 4, 5, 6].map(level => ({
    level,
    proficiencyBonus: level >= 5 ? 3 : 2,
    featureIds: [],
    choiceIds: [],
    resourceChanges: {},
  }));

const casterClass = (partial: {
  id: string;
  slug: string;
  name: string;
  summary: string;
  listId: string;
  effects?: ContentEntry["effects"];
}): ContentEntry =>
  entry({
    id: partial.id,
    slug: partial.slug,
    name: partial.name,
    category: "class",
    summary: partial.summary,
    effects: [
      { id: `effect:${partial.slug}-list`, type: "addSpellList", spellListId: partial.listId },
      ...(partial.effects ?? []),
    ],
    mechanics: {
      hitDie: 8,
      primaryAbilities: ["intelligence"],
      savingThrows: [CASTER_IDS.saveOne, CASTER_IDS.saveTwo],
      startingProficiencyIds: [],
      progression: progression(),
      subclassLevel: 3,
      subclassIds: [],
    },
  });

/**
 * The Runescribe's declaration.
 *
 * Two obligations on two progressions. `maxSpellLevel` rises at 3 and 5, which is
 * the only thing that makes a higher-level spell reachable — the engine never
 * infers a slot table, so what the content does not say, the character does not get.
 */
const runescribeCasting = (): ContentEntry =>
  entry({
    id: CASTER_IDS.runescribeRule,
    slug: "cs-runescribe-casting",
    name: "Runescribing",
    category: "rule",
    summary: "How a Runescribe learns.",
    mechanics: {
      kind: "spellcasting",
      data: {
        classId: CASTER_IDS.runescribe,
        ability: "intelligence",
        attackProficient: true,
        saveDcBase: 8,
        slotResourceIds: [],
        selections: [
          {
            id: CASTER_SELECTION_IDS.runescribeCantrips,
            model: "known",
            label: "Cantrips",
            spellLevels: { min: 0, max: 0 },
            progression: [
              { level: 1, count: 2 },
              { level: 4, count: 3 },
            ],
          },
          {
            id: CASTER_SELECTION_IDS.runescribeKnown,
            model: "known",
            label: "Spells known",
            spellLevels: { min: 1 },
            progression: [
              { level: 1, count: 2, maxSpellLevel: 1 },
              { level: 3, count: 3, maxSpellLevel: 2 },
              { level: 5, count: 4, maxSpellLevel: 3 },
            ],
          },
        ],
      },
    },
  });

/**
 * The Warden's declaration.
 *
 * One prepared obligation. Its two grants sit beside the allowance rather than
 * inside it: `grantedConsumesAllowance` is absent, so the default answer — a grant
 * is a gift, not a spent choice — is the one the fixture exercises.
 */
const wardenCasting = (): ContentEntry =>
  entry({
    id: CASTER_IDS.wardenRule,
    slug: "cs-warden-casting",
    name: "Warden's vigil",
    category: "rule",
    summary: "How a Warden prepares.",
    mechanics: {
      kind: "spellcasting",
      data: {
        classId: CASTER_IDS.warden,
        ability: "wisdom",
        attackProficient: true,
        saveDcBase: 8,
        slotResourceIds: [],
        selections: [
          {
            id: CASTER_SELECTION_IDS.wardenPrepared,
            model: "prepared",
            label: "Prepared spells",
            spellLevels: { min: 1 },
            progression: [
              { level: 1, count: 1, maxSpellLevel: 1 },
              { level: 5, count: 3, maxSpellLevel: 2 },
            ],
          },
        ],
      },
    },
  });

const supportEntries = (): ContentEntry[] => [
  entry({
    id: CASTER_IDS.saveOne,
    slug: "cs-save-focus",
    name: "Focus save",
    category: "proficiency",
    mechanics: { type: "save", key: "intelligence" },
  }),
  entry({
    id: CASTER_IDS.saveTwo,
    slug: "cs-save-nerve",
    name: "Nerve save",
    category: "proficiency",
    mechanics: { type: "save", key: "wisdom" },
  }),
  entry({
    id: CASTER_IDS.feat,
    slug: "cs-even-hand",
    name: "Even hand",
    category: "feat",
    summary: "You do not flinch when the ledger is read aloud.",
    mechanics: { category: "origin", repeatable: false },
  }),
  entry({
    id: CASTER_IDS.species,
    slug: "cs-emberkin",
    name: "Emberkin",
    category: "species",
    summary: "Born where the forge never fully cools.",
    mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] },
  }),
  entry({
    id: CASTER_IDS.background,
    slug: "cs-tollkeeper",
    name: "Tollkeeper",
    category: "background",
    summary: "You counted what crossed, and wrote it down.",
    mechanics: {
      abilityScoreChoices: { abilities: ["intelligence", "wisdom"], increasePattern: [2, 1] },
      featId: CASTER_IDS.feat,
      proficiencyIds: [],
      equipmentChoiceIds: [],
      equipmentBundleIds: [],
    },
  }),
];

const spellListEntries = (): ContentEntry[] => [
  entry({
    id: CASTER_LIST_IDS.glyphs,
    slug: "cs-glyphs",
    name: "Glyph repertoire",
    category: "spell-list",
    summary: "What a Runescribe may learn.",
    mechanics: { spellIds: [...GLYPH_MEMBER_IDS], ownerIds: [CASTER_IDS.runescribe] },
  }),
  entry({
    id: CASTER_LIST_IDS.vigil,
    slug: "cs-vigil",
    name: "Vigil repertoire",
    category: "spell-list",
    summary: "What a Warden may prepare.",
    mechanics: { spellIds: [...VIGIL_MEMBER_IDS], ownerIds: [CASTER_IDS.warden] },
  }),
  entry({
    id: CASTER_LIST_IDS.sealed,
    slug: "cs-sealed",
    name: "Sealed apocrypha",
    category: "spell-list",
    summary: "Nothing in this pack reaches it.",
    mechanics: { spellIds: [CASTER_SPELL_IDS.sealedVerse], ownerIds: [] },
  }),
];

const spellEntries = (): ContentEntry[] => [
  spell({
    id: CASTER_SPELL_IDS.markOfPassage,
    slug: "cs-mark-of-passage",
    name: "Mark of Passage",
    summary: "A sign only the next reader will find.",
    level: 0,
    school: "divination",
    spellListIds: [CASTER_LIST_IDS.glyphs],
  }),
  spell({
    id: CASTER_SPELL_IDS.emberSpark,
    slug: "cs-ember-spark",
    name: "Ember Spark",
    summary: "One bright point, briefly obedient.",
    level: 0,
    school: "evocation",
    spellListIds: [CASTER_LIST_IDS.glyphs],
  }),
  spell({
    id: CASTER_SPELL_IDS.steadyFlame,
    slug: "cs-steady-flame",
    name: "Steady Flame",
    summary: "A light that will not gutter.",
    level: 0,
    school: "evocation",
    spellListIds: [CASTER_LIST_IDS.vigil],
  }),
  spell({
    id: CASTER_SPELL_IDS.wardensEye,
    slug: "cs-wardens-eye",
    name: "Warden's Eye",
    summary: "You notice what crosses the line behind you.",
    level: 0,
    school: "divination",
    spellListIds: [CASTER_LIST_IDS.vigil],
  }),
  spell({
    id: CASTER_SPELL_IDS.bindingScript,
    slug: "cs-binding-script",
    name: "Binding Script",
    summary: "Written terms hold for as long as the ink is wet.",
    level: 1,
    school: "abjuration",
    spellListIds: [CASTER_LIST_IDS.glyphs],
  }),
  spell({
    id: CASTER_SPELL_IDS.holdTheLine,
    slug: "cs-hold-the-line",
    name: "Hold the Line",
    summary: "The ground behind you becomes briefly unarguable.",
    level: 1,
    school: "abjuration",
    spellListIds: [CASTER_LIST_IDS.vigil],
  }),
  spell({
    id: CASTER_SPELL_IDS.whisperOfSalt,
    slug: "cs-whisper-of-salt",
    name: "Whisper of Salt",
    summary: "A word that keeps, because it was preserved.",
    level: 1,
    school: "transmutation",
    spellListIds: [CASTER_LIST_IDS.glyphs, CASTER_LIST_IDS.vigil],
  }),
  spell({
    id: CASTER_SPELL_IDS.scriveningWard,
    slug: "cs-scrivening-ward",
    name: "Scrivening Ward",
    summary: "The page defends its own margin.",
    level: 2,
    school: "abjuration",
    spellListIds: [CASTER_LIST_IDS.glyphs],
  }),
  spell({
    id: CASTER_SPELL_IDS.unbrokenVigil,
    slug: "cs-unbroken-vigil",
    name: "Unbroken Vigil",
    summary: "You do not need to blink for a while.",
    level: 2,
    school: "divination",
    spellListIds: [CASTER_LIST_IDS.vigil],
  }),
  spell({
    id: CASTER_SPELL_IDS.chapterOfAsh,
    slug: "cs-chapter-of-ash",
    name: "Chapter of Ash",
    summary: "A long passage, read once and then gone.",
    level: 3,
    school: "evocation",
    spellListIds: [CASTER_LIST_IDS.glyphs],
  }),
  spell({
    id: CASTER_SPELL_IDS.sealedVerse,
    slug: "cs-sealed-verse",
    name: "Sealed Verse",
    summary: "Held shut for a reason nobody recorded.",
    level: 1,
    school: "necromancy",
    spellListIds: [CASTER_LIST_IDS.sealed],
  }),
];

/** Every entry the pack installs. */
export const CASTER_ENTRIES = (): ContentEntry[] => [
  casterClass({
    id: CASTER_IDS.runescribe,
    slug: "cs-runescribe",
    name: "Runescribe",
    summary: "You keep what you learn in writing, and it keeps you.",
    listId: CASTER_LIST_IDS.glyphs,
  }),
  casterClass({
    id: CASTER_IDS.warden,
    slug: "cs-warden",
    name: "Warden",
    summary: "You hold a line, and you decide each morning how.",
    listId: CASTER_LIST_IDS.vigil,
    effects: [
      // Granted outright, and separately on the Warden's own list, so one
      // canonical identity has to carry both facts.
      { id: "effect:cs-warden-grant", type: "addSpell", spellId: CASTER_SPELL_IDS.holdTheLine },
      // Always prepared. Not deselectable, and not a spent choice.
      {
        id: "effect:cs-warden-always",
        type: "addSpell",
        spellId: CASTER_SPELL_IDS.wardensEye,
        alwaysPrepared: true,
      },
    ],
  }),
  ...supportEntries(),
  runescribeCasting(),
  wardenCasting(),
  ...spellListEntries(),
  ...spellEntries(),
];

export function casterPack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: CASTER_PACK_ID,
      name: "Emberreach caster slice",
      description: "Original synthetic content used to pin generic caster spell selection.",
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
    sources: [
      {
        id: CASTER_SOURCE_ID,
        name: "Emberreach caster reference",
        abbreviation: "ECR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 43,
        enabledByDefault: true,
        campaignIds: [],
        version: "1.0.0",
      },
    ],
    entries: CASTER_ENTRIES(),
  });
}

export const casterPackJson = () => JSON.stringify(casterPack());

/**
 * The parsed entries as the importer would store them, so a pure test reads the
 * shape persistence actually holds rather than the raw fixture literals.
 */
export const casterStoredEntries = (): ContentEntry[] => casterPack().entries as unknown as ContentEntry[];
