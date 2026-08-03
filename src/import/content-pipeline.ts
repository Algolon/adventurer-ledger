import type { ContentPackDocument } from "@/src/domain/content-pack";
import type {
  ContentEntry,
  ContentEntryVersion,
  ContentPack,
  ContentPackVersion,
  Source,
} from "@/src/domain/model";
import { validateContentPackJson } from "@/src/import/validate-pack";
import type { LedgerDB } from "@/src/storage/db";

export type ImportIssueCode =
  | "FILE_TOO_LARGE"
  | "INVALID_JSON"
  | "SCHEMA_INVALID"
  | "SCHEMA_UNSUPPORTED"
  | "MIGRATION_APPLIED"
  | "DUPLICATE_ID"
  | "PACK_VERSION_CONFLICT"
  | "ENTRY_REVISION_CONFLICT"
  | "MISSING_SOURCE";
export interface ImportIssue {
  code: ImportIssueCode;
  severity: "error" | "warning";
  message: string;
  path?: string;
  recordId?: string;
}
export interface ImportPlan {
  sources: { add: string[]; update: string[] };
  packs: { add: string[]; update: string[] };
  entries: { add: string[]; update: string[] };
}
export interface ImportPreview {
  readonly document?: ContentPackDocument;
  readonly issues: ImportIssue[];
  readonly plan: ImportPlan;
  readonly canImport: boolean;
}

interface Observations {
  sources: Map<string, string | undefined>;
  packs: Map<string, string | undefined>;
  entries: Map<string, string | undefined>;
}
interface PreviewState {
  json: string;
  observations: Observations;
}
const previewStates = new WeakMap<ImportPreview, PreviewState>();
const emptyPlan = (): ImportPlan => ({
  sources: { add: [], update: [] },
  packs: { add: [], update: [] },
  entries: { add: [], update: [] },
});
const duplicates = (ids: string[]) => [
  ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
];
const compareVersions = (left: string, right: string) => {
  const parse = (value: string) =>
    value
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left),
    b = parse(right);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
};

function parseAndMigrate(json: string): {
  document?: ContentPackDocument;
  issues: ImportIssue[];
} {
  if (new TextEncoder().encode(json).byteLength > 25 * 1024 * 1024)
    return {
      issues: [
        {
          code: "FILE_TOO_LARGE",
          severity: "error",
          message: "File exceeds the 25 MB import limit",
        },
      ],
    };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return {
      issues: [
        {
          code: "INVALID_JSON",
          severity: "error",
          message: "File is not valid JSON",
        },
      ],
    };
  }
  if (!raw || typeof raw !== "object" || !("schemaVersion" in raw))
    return {
      issues: [
        {
          code: "SCHEMA_UNSUPPORTED",
          severity: "error",
          message: "A supported content-pack schema version is required",
          path: "schemaVersion",
        },
      ],
    };
  const migrated = raw.schemaVersion === 0 ? { ...raw, schemaVersion: 1 } : raw;
  if (migrated.schemaVersion !== 1)
    return {
      issues: [
        {
          code: "SCHEMA_UNSUPPORTED",
          severity: "error",
          message: "Only content-pack schema versions 0 and 1 are supported",
          path: "schemaVersion",
        },
      ],
    };
  const issues: ImportIssue[] =
    raw.schemaVersion === 0
      ? [
          {
            code: "MIGRATION_APPLIED",
            severity: "warning",
            message: "Schema version 0 will be migrated to version 1 in memory",
            path: "schemaVersion",
          },
        ]
      : [];
  const validation = validateContentPackJson(JSON.stringify(migrated));
  if (!validation.success || !validation.data)
    return {
      issues: [
        ...issues,
        ...validation.errors.map((error) => ({
          code: "SCHEMA_INVALID" as const,
          severity: "error" as const,
          message: `Invalid value at ${error.path || "document"}: ${error.message}`,
          path: error.path,
        })),
      ],
    };
  return { document: validation.data, issues };
}

export async function previewContentPack(
  json: string,
  database: LedgerDB,
): Promise<ImportPreview> {
  const plan = emptyPlan(),
    parsed = parseAndMigrate(json);
  if (!parsed.document)
    return { issues: parsed.issues, plan, canImport: false };
  const document = parsed.document,
    issues = [...parsed.issues],
    observations: Observations = {
      sources: new Map(),
      packs: new Map(),
      entries: new Map(),
    };
  for (const id of duplicates(document.sources.map((source) => source.id)))
    issues.push({
      code: "DUPLICATE_ID",
      severity: "error",
      recordId: id,
      path: "sources",
      message: `Source ID ${id} occurs more than once`,
    });
  for (const id of duplicates(document.entries.map((entry) => entry.id)))
    issues.push({
      code: "DUPLICATE_ID",
      severity: "error",
      recordId: id,
      path: "entries",
      message: `Entry ID ${id} occurs more than once`,
    });
  const availableSources = new Set(document.sources.map((source) => source.id));
  const existingSources = await database.sources.bulkGet(
    document.sources.map((source) => source.id),
  );
  document.sources.forEach((source, index) => {
    const existing = existingSources[index];
    observations.sources.set(source.id, existing?.updatedAt);
    (existing ? plan.sources.update : plan.sources.add).push(source.id);
  });
  const externalSourceIds = [
      ...new Set(
        document.entries
          .map((entry) => entry.sourceId)
          .filter((id) => !availableSources.has(id)),
      ),
    ],
    externalSources = await database.sources.bulkGet(externalSourceIds),
    externalById = new Map(
      externalSourceIds.map((id, index) => [id, externalSources[index]]),
    );
  for (const [id, existing] of externalById)
    observations.sources.set(id, existing?.updatedAt);
  for (const entry of document.entries) {
    if (
      !availableSources.has(entry.sourceId) &&
      !externalById.get(entry.sourceId)
    )
      issues.push({
        code: "MISSING_SOURCE",
        severity: "error",
        recordId: entry.id,
        path: "entries.sourceId",
        message: `Entry ${entry.id} references missing source ${entry.sourceId}`,
      });
  }
  const existingPack = await database.contentPacks.get(document.pack.id);
  observations.packs.set(document.pack.id, existingPack?.updatedAt);
  if (existingPack) {
    if (compareVersions(document.pack.version, existingPack.version) <= 0)
      issues.push({
        code: "PACK_VERSION_CONFLICT",
        severity: "error",
        recordId: document.pack.id,
        path: "pack.version",
        message: `Pack ${document.pack.id} requires a newer version`,
      });
    else plan.packs.update.push(document.pack.id);
  } else plan.packs.add.push(document.pack.id);
  const existingEntries = await database.contentEntries.bulkGet(
    document.entries.map((entry) => entry.id),
  );
  document.entries.forEach((entry, index) => {
    const existing = existingEntries[index];
    observations.entries.set(
      entry.id,
      existing ? `${existing.revision}:${existing.updatedAt}` : undefined,
    );
    if (!existing) plan.entries.add.push(entry.id);
    else if (entry.revision <= existing.revision)
      issues.push({
        code: "ENTRY_REVISION_CONFLICT",
        severity: "error",
        recordId: entry.id,
        path: "entries.revision",
        message: `Entry ${entry.id} requires a newer revision`,
      });
    else plan.entries.update.push(entry.id);
  });
  const preview: ImportPreview = {
    document,
    issues,
    plan,
    canImport: !issues.some((issue) => issue.severity === "error"),
  };
  previewStates.set(preview, { json, observations });
  return preview;
}

const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw new DOMException("Import was cancelled", "AbortError");
};
async function assertNotStale(state: PreviewState, database: LedgerDB) {
  const sourceIds = [...state.observations.sources.keys()],
    currentSources = await database.sources.bulkGet(sourceIds);
  for (let index = 0; index < sourceIds.length; index++) {
    const id = sourceIds[index];
    if (
      id &&
      currentSources[index]?.updatedAt !== state.observations.sources.get(id)
    )
      throw new Error(`Import preview is stale for source ${id}`);
  }
  const packIds = [...state.observations.packs.keys()],
    currentPacks = await database.contentPacks.bulkGet(packIds);
  for (let index = 0; index < packIds.length; index++) {
    const id = packIds[index];
    if (
      id &&
      currentPacks[index]?.updatedAt !== state.observations.packs.get(id)
    )
      throw new Error(`Import preview is stale for pack ${id}`);
  }
  const entryIds = [...state.observations.entries.keys()],
    currentEntries = await database.contentEntries.bulkGet(entryIds);
  for (let index = 0; index < entryIds.length; index++) {
    const id = entryIds[index],
      current = currentEntries[index];
    if (
      id &&
      (current ? `${current.revision}:${current.updatedAt}` : undefined) !==
        state.observations.entries.get(id)
    )
      throw new Error(`Import preview is stale for entry ${id}`);
  }
}

export async function confirmImport(
  preview: ImportPreview,
  database: LedgerDB,
  signal?: AbortSignal,
): Promise<void> {
  const state = previewStates.get(preview);
  if (!preview.canImport || !state)
    throw new Error("Import preview is invalid or contains blocking issues");
  abortIfNeeded(signal);
  await database.transaction(
    "rw",
    database.sources,
    database.contentPacks,
    database.contentEntries,
    database.contentPackVersions,
    database.contentEntryVersions,
    async () => {
      abortIfNeeded(signal);
      await assertNotStale(state, database);
      const refreshed = await previewContentPack(state.json, database);
      if (!refreshed.canImport || !refreshed.document)
        throw new Error("Import preview no longer passes validation");
      const document = refreshed.document,
        now = new Date().toISOString();
      abortIfNeeded(signal);
      const currentPack = await database.contentPacks.get(document.pack.id),
        currentSources = await database.sources.bulkGet(
          document.sources.map((source) => source.id),
        );
      const sourceRecords: Source[] = document.sources.map(
        (incoming, index) => ({
          ...incoming,
          createdAt: currentSources[index]?.createdAt ?? now,
          updatedAt: now,
        }),
      );
      await database.sources.bulkPut(sourceRecords);
      abortIfNeeded(signal);
      const sourceIds = [
          ...new Set([
            ...document.sources.map((source) => source.id),
            ...document.entries.map((entry) => entry.sourceId),
          ]),
        ],
        entryIds = document.entries.map((entry) => entry.id);
      if (currentPack) {
        const count = await database.contentPackVersions
          .where("packId")
          .equals(currentPack.id)
          .count();
        const archived: ContentPackVersion = {
          id: `${currentPack.id}@${count + 1}`,
          packId: currentPack.id,
          sequence: count + 1,
          reason: "import",
          snapshot: currentPack,
          createdAt: now,
          updatedAt: now,
        };
        await database.contentPackVersions.add(archived);
      }
      abortIfNeeded(signal);
      const pack: ContentPack = {
        ...document.pack,
        schemaVersion: document.schemaVersion,
        sourceIds,
        entryIds,
        createdAt: currentPack?.createdAt ?? now,
        updatedAt: now,
      };
      await database.contentPacks.put(pack);
      const currentEntries = await database.contentEntries.bulkGet(
          document.entries.map((entry) => entry.id),
        ),
        histories: ContentEntryVersion[] = [],
        records: ContentEntry[] = [];
      document.entries.forEach((incoming, index) => {
        const current = currentEntries[index];
        if (current)
          histories.push({
            id: `${current.id}@${current.revision}`,
            entryId: current.id,
            revision: current.revision,
            reason: "import",
            snapshot: current,
            createdAt: now,
            updatedAt: now,
          });
        records.push({
          ...incoming,
          createdAt: current?.createdAt ?? incoming.createdAt,
          updatedAt: now,
        });
      });
      abortIfNeeded(signal);
      if (histories.length)
        await database.contentEntryVersions.bulkAdd(histories);
      await database.contentEntries.bulkPut(records);
      abortIfNeeded(signal);
    },
  );
}
