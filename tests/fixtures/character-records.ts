/**
 * Synthetic character record fixtures for M2.1 persistence and service tests.
 * Every ID comes from the accepted `ruleset:runefolio-2024-synthetic` vocabulary.
 */
import type {
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CharacterVersionRecord,
} from "@/src/domain/character-record";

const TIMESTAMP = "2026-08-03T08:00:00.000Z";

export function characterFixture(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "character:brammel",
    revision: 1,
    rulesetProfileId: "ruleset:runefolio-2024-synthetic",
    presentation: "guided",
    name: "Brammel Voss",
    nickname: "Boss",
    level: 1,
    classLevels: [{ classId: "class:vanguard", level: 1 }],
    speciesId: "species:riverborn",
    backgroundId: "background:caravan-warden",
    abilityMethod: "standard-array",
    abilityScores: { strength: 16, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 },
    choiceSelections: {},
    equipmentSelections: {},
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
    contentFingerprint: "fingerprint:test",
    status: "active",
    kind: "player-character",
    tags: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export function runtimeFixture(characterId: string, overrides: Partial<CharacterRuntimeStateRecord> = {}): CharacterRuntimeStateRecord {
  return {
    characterId,
    revision: 1,
    currentHitPoints: 12,
    maximumHitPointsAtLastSync: 12,
    temporaryHitPoints: 0,
    resourceUses: { "resource:rallying-breath": 1 },
    resourceMaximaAtLastSync: { "resource:rallying-breath": 1 },
    conditions: [],
    hitDiceRemaining: 1,
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0 },
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  };
}

export function versionFixture(character: CharacterRecord, sequence: number, operationId: string): CharacterVersionRecord {
  return {
    id: `${character.id}@${sequence}:${operationId}`,
    characterId: character.id,
    sequence,
    reason: sequence === 1 ? "initial" : "edit",
    operationId,
    snapshot: character,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}
