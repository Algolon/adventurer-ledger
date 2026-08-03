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
  | "PACK_INCOMPLETE"
  | "DUPLICATE_ID"
  | "PACK_VERSION_CONFLICT"
  | "ENTRY_REVISION_CONFLICT"
  | "MISSING_SOURCE"
  | "MISSING_DEPENDENCY"
  | "OPTIONAL_DEPENDENCY_MISSING"
  | "MISSING_REFERENCE"
  | "ALIAS_CONFLICT"
  | "REPLACEMENT_INVALID"
  | "DEPENDENCY_CYCLE";
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
export interface ImportSetPreview {
  readonly documents: ContentPackDocument[];
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
const importSetStates = new WeakMap<ImportSetPreview, { previews: ImportPreview[] }>();
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
  if (raw.schemaVersion !== 0 && raw.schemaVersion !== 1 && raw.schemaVersion !== 2)
    return {
      issues: [
        {
          code: "SCHEMA_UNSUPPORTED",
          severity: "error",
          message: "Only content-pack schema versions 0, 1 and 2 are supported",
          path: "schemaVersion",
        },
      ],
    };
  const issues: ImportIssue[] =
    raw.schemaVersion !== 2
      ? [
          {
            code: "MIGRATION_APPLIED",
            severity: "warning",
            message: `Schema version ${String(raw.schemaVersion)} will be migrated to version 2 in memory`,
            path: "schemaVersion",
          },
        ]
      : [];
  const validation = validateContentPackJson(json);
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
  if (document.pack.coverage !== "complete")
    issues.push({
      code: "PACK_INCOMPLETE",
      severity: "warning",
      recordId: document.pack.id,
      path: "pack.coverage",
      message: `Pack ${document.pack.id} declares ${document.pack.coverage} coverage and is not a complete source`,
    });
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

/** Validate several files as one dependency and reference namespace. */
export async function previewContentPackSet(
  jsonFiles: readonly string[],
  database: LedgerDB,
): Promise<ImportSetPreview> {
  const previews = await Promise.all(jsonFiles.map(json => previewContentPack(json, database)));
  const documents = previews.flatMap(preview => preview.document ? [preview.document] : []);
  const plan = emptyPlan();
  for (const preview of previews) {
    plan.sources.add.push(...preview.plan.sources.add); plan.sources.update.push(...preview.plan.sources.update);
    plan.packs.add.push(...preview.plan.packs.add); plan.packs.update.push(...preview.plan.packs.update);
    plan.entries.add.push(...preview.plan.entries.add); plan.entries.update.push(...preview.plan.entries.update);
  }
  const allSourceIds = documents.flatMap(document => document.sources.map(source => source.id)), sourceIds = new Set(allSourceIds);
  const entriesById = new Map(documents.flatMap(document => document.entries.map(entry => [entry.id, entry] as const)));
  const issues = previews.flatMap(preview => preview.issues).filter(issue => issue.code !== "MISSING_SOURCE" || !issue.recordId || !sourceIds.has(entriesById.get(issue.recordId)?.sourceId ?? ""));
  const packIds = documents.map(document => document.pack.id), entryIds = documents.flatMap(document => document.entries.map(entry => entry.id));
  for (const duplicate of duplicates(allSourceIds)) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: duplicate, path: "sources.id", message: `Source ID ${duplicate} occurs more than once in the import set` });
  for (const duplicate of duplicates(packIds)) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: duplicate, path: "pack.id", message: `Pack ID ${duplicate} occurs more than once in the import set` });
  for (const duplicate of duplicates(entryIds)) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: duplicate, path: "entries.id", message: `Entry ID ${duplicate} occurs more than once in the import set` });
  const importedPacks = new Set(packIds), installedPacks = new Set((await database.contentPacks.toCollection().primaryKeys()).map(String));
  for (const document of documents) {
    for (const dependency of document.pack.dependencies) if (!importedPacks.has(dependency) && !installedPacks.has(dependency)) issues.push({ code: "MISSING_DEPENDENCY", severity: "error", recordId: document.pack.id, path: "pack.dependencies", message: `Pack ${document.pack.id} requires missing dependency ${dependency}` });
    for (const dependency of document.pack.optionalDependencies) if (!importedPacks.has(dependency) && !installedPacks.has(dependency)) issues.push({ code: "OPTIONAL_DEPENDENCY_MISSING", severity: "warning", recordId: document.pack.id, path: "pack.optionalDependencies", message: `Pack ${document.pack.id} has unavailable optional dependency ${dependency}` });
  }
  const dependencies = new Map(documents.map(document => [document.pack.id, document.pack.dependencies.filter(dependency => importedPacks.has(dependency))]));
  const visiting = new Set<string>(), visited = new Set<string>();
  const checkCycle = (packId: string): boolean => {
    if (visiting.has(packId)) return true;
    if (visited.has(packId)) return false;
    visiting.add(packId);
    const cyclic = (dependencies.get(packId) ?? []).some(checkCycle);
    visiting.delete(packId); visited.add(packId); return cyclic;
  };
  for (const packId of packIds) if (checkCycle(packId)) { issues.push({ code: "DEPENDENCY_CYCLE", severity: "error", recordId: packId, path: "pack.dependencies", message: `Dependency cycle includes pack ${packId}` }); break; }
  const importedEntries = new Set(entryIds), installedEntries = new Set((await database.contentEntries.toCollection().primaryKeys()).map(String));
  const aliases = new Map<string, string>();
  for (const document of documents) for (const entry of document.entries) {
    for (const link of entry.links) if (link.required && !importedEntries.has(link.targetId) && !installedEntries.has(link.targetId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, path: "entries.links", message: `Entry ${entry.id} has an unresolved required ${link.type} reference to ${link.targetId}` });
    for (const target of [entry.replacementOf, entry.replacedBy, ...entry.editionRelations].filter((item): item is string => typeof item === "string")) if (!importedEntries.has(target) && !installedEntries.has(target)) issues.push({ code: "REPLACEMENT_INVALID", severity: "error", recordId: entry.id, path: "entries.editionRelations", message: `Entry ${entry.id} has an unresolved revision or edition relation to ${target}` });
    for (const alias of [entry.slug, ...entry.aliases].map(value => value.trim().toLocaleLowerCase()).filter(Boolean)) {
      const owner = aliases.get(alias);
      if (owner && owner !== entry.id) issues.push({ code: "ALIAS_CONFLICT", severity: "warning", recordId: entry.id, path: "entries.aliases", message: `Alias conflict between entries ${owner} and ${entry.id}` });
      else aliases.set(alias, entry.id);
    }
  }
  const result: ImportSetPreview = { documents, issues, plan, canImport: documents.length === jsonFiles.length && !issues.some(issue => issue.severity === "error") };
  importSetStates.set(result, { previews });
  return result;
}

/** Confirm every file in one Dexie transaction; any failure rolls back the set. */
export async function confirmImportSet(preview: ImportSetPreview, database: LedgerDB, signal?: AbortSignal): Promise<void> {
  const state = importSetStates.get(preview);
  if (!preview.canImport || !state) throw new Error("Import set preview is invalid or contains blocking issues");
  const byId = new Map(state.previews.flatMap(item => item.document ? [[item.document.pack.id, item] as const] : []));
  const ordered: ImportPreview[] = [], visiting = new Set<string>(), visited = new Set<string>();
  const visit = (packId: string) => {
    if (visited.has(packId)) return;
    if (visiting.has(packId)) throw new Error(`Dependency cycle includes pack ${packId}`);
    visiting.add(packId);
    const item = byId.get(packId);
    for (const dependency of item?.document?.pack.dependencies ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(packId); visited.add(packId); if (item) ordered.push(item);
  };
  for (const packId of byId.keys()) visit(packId);
  await database.transaction("rw", database.sources, database.contentPacks, database.contentEntries, database.contentPackVersions, database.contentEntryVersions, async () => {
    for (const item of ordered) { abortIfNeeded(signal); await confirmImport(item, database, signal); }
  });
}
