/**
 * CharacterTransferService — standard user-controlled file transfer (D-07).
 *
 * Export builds a safe artifact: it excludes private full text, override
 * reasons, action-log notes and anything `exportRestricted`, and it rejects a
 * restricted dependency outright rather than asking for confirmation inside this
 * boundary. Preview parses unknown bytes and plans conflicts without any
 * mutation. Confirm revalidates the preview fingerprint and destination revision
 * and writes every record in one transaction; cancel writes nothing.
 *
 * QR encoding is deferred and no path implies automatic device replication.
 * Imported values are declarative data and are never evaluated.
 */
import { z } from "zod";
import type {
  CharacterOverrideRecord,
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CharacterSnapshotRecord,
  CharacterVersionRecord,
} from "@/src/domain/character-record";
import type { ID, ISODate } from "@/src/domain/model";
import { computeContentFingerprint, resolveDerivedCharacter } from "@/src/services/derived-resolver";
import { canonicalHash } from "@/src/services/canonical";
import { derivedSnapshotOf, type ServiceContext } from "@/src/services/character-services";
import {
  invalid,
  noopLogger,
  notFound,
  ok,
  stale,
  systemClock,
  type Clock,
  type ServiceIssue,
  type ServiceLogger,
  type ServiceOutcome,
} from "@/src/services/contracts";

export const TRANSFER_FORMAT_VERSION = 1;
export const TRANSFER_KIND = "runefolio-character-transfer";
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const unsafeMarkup = /<\s*(?:script|iframe|object|embed|style|link|meta)\b|\bon[a-z]+\s*=|javascript\s*:/i;

/** Structural safety scan before any schema work. Mirrors the content pipeline. */
function inspect(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("Transfer nesting is too deep");
  if (typeof value === "string" && unsafeMarkup.test(value)) throw new Error("Transfer contains unsafe markup");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) throw new Error("Transfer contains a forbidden object key");
    inspect(child, depth + 1);
  }
}

const abilityScores = z.record(z.number().int().min(1).max(30));
const characterSchema = z.object({
  id: z.string().min(1).max(160),
  revision: z.number().int().min(1),
  rulesetProfileId: z.string().min(1).max(160),
  presentation: z.enum(["guided", "flexible"]),
  name: z.string().max(240),
  nickname: z.string().max(120).optional(),
  pronouns: z.string().max(60).optional(),
  level: z.number().int().min(1).max(20),
  classLevels: z.array(z.object({ classId: z.string().max(160), subclassId: z.string().max(160).optional(), level: z.number().int().min(1).max(20) }).strict()).max(5),
  speciesId: z.string().max(160).optional(),
  backgroundId: z.string().max(160).optional(),
  abilityMethod: z.enum(["standard-array", "manual"]),
  abilityScores,
  choiceSelections: z.record(z.array(z.string().max(160)).max(50)),
  equipmentSelections: z.record(z.array(z.string().max(160)).max(50)),
  manualValues: z.record(z.number()),
  manualActions: z.array(z.object({ id: z.string().max(160), label: z.string().max(240), expression: z.string().max(120).optional() }).strict()).max(50),
  acknowledgedIssueCodes: z.array(z.string().max(80)).max(100),
  contentFingerprint: z.string().max(120),
  status: z.enum(["active", "archived"]),
  kind: z.literal("player-character"),
  tags: z.array(z.string().max(80)).max(50),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const runtimeSchema = z.object({
  characterId: z.string().min(1).max(160),
  revision: z.number().int().min(1),
  currentHitPoints: z.number().int(),
  maximumHitPointsAtLastSync: z.number().int(),
  temporaryHitPoints: z.number().int().min(0),
  resourceUses: z.record(z.number().int().min(0)),
  resourceMaximaAtLastSync: z.record(z.number().int().min(0)),
  conditions: z.array(z.object({ conditionId: z.string().max(160), appliedAt: z.string() }).strict()).max(50),
  hitDiceRemaining: z.number().int().min(0),
  exhaustion: z.number().int().min(0),
  deathSaves: z.object({ successes: z.number().int().min(0).max(3), failures: z.number().int().min(0).max(3) }).strict(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

/**
 * Overrides travel with the character: they are durable mechanical state, and a
 * transfer that dropped them would silently change the sheet on arrival. The
 * private `reason` is excluded, and `automaticBaseline` travels as audit context
 * only — the resolver recalculates the baseline on the destination.
 */
const overrideSchema = z.object({
  targetPath: z.string().min(1).max(200),
  operation: z.enum(["replace", "add"]),
  value: z.number(),
  automaticBaseline: z.number().nullable(),
  scope: z.enum(["persistent", "until-level-up"]),
  status: z.enum(["active", "stale"]),
  sourceId: z.string().max(160).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

export const transferDocumentSchema = z.object({
  formatVersion: z.literal(TRANSFER_FORMAT_VERSION),
  kind: z.literal(TRANSFER_KIND),
  exportedAt: z.string(),
  characterFingerprint: z.string().max(120),
  contentFingerprint: z.string().max(120),
  character: characterSchema,
  runtime: runtimeSchema,
  /** Safe display summaries only: labels and numbers. */
  derivedSummary: z.record(z.string().max(120)),
  overrides: z.array(overrideSchema).max(200),
  dependencies: z.array(z.object({ id: z.string().max(160), version: z.string().max(60), revision: z.number().int(), sourceId: z.string().max(160) }).strict()).max(500),
  exclusions: z.array(z.object({ code: z.string().max(80), count: z.number().int().min(0) }).strict()).max(50),
}).strict();

export type TransferDocument = z.infer<typeof transferDocumentSchema>;

/**
 * The durable fields that identify a character's state for conflict detection.
 *
 * Volatile bookkeeping is deliberately excluded: `revision`, `createdAt`,
 * `updatedAt`, `lastPlayedAt` and `contentFingerprint` change without the
 * character changing, and including them would report a spurious conflict — or,
 * for `contentFingerprint`, turn an unrelated content update into one.
 */
const FINGERPRINTED_FIELDS = [
  "id",
  "rulesetProfileId",
  "presentation",
  "name",
  "nickname",
  "pronouns",
  "level",
  "classLevels",
  "speciesId",
  "backgroundId",
  "abilityMethod",
  "abilityScores",
  "choiceSelections",
  "equipmentSelections",
  "manualValues",
  "manualActions",
  "acknowledgedIssueCodes",
  "status",
  "kind",
  "tags",
] as const satisfies readonly (keyof CharacterRecord)[];

/**
 * Lists the domain treats as sets. `classLevels` and `manualActions` keep their
 * order because position is meaningful in both.
 */
const CHARACTER_SET_PATHS = ["tags", "acknowledgedIssueCodes", "choiceSelections.*", "equipmentSelections.*"] as const;

/**
 * Stable fingerprint over the durable character aggregate.
 *
 * Overrides are included because they are durable mechanical state that travels
 * with the character: two records identical except for an armour-class override
 * are genuinely different, and omitting them made the transfer report
 * "Already current" and refuse to import the difference. Only the mechanical
 * fields participate — the private reason and the audit timestamps do not.
 */
export function computeCharacterFingerprint(
  character: CharacterRecord,
  overrides: readonly CharacterOverrideRecord[] = [],
): string {
  const subject: Record<string, unknown> = {};
  for (const field of FINGERPRINTED_FIELDS) {
    const value = character[field];
    if (value !== undefined) subject[field] = value;
  }
  subject.overrides = overrides.map(item => ({
    targetPath: item.targetPath,
    operation: item.operation,
    value: item.value,
    scope: item.scope,
    ...(item.sourceId ? { sourceId: item.sourceId } : {}),
  }));
  // Versioned prefix so the algorithm can change deliberately rather than
  // silently reinterpreting existing transfer files.
  return `cfp2:${canonicalHash(subject, { setPaths: [...CHARACTER_SET_PATHS, "overrides"] })}`;
}

export interface TransferManifest {
  characterId: ID;
  name: string;
  level: number;
  classLabel: string | null;
  rulesetId: ID;
  updatedAt: ISODate;
  dependencyCount: number;
  missingDependencyIds: readonly ID[];
  restricted: boolean;
  formatVersion: number;
  characterFingerprint: string;
  contentFingerprint: string;
  exclusions: readonly { code: string; count: number }[];
}

export type ConflictCategory = "new" | "already-current" | "conflict";
export type ConflictAction = "import" | "keep-both" | "replace";

export interface TransferPreview {
  manifest: TransferManifest;
  category: ConflictCategory;
  /** Actions the UI may offer. Cancel is always available and writes nothing. */
  availableActions: readonly ConflictAction[];
  /** Opaque token the confirm step revalidates. */
  token: string;
  issues: readonly ServiceIssue[];
}

export interface ImportReceipt {
  characterId: ID;
  characterRevision: number;
  runtimeRevision: number;
  restorePointId?: ID;
  unresolvedDependencyIds: readonly ID[];
  category: ConflictCategory;
  action: ConflictAction;
}

export class CharacterTransferService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;
  /** Previews are held in memory only; confirm revalidates the token anyway. */
  private readonly previews = new Map<string, TransferDocument>();

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  /** Builds the safe standard transfer artifact. Reads no private full text. */
  async createTransfer(characterId: ID): Promise<ServiceOutcome<{ document: TransferDocument; json: string; manifest: TransferManifest }>> {
    const { repositories } = this.context;
    const character = await repositories.characters.get(characterId);
    if (!character) return notFound(characterId);
    const [runtime, overrides, entries, ruleset] = await Promise.all([
      repositories.runtime.get(characterId),
      repositories.overrides.listByCharacter(characterId),
      repositories.content.listEntries(),
      repositories.content.getRuleset(character.rulesetProfileId),
    ]);
    if (!runtime) return notFound(characterId);

    const sheet = resolveDerivedCharacter({ character, runtime, overrides, entries, ...(ruleset ? { ruleset } : {}) });
    const referencedIds = new Set<ID>([
      ...character.classLevels.map(item => item.classId),
      ...(character.speciesId ? [character.speciesId] : []),
      ...(character.backgroundId ? [character.backgroundId] : []),
      ...Object.values(character.choiceSelections).flat(),
      ...sheet.equipment.map(item => item.itemId),
    ]);
    const dependencies = entries
      .filter(entry => referencedIds.has(entry.id))
      .map(entry => ({ id: entry.id, version: entry.version, revision: entry.revision, sourceId: entry.sourceId }))
      .sort((left, right) => left.id.localeCompare(right.id));

    // A standard transfer rejects restricted content instead of prompting here.
    const restricted = entries.filter(entry => referencedIds.has(entry.id) && entry.exportRestricted);
    if (restricted.length)
      return invalid(restricted.map(entry => ({ code: "RESTRICTED_ENTRY_EXCLUDED_FROM_STANDARD_TRANSFER", recordId: entry.id, severity: "error" as const })));

    const exclusions = [
      { code: "PRIVATE_FULL_TEXT", count: entries.filter(entry => referencedIds.has(entry.id) && entry.fullText).length },
      { code: "OVERRIDE_REASON", count: overrides.filter(override => override.reason).length },
      { code: "ACTION_LOG_NOTES", count: (await repositories.actions.listByCharacter(characterId)).filter(action => action.note).length },
    ];

    const document: TransferDocument = {
      formatVersion: TRANSFER_FORMAT_VERSION,
      kind: TRANSFER_KIND,
      exportedAt: this.clock(),
      characterFingerprint: computeCharacterFingerprint(character, overrides),
      contentFingerprint: computeContentFingerprint(entries, character.rulesetProfileId),
      character: { ...character, abilityScores: { ...character.abilityScores } } as TransferDocument["character"],
      runtime: { ...runtime } as TransferDocument["runtime"],
      derivedSummary: derivedSnapshotOf(sheet, this.clock()).summary,
      // Sanitized: the private reason never leaves the device.
      overrides: overrides.map(({ targetPath, operation, value, automaticBaseline, scope, status, sourceId, createdAt, updatedAt }) => ({
        targetPath,
        operation,
        value,
        automaticBaseline,
        scope,
        status,
        ...(sourceId ? { sourceId } : {}),
        createdAt,
        updatedAt,
      })),
      dependencies,
      exclusions,
    };
    const parsed = transferDocumentSchema.safeParse(document);
    if (!parsed.success)
      return invalid(parsed.error.issues.map(issue => ({ code: "TRANSFER_SHAPE_INVALID", fieldPath: issue.path.join("."), severity: "error" as const })));

    this.log({ operation: "transfer.export", recordId: characterId, fingerprint: document.characterFingerprint, counts: { dependencies: dependencies.length } });
    return ok({
      document: parsed.data,
      json: JSON.stringify(parsed.data, null, 2),
      manifest: this.manifestOf(parsed.data, sheet.classLabel, []),
    });
  }

  /** Validates and plans without mutating anything. */
  async preview(json: string): Promise<ServiceOutcome<TransferPreview>> {
    if (new TextEncoder().encode(json).byteLength > MAX_TRANSFER_BYTES)
      return invalid([{ code: "TRANSFER_TOO_LARGE", severity: "error" }]);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(json);
      inspect(parsedJson);
    } catch (error) {
      const code = error instanceof SyntaxError ? "TRANSFER_NOT_JSON" : "TRANSFER_UNSAFE_STRUCTURE";
      return invalid([{ code, severity: "error" }]);
    }
    const parsed = transferDocumentSchema.safeParse(parsedJson);
    if (!parsed.success)
      // Field paths only; a rejected value is never echoed.
      return invalid(parsed.error.issues.map(issue => ({ code: "TRANSFER_SHAPE_INVALID", fieldPath: issue.path.join("."), severity: "error" as const })));

    const document = parsed.data;
    const { repositories } = this.context;
    const [existing, entries, localOverrides] = await Promise.all([
      repositories.characters.get(document.character.id),
      repositories.content.listEntries(),
      repositories.overrides.listByCharacter(document.character.id),
    ]);
    const availableIds = new Set(entries.map(entry => entry.id));
    const missingDependencyIds = document.dependencies.filter(item => !availableIds.has(item.id)).map(item => item.id);

    const category: ConflictCategory = !existing
      ? "new"
      : computeCharacterFingerprint(existing, localOverrides) === document.characterFingerprint
        ? "already-current"
        : "conflict";
    const availableActions: ConflictAction[] =
      category === "new" ? ["import"] : category === "already-current" ? [] : ["keep-both", "replace"];

    const token = `${document.characterFingerprint}:${document.contentFingerprint}`;
    this.previews.set(token, document);

    const classLabel = entries.find(entry => entry.id === document.character.classLevels[0]?.classId)?.name ?? null;
    this.log({ operation: "transfer.preview", recordId: document.character.id, fingerprint: document.characterFingerprint, counts: { missing: missingDependencyIds.length } });
    return ok({
      manifest: this.manifestOf(document, classLabel, missingDependencyIds),
      category,
      availableActions,
      token,
      issues: missingDependencyIds.map(id => ({ code: "DEPENDENCY_MISSING", recordId: id, severity: "warning" as const })),
    });
  }

  /** Atomic import of a confirmed preview. There is no field-level merge. */
  async confirm(
    token: string,
    action: ConflictAction,
    operationId: ID,
    expectedDestinationRevision?: number,
  ): Promise<ServiceOutcome<ImportReceipt>> {
    const document = this.previews.get(token);
    if (!document) return invalid([{ code: "PREVIEW_EXPIRED", severity: "error" }]);
    const { database, repositories } = this.context;
    const now = this.clock();

    const outcome = await database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterSnapshots,
        database.characterRuntimeStates,
        database.characterOverrides,
        database.characterActions,
        database.characterDerivedSnapshots,
        database.contentEntries,
      ],
      async (): Promise<ServiceOutcome<ImportReceipt>> => {
        const entries = await repositories.content.listEntries();
        const availableIds = new Set(entries.map(entry => entry.id));
        const unresolvedDependencyIds = document.dependencies.filter(item => !availableIds.has(item.id)).map(item => item.id);
        const existing = await repositories.characters.get(document.character.id);
        const localOverrides = existing ? await repositories.overrides.listByCharacter(existing.id) : [];

        // Revalidate the conflict category against confirmation-time state.
        const category: ConflictCategory = !existing
          ? "new"
          : computeCharacterFingerprint(existing, localOverrides) === document.characterFingerprint
            ? "already-current"
            : "conflict";
        if (category === "already-current")
          return invalid([{ code: "ALREADY_CURRENT", recordId: document.character.id, severity: "warning" }]);
        if (category === "new" && action !== "import")
          return invalid([{ code: "CONFLICT_ACTION_UNAVAILABLE", recordId: document.character.id, severity: "error" }]);
        if (category === "conflict" && action === "import")
          return invalid([{ code: "CONFLICT_ACTION_REQUIRED", recordId: document.character.id, severity: "error" }]);

        const targetId = action === "keep-both" ? `${document.character.id}:imported:${operationId}` : document.character.id;
        let restorePointId: string | undefined;

        if (action === "replace" && existing) {
          if (expectedDestinationRevision === undefined || existing.revision !== expectedDestinationRevision)
            return stale(document.character.id, expectedDestinationRevision ?? -1, existing.revision);
          const outgoingRuntime = await repositories.runtime.get(existing.id);
          const outgoingOverrides = await repositories.overrides.listByCharacter(existing.id);
          const sequence = (await repositories.versions.latestSequence(existing.id)) + 1;
          const outgoingVersion: CharacterVersionRecord = {
            id: `${existing.id}@${sequence}`,
            characterId: existing.id,
            sequence,
            reason: "import",
            operationId: `${operationId}:outgoing`,
            snapshot: existing,
            createdAt: now,
            updatedAt: now,
          };
          await repositories.versions.append(outgoingVersion);
          if (outgoingRuntime) {
            const snapshot: CharacterSnapshotRecord = {
              id: `${existing.id}:restore:${sequence}`,
              characterId: existing.id,
              kind: "pre-import-replace",
              label: "Before replacing with the imported character",
              characterVersionId: outgoingVersion.id,
              runtimeState: outgoingRuntime,
              // The restore point holds the complete outgoing aggregate.
              overrides: outgoingOverrides.map(item => ({ ...item })),
              createdAt: now,
              updatedAt: now,
            };
            await repositories.snapshots.add(snapshot);
            restorePointId = snapshot.id;
          }
          // The outgoing aggregate is archived, so its character-bound state is
          // removed rather than left attached to the incoming character.
          await repositories.overrides.deleteByCharacter(existing.id);
          await repositories.actions.deleteByCharacter(existing.id);
        }

        const previousRevision = action === "replace" ? existing?.revision ?? 0 : 0;
        const character: CharacterRecord = {
          ...(document.character as unknown as CharacterRecord),
          id: targetId,
          revision: previousRevision + 1,
          // Keep both remaps the ID and marks the copy in its display name.
          name: action === "keep-both" ? `${document.character.name} (Imported copy)`.trim() : document.character.name,
          updatedAt: now,
        };
        const runtime: CharacterRuntimeStateRecord = {
          ...(document.runtime as unknown as CharacterRuntimeStateRecord),
          characterId: targetId,
          revision: 1,
          updatedAt: now,
        };

        const sequence = (await repositories.versions.latestSequence(targetId)) + 1;
        await repositories.versions.append({
          id: `${targetId}@${sequence}`,
          characterId: targetId,
          sequence,
          reason: "import",
          operationId,
          snapshot: character,
          createdAt: now,
          updatedAt: now,
        });
        if (existing && action === "replace") await repositories.characters.replace(character, existing.revision);
        else await repositories.characters.add(character);
        await repositories.runtime.put(runtime);

        // Override IDs and ownership are remapped deterministically onto the
        // target character, so Keep both cannot alias the original's records.
        const importedOverrides: CharacterOverrideRecord[] = document.overrides.map(item => ({
          id: `${targetId}:override:${item.targetPath}`,
          characterId: targetId,
          targetPath: item.targetPath,
          operation: item.operation,
          value: item.value,
          automaticBaseline: item.automaticBaseline,
          scope: item.scope,
          status: item.status,
          ...(item.sourceId ? { sourceId: item.sourceId } : {}),
          createdAt: item.createdAt,
          updatedAt: now,
        }));
        for (const override of importedOverrides) await repositories.overrides.put(override);

        const sheet = resolveDerivedCharacter({ character, runtime, overrides: importedOverrides, entries });
        await repositories.derivedSnapshots.put({
          ...derivedSnapshotOf(sheet, now),
          // An imported derived summary is recovery evidence, not a fresh calculation.
          confidence: unresolvedDependencyIds.length ? "uncertain" : sheet.confidence,
        });

        return ok({
          characterId: targetId,
          characterRevision: character.revision,
          runtimeRevision: runtime.revision,
          ...(restorePointId ? { restorePointId } : {}),
          unresolvedDependencyIds,
          category,
          action,
        });
      },
    );

    this.log({ operation: `transfer.confirm.${action}`, recordId: document.character.id, fingerprint: document.characterFingerprint });
    return outcome;
  }

  private manifestOf(document: TransferDocument, classLabel: string | null, missingDependencyIds: readonly ID[]): TransferManifest {
    return {
      characterId: document.character.id,
      name: document.character.name.trim() || "Unnamed character",
      level: document.character.level,
      classLabel,
      rulesetId: document.character.rulesetProfileId,
      updatedAt: document.character.updatedAt,
      dependencyCount: document.dependencies.length,
      missingDependencyIds,
      restricted: false,
      formatVersion: document.formatVersion,
      characterFingerprint: document.characterFingerprint,
      contentFingerprint: document.contentFingerprint,
      exclusions: document.exclusions,
    };
  }
}
