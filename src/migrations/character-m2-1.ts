/**
 * Database version 4 → 5 character migration.
 *
 * Version 1 created `characters`, `characterVersions` and `characterSnapshots`
 * against the legacy `Character` shape, which mixed durable build choices with
 * runtime play values. M2.1 separates them: durable state gains a compare-and-swap
 * `revision`, and hit points, resources and conditions move to their own runtime
 * record with an independent revision.
 *
 * The conversion is pure and deterministic so it can be unit tested without Dexie.
 * Every diagnostic identifies a record by stable ID and field path only — a
 * migration error never echoes a name, biography, note or other private value.
 */
import type { Transaction } from "dexie";
import type {
  CharacterActionRecord,
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CharacterSnapshotRecord,
  CharacterVersionRecord,
} from "@/src/domain/character-record";
import type { Ability, ID, ISODate } from "@/src/domain/model";
import { ABILITIES } from "@/src/domain/character-record";

/** Sanitized migration failure. Carries a stable ID and field path, never a value. */
export class CharacterMigrationError extends Error {
  constructor(
    readonly code: "RECORD_ID_MISSING" | "FIELD_TYPE_UNEXPECTED",
    readonly recordId: string,
    readonly fieldPath: string,
  ) {
    super(`Character migration ${code} for record ${recordId} at ${fieldPath}`);
    this.name = "CharacterMigrationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function stableId(row: Record<string, unknown>, fieldPath: string): ID {
  const value = row[fieldPath];
  if (typeof value !== "string" || !value) throw new CharacterMigrationError("RECORD_ID_MISSING", "(unidentified)", fieldPath);
  return value;
}

function integer(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalId(value: unknown): ID | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function timestamp(row: Record<string, unknown>, field: "createdAt" | "updatedAt", fallback: ISODate): ISODate {
  const value = row[field];
  return typeof value === "string" && value ? value : fallback;
}

/** Legacy status maps onto the M2.1 two-state model without losing the distinction. */
function migrateStatus(value: unknown): { status: CharacterRecord["status"]; extraTags: string[] } {
  if (value === "archived") return { status: "archived", extraTags: [] };
  if (value === "deceased") return { status: "archived", extraTags: ["legacy:deceased"] };
  return { status: "active", extraTags: [] };
}

function migrateAbilities(row: Record<string, unknown>, recordId: ID): Partial<Record<Ability, number>> {
  const raw = row.abilities;
  if (raw !== undefined && !isRecord(raw)) throw new CharacterMigrationError("FIELD_TYPE_UNEXPECTED", recordId, "abilities");
  const abilities: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const value = isRecord(raw) ? raw[ability] : undefined;
    // An unparseable legacy score stays unknown rather than becoming zero (D-03).
    if (typeof value === "number" && Number.isFinite(value)) abilities[ability] = Math.trunc(value);
  }
  return abilities;
}

function migrateClassLevels(row: Record<string, unknown>, recordId: ID): CharacterRecord["classLevels"] {
  const raw = row.classLevels;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new CharacterMigrationError("FIELD_TYPE_UNEXPECTED", recordId, "classLevels");
  return raw.flatMap(item => {
    if (!isRecord(item)) return [];
    const classId = optionalId(item.classId);
    if (!classId) return [];
    const subclassId = optionalId(item.subclassId);
    return [{ classId, level: Math.max(1, integer(item.level, 1)), ...(subclassId ? { subclassId } : {}) }];
  });
}

/**
 * Converts one legacy character row into its M2.1 durable record plus the runtime
 * record carrying the values that left the durable row.
 */
export function migrateLegacyCharacter(row: Record<string, unknown>): {
  character: CharacterRecord;
  runtime: CharacterRuntimeStateRecord;
} {
  const id = stableId(row, "id");
  const createdAt = timestamp(row, "createdAt", "1970-01-01T00:00:00.000Z");
  const updatedAt = timestamp(row, "updatedAt", createdAt);
  const { status, extraTags } = migrateStatus(row.status);
  const classLevels = migrateClassLevels(row, id);
  const nickname = optionalId(row.nickname);
  const lastPlayedAt = optionalId(row.lastPlayedAt);
  const speciesId = optionalId(row.speciesId);
  const backgroundId = optionalId(row.backgroundId);
  const maximumHitPoints = integer(row.baseHitPoints, 0);

  const character: CharacterRecord = {
    id,
    // Deterministic starting revision for every pre-M2.1 row.
    revision: 1,
    rulesetProfileId: text(row.rulesetProfileId, "ruleset:unassigned"),
    // Legacy rows carry no mode preference; guided is the documented default.
    presentation: "guided",
    name: text(row.name),
    ...(nickname ? { nickname } : {}),
    level: Math.max(1, integer(row.level, 1)),
    classLevels,
    ...(speciesId ? { speciesId } : {}),
    ...(backgroundId ? { backgroundId } : {}),
    abilityMethod: "manual",
    abilityScores: migrateAbilities(row, id),
    choiceSelections: {},
    equipmentSelections: {},
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
    // The row predates review fingerprints; it is explicitly unverified rather
    // than falsely matching current content.
    contentFingerprint: "legacy:unverified",
    status,
    kind: "player-character",
    tags: [...stringList(row.tags), ...extraTags],
    ...(lastPlayedAt ? { lastPlayedAt } : {}),
    createdAt,
    updatedAt,
  };

  const deathSaves = isRecord(row.deathSaves) ? row.deathSaves : {};
  const runtime: CharacterRuntimeStateRecord = {
    characterId: id,
    revision: 1,
    currentHitPoints: integer(row.currentHitPoints, maximumHitPoints),
    maximumHitPointsAtLastSync: maximumHitPoints,
    temporaryHitPoints: Math.max(0, integer(row.temporaryHitPoints, 0)),
    resourceUses: {},
    resourceMaximaAtLastSync: {},
    conditions: [],
    hitDiceRemaining: Math.max(0, integer(row.level, 1)),
    exhaustion: Math.max(0, integer(row.exhaustion, 0)),
    deathSaves: {
      successes: Math.max(0, integer(deathSaves.successes, 0)),
      failures: Math.max(0, integer(deathSaves.failures, 0)),
    },
    createdAt,
    updatedAt,
  };

  return { character, runtime };
}

/** Converts a legacy immutable version row, preserving its sequence and snapshot. */
export function migrateLegacyVersion(row: Record<string, unknown>): CharacterVersionRecord {
  const id = stableId(row, "id");
  const characterId = stableId(row, "characterId");
  const createdAt = timestamp(row, "createdAt", "1970-01-01T00:00:00.000Z");
  const snapshotSource = isRecord(row.snapshot) ? row.snapshot : { id: characterId };
  const parentVersionId = optionalId(row.parentVersionId);
  const legacyReason = text(row.reason);
  return {
    id,
    characterId,
    sequence: Math.max(1, integer(row.sequence, 1)),
    reason: legacyReason === "level-up" || legacyReason === "import" || legacyReason === "restore" ? legacyReason : "edit",
    operationId: `migration:v5:${id}`,
    snapshot: migrateLegacyCharacter(snapshotSource).character,
    ...(parentVersionId ? { parentVersionId } : {}),
    createdAt,
    updatedAt: timestamp(row, "updatedAt", createdAt),
  };
}

/** Converts a legacy restore point, typing its previously untyped runtime payload. */
export function migrateLegacySnapshot(row: Record<string, unknown>): CharacterSnapshotRecord {
  const id = stableId(row, "id");
  const characterId = stableId(row, "characterId");
  const createdAt = timestamp(row, "createdAt", "1970-01-01T00:00:00.000Z");
  const runtimeSource = isRecord(row.runtimeState) ? { ...row.runtimeState, id: characterId } : { id: characterId };
  return {
    id,
    characterId,
    kind: "explicit-session",
    label: text(row.label, "Restore point"),
    characterVersionId: text(row.characterVersionId, ""),
    runtimeState: migrateLegacyCharacter(runtimeSource).runtime,
    createdAt,
    updatedAt: timestamp(row, "updatedAt", createdAt),
  };
}

/**
 * Runs the whole character upgrade inside Dexie's version-change transaction.
 * Any throw rolls back every table touched here; content, packs and sources are
 * never read or written by this step.
 */
export async function upgradeCharactersToM21(transaction: Transaction): Promise<void> {
  const characters = transaction.table<Record<string, unknown>, string>("characters");
  const versions = transaction.table<Record<string, unknown>, string>("characterVersions");
  const snapshots = transaction.table<Record<string, unknown>, string>("characterSnapshots");
  const runtimeStates = transaction.table<CharacterRuntimeStateRecord, string>("characterRuntimeStates");

  const legacyCharacters = await characters.toArray();
  const migratedRuntime: CharacterRuntimeStateRecord[] = [];
  const migratedCharacters: CharacterRecord[] = [];
  for (const row of legacyCharacters) {
    const { character, runtime } = migrateLegacyCharacter(row);
    migratedCharacters.push(character);
    migratedRuntime.push(runtime);
  }

  const legacyVersions = await versions.toArray();
  const migratedVersions = legacyVersions.map(migrateLegacyVersion);
  const legacySnapshots = await snapshots.toArray();
  const migratedSnapshots = legacySnapshots.map(migrateLegacySnapshot);

  // Replace rather than merge: the durable rows must no longer carry runtime keys.
  if (migratedCharacters.length) {
    await characters.bulkDelete(migratedCharacters.map(item => item.id));
    await characters.bulkAdd(migratedCharacters as unknown as Record<string, unknown>[]);
    await runtimeStates.bulkPut(migratedRuntime);
  }
  if (migratedVersions.length) await versions.bulkPut(migratedVersions as unknown as Record<string, unknown>[]);
  if (migratedSnapshots.length) await snapshots.bulkPut(migratedSnapshots as unknown as Record<string, unknown>[]);
}

/** No legacy action-log rows exist before version 5; the table starts empty. */
export const LEGACY_ACTION_RECORDS: readonly CharacterActionRecord[] = [];
