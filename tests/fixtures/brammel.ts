/**
 * Brammel "Boss" Voss, the accepted M2.1 synthetic vertical-slice character.
 *
 * Abilities are the synthetic standard array 15/14/13/12/10/8 with the Caravan
 * Warden +2/+1 applied to Strength and Constitution. The nickname is identity
 * only and never feeds a calculation.
 */
import type { CharacterRecord, CharacterRuntimeStateRecord } from "@/src/domain/character-record";
import {
  SYNTHETIC_CHOICES,
  SYNTHETIC_EQUIPMENT_CHOICE,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET_ID,
  VANGUARD_HIT_POINT_BASE,
  VANGUARD_RALLYING_BREATH,
} from "@/src/content/runefolio-synthetic";

const AT = "2026-08-03T08:00:00.000Z";

export const BRAMMEL_ID = "character:brammel";

/** Maximum hit points at a level: class base plus the Constitution modifier (+2). */
export const brammelMaximumHitPoints = (level: number) => VANGUARD_HIT_POINT_BASE[level] + 2;
export const brammelResourceMaximum = (level: number) => VANGUARD_RALLYING_BREATH[level];

export function brammel(level = 1, overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: BRAMMEL_ID,
    revision: 1,
    rulesetProfileId: SYNTHETIC_RULESET_ID,
    presentation: "guided",
    name: "Brammel Voss",
    nickname: "Boss",
    level,
    classLevels: [{ classId: SYNTHETIC_IDS.class, level }],
    speciesId: SYNTHETIC_IDS.species,
    backgroundId: SYNTHETIC_IDS.background,
    abilityMethod: "standard-array",
    abilityScores: { strength: 16, dexterity: 15, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
    choiceSelections: {
      [SYNTHETIC_CHOICES.fightingStyle]: ["option:guarded-hand"],
      [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-watchcraft", "option:proficiency:skill-haulage"],
      [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
      ...(level >= 2 ? { [SYNTHETIC_CHOICES.weaponMastery]: ["option:measured-cut"] } : {}),
    },
    equipmentSelections: { [SYNTHETIC_EQUIPMENT_CHOICE]: ["equipment-option:warden-pack"] },
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

export function brammelRuntime(level = 1, overrides: Partial<CharacterRuntimeStateRecord> = {}): CharacterRuntimeStateRecord {
  const maximum = brammelMaximumHitPoints(level);
  return {
    characterId: BRAMMEL_ID,
    revision: 1,
    currentHitPoints: maximum,
    maximumHitPointsAtLastSync: maximum,
    temporaryHitPoints: 0,
    resourceUses: { [SYNTHETIC_IDS.resource]: brammelResourceMaximum(level) },
    resourceMaximaAtLastSync: { [SYNTHETIC_IDS.resource]: brammelResourceMaximum(level) },
    conditions: [],
    hitDiceRemaining: level,
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0 },
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}
