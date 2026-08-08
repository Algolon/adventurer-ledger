/**
 * The characters the Spell Foundation contracts are read through.
 *
 * A caster built on the Tidecall class, as a draft the builder holds and as a
 * committed record the resolver reads, plus a non-caster on the same pack. The
 * non-caster is what makes "membership does not leak" an assertion about the
 * content rather than about the fixture: it has the same origin, the same
 * background and the same ruleset, and reaches no spell list at all.
 */
import type { CharacterDraftBuild, CharacterRecord } from "@/src/domain/character-record";
import {
  SPELL_RULESET_ID,
  SPELL_V1_IDS,
} from "@/tests/fixtures/spell-foundation-pack";

const AT = "2026-08-08T09:00:00.000Z";

/** Wisdom 15 is a +2 modifier, which is what the casting assertions read. */
const SCORES = {
  strength: 10,
  dexterity: 12,
  constitution: 13,
  intelligence: 11,
  wisdom: 15,
  charisma: 8,
} as const;

export function tidecallerDraft(overrides: Partial<CharacterDraftBuild> = {}): CharacterDraftBuild {
  return {
    name: "Sedge Wray",
    level: 1,
    classId: SPELL_V1_IDS.class,
    speciesId: SPELL_V1_IDS.species,
    backgroundId: SPELL_V1_IDS.background,
    abilityMethod: "manual",
    abilityScores: { ...SCORES },
    abilityBaseScores: { ...SCORES },
    abilityIncreases: {},
    choiceSelections: {},
    equipmentSelections: {},
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
    ...overrides,
  };
}

/** The same character, committed. */
export function tidecaller(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "character:sedge-wray",
    revision: 1,
    rulesetProfileId: SPELL_RULESET_ID,
    presentation: "guided",
    name: "Sedge Wray",
    level: 1,
    classLevels: [{ classId: SPELL_V1_IDS.class, level: 1 }],
    speciesId: SPELL_V1_IDS.species,
    backgroundId: SPELL_V1_IDS.background,
    abilityMethod: "manual",
    abilityScores: { ...SCORES },
    choiceSelections: {},
    equipmentSelections: {},
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
    contentFingerprint: "fingerprint:test",
    status: "active",
    kind: "player-character",
    tags: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

/**
 * A draft with no class at all.
 *
 * The cheapest possible statement that spell availability is a property of what
 * the build reaches: this build reaches nothing, on content that defines two
 * spell lists and five spells.
 */
export function nonCasterDraft(overrides: Partial<CharacterDraftBuild> = {}): CharacterDraftBuild {
  const { classId: _dropped, ...base } = tidecallerDraft();
  return { ...base, name: "Ferrier", ...overrides };
}
