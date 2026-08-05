import type { ContentPackDocument } from "@/src/domain/content-pack";
import type {
  ContentEntry,
  ContentEntryVersion,
  ContentPack,
  ContentPackVersion,
  Source,
} from "@/src/domain/model";
import type { ChoiceDefinition, Effect, EquipmentBundleNode } from "@/src/domain/model";
import { validateContentPackJson } from "@/src/import/validate-pack";
import { effectCapability } from "@/src/rules/effect-capabilities";
import { packCoveragePresentation } from "@/src/domain/pack-coverage";
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
  | "DEPENDENCY_CYCLE"
  | "MISSING_ITEM_REFERENCE"
  | "MISSING_EQUIPMENT_BUNDLE"
  | "EFFECT_REVIEW_REQUIRED"
  | "CONFLICT_POLICY_MISMATCH"
  | "CONFLICT_REVIEW_REQUIRED";
export interface ImportIssue {
  code: ImportIssueCode;
  severity: "error" | "warning";
  message: string;
  path?: string;
  recordId?: string;
  targetId?: string;
  /**
   * What is installed versus what arrived, for the version and revision
   * refusals.
   *
   * A refusal that says only "requires a newer version" leaves the user unable
   * to tell a re-import of what they already have from an attempt to install
   * something older, and those need opposite responses. Both are declared
   * numbers from pack metadata, never content, so reporting them exposes
   * nothing about the material itself.
   */
  installedVersion?: string;
  incomingVersion?: string;
  installedRevision?: number;
  incomingRevision?: number;
}
export interface ImportPlan {
  sources: { add: string[]; update: string[] };
  packs: { add: string[]; update: string[] };
  entries: { add: string[]; update: string[] };
}
/**
 * Per-document preview. It validates one file against the installed database but
 * carries no cross-file dependency, link, progression or conflict guarantee: those
 * belong to the set boundary. Confirmation always revalidates at the set boundary.
 */
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

export type ImportConfirmationCode =
  | "PREVIEW_INVALID"
  | "PREVIEW_STALE"
  | "SET_REVALIDATION_FAILED";
/**
 * Typed confirmation outcome. Nothing is written when this is thrown. Diagnostics
 * carry issue codes, stable IDs and field paths only, never imported private text.
 */
export class ImportConfirmationError extends Error {
  readonly code: ImportConfirmationCode;
  readonly issues: readonly ImportIssue[];
  constructor(
    code: ImportConfirmationCode,
    message: string,
    issues: readonly ImportIssue[] = [],
  ) {
    super(message);
    this.name = "ImportConfirmationError";
    this.code = code;
    this.issues = issues;
  }
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
/** Database state every reference, dependency and conflict check is resolved against. */
interface InstalledSnapshot {
  entries: readonly ContentEntry[];
  packIds: ReadonlySet<string>;
}
const previewStates = new WeakMap<ImportPreview, PreviewState>();
const importSetStates = new WeakMap<ImportSetPreview, { previews: ImportPreview[] }>();
const emptyPlan = (): ImportPlan => ({
  sources: { add: [], update: [] },
  packs: { add: [], update: [] },
  entries: { add: [], update: [] },
});
const duplicates = (ids: readonly string[]) => {
  const seen = new Set<string>(),
    repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) repeated.add(id);
    else seen.add(id);
  }
  return [...repeated];
};
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

async function readInstalledSnapshot(database: LedgerDB): Promise<InstalledSnapshot> {
  const entries = await database.contentEntries.toArray();
  const packIds = new Set(
    (await database.contentPacks.toCollection().primaryKeys()).map(String),
  );
  return { entries, packIds };
}

function nestedEffects(entry: Pick<ContentEntry, "effects" | "choices">): Effect[] {
  const output: Effect[] = [];
  const addEffect = (effect: Effect) => {
    output.push(effect);
    if (effect.type === "unlockAtLevel") addEffect(effect.effect);
  };
  const addChoice = (choice: ChoiceDefinition) => {
    for (const option of choice.options) {
      for (const effect of option.effects ?? []) addEffect(effect);
      for (const child of option.childChoices ?? []) addChoice(child);
    }
    for (const child of choice.childChoices ?? []) addChoice(child);
  };
  for (const effect of entry.effects) addEffect(effect);
  for (const choice of entry.choices) addChoice(choice);
  return output;
}

function runtimeCapabilityIssues(document: ContentPackDocument): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const entry of document.entries) for (const effect of nestedEffects(entry)) {
    if (effectCapability(effect.type).runtime === "review-required") issues.push({
      code: "EFFECT_REVIEW_REQUIRED",
      severity: "warning",
      recordId: entry.id,
      path: "entries.effects",
      message: `Entry ${entry.id} contains effect ${effect.id} that requires manual adjudication`,
    });
  }
  return issues;
}

function equipmentReferenceIssues(entries: readonly ContentEntry[], availableItemIds: ReadonlySet<string>, availableBundleIds: ReadonlySet<string>): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const visit = (node: EquipmentBundleNode, ownerId: string) => {
    if (node.type === "item") {
      for (const itemId of [node.itemId, ...(node.alternativeItemIds ?? [])]) if (!availableItemIds.has(itemId)) issues.push({ code: "MISSING_ITEM_REFERENCE", severity: "error", recordId: ownerId, targetId: itemId, path: "entries.equipmentBundles", message: `Entry ${ownerId} has an unresolved equipment item reference to ${itemId}` });
      return;
    }
    if (node.type === "bundle") for (const child of node.entries) visit(child, ownerId);
    else for (const option of node.options) for (const child of option.entries) visit(child, ownerId);
  };
  for (const entry of entries) {
    for (const bundle of entry.equipmentBundles ?? []) for (const node of bundle.entries) visit(node, entry.id);
    for (const effect of nestedEffects(entry)) if (effect.type === "grantEquipmentBundle" && !availableBundleIds.has(effect.bundleId)) issues.push({ code: "MISSING_EQUIPMENT_BUNDLE", severity: "error", recordId: entry.id, targetId: effect.bundleId, path: "entries.effects", message: `Entry ${entry.id} references missing equipment bundle ${effect.bundleId}` });
    if (entry.category === "background") {
      const bundleIds = (entry.mechanics as { equipmentBundleIds?: string[] }).equipmentBundleIds ?? [];
      for (const bundleId of bundleIds) if (!availableBundleIds.has(bundleId)) issues.push({ code: "MISSING_EQUIPMENT_BUNDLE", severity: "error", recordId: entry.id, targetId: bundleId, path: "entries.mechanics.equipmentBundleIds", message: `Background ${entry.id} references missing equipment bundle ${bundleId}` });
    }
  }
  return issues;
}

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

async function previewDocument(
  json: string,
  database: LedgerDB,
  installed: InstalledSnapshot,
): Promise<ImportPreview> {
  const plan = emptyPlan(),
    parsed = parseAndMigrate(json);
  if (!parsed.document)
    return { issues: parsed.issues, plan, canImport: false };
  const document = parsed.document,
    issues = [...parsed.issues, ...runtimeCapabilityIssues(parsed.document)],
    observations: Observations = {
      sources: new Map(),
      packs: new Map(),
      entries: new Map(),
    };
  if (packCoveragePresentation(document.pack.coverage).requiresWarning)
    issues.push({
      code: "PACK_INCOMPLETE",
      severity: "warning",
      recordId: document.pack.id,
      path: "pack.coverage",
      message: `Pack ${document.pack.id} declares ${packCoveragePresentation(document.pack.coverage).label.toLocaleLowerCase()} and is not a complete source`,
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
    const order = compareVersions(document.pack.version, existingPack.version);
    if (order <= 0)
      issues.push({
        code: "PACK_VERSION_CONFLICT",
        severity: "error",
        recordId: document.pack.id,
        path: "pack.version",
        /*
         * The two cases read very differently to a user and are stated
         * differently. Re-importing what is already installed is not a failure
         * and must not be described as one; installing something older is a
         * refusal, and the reason it is refused is that the newer content is
         * still there and still usable.
         */
        message:
          order === 0
            ? `Pack ${document.pack.id} is already installed at version ${existingPack.version}. Nothing needs updating.`
            : `Pack ${document.pack.id} version ${document.pack.version} is older than the installed version ${existingPack.version}, which is kept.`,
        installedVersion: existingPack.version,
        incomingVersion: document.pack.version,
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
        /*
         * Both revisions are named so the refusal can be acted on. They are
         * integers the pack declares about a record, so an ID and two numbers
         * say what happened without quoting any of the record's own text.
         */
        message:
          entry.revision === existing.revision
            ? `Entry ${entry.id} is already installed at revision ${existing.revision}.`
            : `Entry ${entry.id} revision ${entry.revision} is older than the installed revision ${existing.revision}, which is kept.`,
        installedRevision: existing.revision,
        incomingRevision: entry.revision,
      });
    else plan.entries.update.push(entry.id);
  });
  const referenceEntries = [...installed.entries, ...document.entries];
  const availableItemIds = new Set(referenceEntries.filter(entry => ["item", "weapon", "armor", "tool"].includes(entry.category)).map(entry => entry.id));
  const availableBundleIds = new Set(referenceEntries.flatMap(entry => (entry.equipmentBundles ?? []).map(bundle => bundle.id)));
  issues.push(...equipmentReferenceIssues(document.entries, availableItemIds, availableBundleIds));
  const preview: ImportPreview = {
    document,
    issues,
    plan,
    canImport: !issues.some((issue) => issue.severity === "error"),
  };
  previewStates.set(preview, { json, observations });
  return preview;
}

export async function previewContentPack(
  json: string,
  database: LedgerDB,
): Promise<ImportPreview> {
  return previewDocument(json, database, await readInstalledSnapshot(database));
}

const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted)
    throw new DOMException("Import was cancelled", "AbortError");
};
async function assertNotStale(state: PreviewState, database: LedgerDB) {
  const stale = (message: string) =>
    new ImportConfirmationError("PREVIEW_STALE", message);
  const sourceIds = [...state.observations.sources.keys()],
    currentSources = await database.sources.bulkGet(sourceIds);
  for (let index = 0; index < sourceIds.length; index++) {
    const id = sourceIds[index];
    if (
      id &&
      currentSources[index]?.updatedAt !== state.observations.sources.get(id)
    )
      throw stale(`Import preview is stale for source ${id}`);
  }
  const packIds = [...state.observations.packs.keys()],
    currentPacks = await database.contentPacks.bulkGet(packIds);
  for (let index = 0; index < packIds.length; index++) {
    const id = packIds[index];
    if (
      id &&
      currentPacks[index]?.updatedAt !== state.observations.packs.get(id)
    )
      throw stale(`Import preview is stale for pack ${id}`);
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
      throw stale(`Import preview is stale for entry ${id}`);
  }
}

/**
 * Cross-file validation. Pure with respect to `installed`, so preview and
 * confirmation run exactly the same checks against different database snapshots.
 */
function setValidationIssues(
  documents: readonly ContentPackDocument[],
  installed: InstalledSnapshot,
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const allSourceIds = documents.flatMap(document => document.sources.map(source => source.id));
  const packIds = documents.map(document => document.pack.id), entryIds = documents.flatMap(document => document.entries.map(entry => entry.id));
  for (const duplicate of duplicates(allSourceIds)) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: duplicate, path: "sources.id", message: `Source ID ${duplicate} occurs more than once in the import set` });
  for (const duplicate of duplicates(packIds)) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: duplicate, path: "pack.id", message: `Pack ID ${duplicate} occurs more than once in the import set` });
  for (const duplicate of duplicates(entryIds)) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: duplicate, path: "entries.id", message: `Entry ID ${duplicate} occurs more than once in the import set` });
  const importedPacks = new Set(packIds);
  for (const document of documents) {
    for (const dependency of document.pack.dependencies) if (!importedPacks.has(dependency) && !installed.packIds.has(dependency)) issues.push({ code: "MISSING_DEPENDENCY", severity: "error", recordId: document.pack.id, targetId: dependency, path: "pack.dependencies", message: `Pack ${document.pack.id} requires missing dependency ${dependency}` });
    for (const dependency of document.pack.optionalDependencies) if (!importedPacks.has(dependency) && !installed.packIds.has(dependency)) issues.push({ code: "OPTIONAL_DEPENDENCY_MISSING", severity: "warning", recordId: document.pack.id, targetId: dependency, path: "pack.optionalDependencies", message: `Pack ${document.pack.id} has unavailable optional dependency ${dependency}` });
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
  const importedEntries = new Set(entryIds), installedEntries = new Set(installed.entries.map(entry => entry.id));
  const combinedEntryRecords = [...new Map([...installed.entries, ...documents.flatMap(document => document.entries)].map(entry => [entry.id, entry] as const)).values()];
  const bundleOwners = new Map<string, string>();
  for (const entry of combinedEntryRecords) for (const bundle of entry.equipmentBundles ?? []) {
    const owner = bundleOwners.get(bundle.id);
    if (owner && owner !== entry.id) issues.push({ code: "DUPLICATE_ID", severity: "error", recordId: bundle.id, path: "entries.equipmentBundles", message: `Equipment bundle ID ${bundle.id} occurs more than once` });
    else bundleOwners.set(bundle.id, entry.id);
  }
  const availableBundleIds = new Set(bundleOwners.keys());
  const availableItemIds = new Set(combinedEntryRecords.filter(entry => ["item", "weapon", "armor", "tool"].includes(entry.category)).map(entry => entry.id));
  issues.push(...equipmentReferenceIssues(documents.flatMap(document => document.entries), availableItemIds, availableBundleIds));
  const aliases = new Map<string, string>();
  for (const document of documents) for (const entry of document.entries) {
    const inspectChoice = (choice: ChoiceDefinition) => {
      for (const option of choice.options) {
        if (option.entryId && !importedEntries.has(option.entryId) && !installedEntries.has(option.entryId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId: option.entryId, path: "entries.choices", message: `Entry ${entry.id} has an unresolved choice reference to ${option.entryId}` });
        for (const child of option.childChoices ?? []) inspectChoice(child);
      }
      for (const child of choice.childChoices ?? []) inspectChoice(child);
    };
    for (const choice of entry.choices) inspectChoice(choice);
    if (entry.category === "class") {
      const mechanics = entry.mechanics as { progression: Array<{ featureIds: string[]; choiceIds: string[] }>; subclassIds: string[]; savingThrows: string[]; startingProficiencyIds: string[]; multiclass?: { grantedProficiencyIds: string[] } };
      for (const targetId of [...mechanics.progression.flatMap(row => row.featureIds), ...mechanics.subclassIds, ...mechanics.savingThrows, ...mechanics.startingProficiencyIds, ...(mechanics.multiclass?.grantedProficiencyIds ?? [])]) if (!importedEntries.has(targetId) && !installedEntries.has(targetId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId, path: "entries.mechanics.progression", message: `Class ${entry.id} has an unresolved progression reference to ${targetId}` });
      const knownChoiceIds = new Set(entry.choices.map(choice => choice.id));
      for (const choiceId of mechanics.progression.flatMap(row => row.choiceIds)) if (!knownChoiceIds.has(choiceId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId: choiceId, path: "entries.mechanics.progression.choiceIds", message: `Class ${entry.id} has an unresolved progression choice ${choiceId}` });
    }
    if (entry.category === "subclass") {
      const mechanics = entry.mechanics as { classId: string; progression: Array<{ featureIds: string[]; choiceIds: string[] }> };
      for (const targetId of [mechanics.classId, ...mechanics.progression.flatMap(row => row.featureIds)]) if (!importedEntries.has(targetId) && !installedEntries.has(targetId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId, path: "entries.mechanics.progression", message: `Subclass ${entry.id} has an unresolved progression reference to ${targetId}` });
      const knownChoiceIds = new Set(entry.choices.map(choice => choice.id));
      for (const choiceId of mechanics.progression.flatMap(row => row.choiceIds)) if (!knownChoiceIds.has(choiceId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId: choiceId, path: "entries.mechanics.progression.choiceIds", message: `Subclass ${entry.id} has an unresolved progression choice ${choiceId}` });
    }
    if (entry.category === "background") {
      const mechanics = entry.mechanics as { featId: string; proficiencyIds: string[]; equipmentChoiceIds: string[] };
      for (const targetId of [mechanics.featId, ...mechanics.proficiencyIds, ...mechanics.equipmentChoiceIds]) if (!importedEntries.has(targetId) && !installedEntries.has(targetId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId, path: "entries.mechanics", message: `Background ${entry.id} has an unresolved mechanics reference to ${targetId}` });
    }
    for (const link of entry.links) if (link.required && !importedEntries.has(link.targetId) && !installedEntries.has(link.targetId)) issues.push({ code: "MISSING_REFERENCE", severity: "error", recordId: entry.id, targetId: link.targetId, path: "entries.links", message: `Entry ${entry.id} has an unresolved required ${link.type} reference to ${link.targetId}` });
    for (const target of [entry.replacementOf, entry.replacedBy, ...entry.editionRelations].filter((item): item is string => typeof item === "string")) if (!importedEntries.has(target) && !installedEntries.has(target)) issues.push({ code: "REPLACEMENT_INVALID", severity: "error", recordId: entry.id, targetId: target, path: "entries.editionRelations", message: `Entry ${entry.id} has an unresolved revision or edition relation to ${target}` });
    for (const alias of [entry.slug, ...entry.aliases].map(value => value.trim().toLocaleLowerCase()).filter(Boolean)) {
      const owner = aliases.get(alias);
      if (owner && owner !== entry.id) issues.push({ code: "ALIAS_CONFLICT", severity: "warning", recordId: entry.id, path: "entries.aliases", message: `Alias conflict between entries ${owner} and ${entry.id}` });
      else aliases.set(alias, entry.id);
    }
  }
  const conflictGroups = new Map<string, ContentEntry[]>();
  for (const entry of combinedEntryRecords) if (entry.conflict.conflictKey) {
    const group = conflictGroups.get(entry.conflict.conflictKey) ?? [];
    group.push(entry); conflictGroups.set(entry.conflict.conflictKey, group);
  }
  for (const [key, group] of conflictGroups) if (group.length > 1) {
    const policies = new Set(group.map(entry => entry.conflict.resolution));
    if (policies.size > 1) issues.push({ code: "CONFLICT_POLICY_MISMATCH", severity: "error", recordId: key, path: "entries.conflict.resolution", message: `Conflict group ${key} declares inconsistent resolution policies` });
    else if (policies.has("explicit-selection")) issues.push({ code: "CONFLICT_REVIEW_REQUIRED", severity: "warning", recordId: key, path: "entries.conflict.resolution", message: `Conflict group ${key} requires an explicit user selection` });
  }
  return issues;
}

interface BuiltSetPreview {
  previews: ImportPreview[];
  documents: ContentPackDocument[];
  issues: ImportIssue[];
  plan: ImportPlan;
  canImport: boolean;
}

async function buildSetPreview(
  jsonFiles: readonly string[],
  database: LedgerDB,
  installed: InstalledSnapshot,
): Promise<BuiltSetPreview> {
  const previews: ImportPreview[] = [];
  for (const json of jsonFiles) previews.push(await previewDocument(json, database, installed));
  const documents = previews.flatMap(preview => preview.document ? [preview.document] : []);
  const plan = emptyPlan();
  for (const preview of previews) {
    plan.sources.add.push(...preview.plan.sources.add); plan.sources.update.push(...preview.plan.sources.update);
    plan.packs.add.push(...preview.plan.packs.add); plan.packs.update.push(...preview.plan.packs.update);
    plan.entries.add.push(...preview.plan.entries.add); plan.entries.update.push(...preview.plan.entries.update);
  }
  const sourceIds = new Set(documents.flatMap(document => document.sources.map(source => source.id)));
  const entriesById = new Map(documents.flatMap(document => document.entries.map(entry => [entry.id, entry] as const)));
  const issues = previews.flatMap(preview => preview.issues).filter(issue =>
    issue.code !== "MISSING_ITEM_REFERENCE" && issue.code !== "MISSING_EQUIPMENT_BUNDLE" &&
    (issue.code !== "MISSING_SOURCE" || !issue.recordId || !sourceIds.has(entriesById.get(issue.recordId)?.sourceId ?? ""))
  );
  issues.push(...setValidationIssues(documents, installed));
  return {
    previews,
    documents,
    issues,
    plan,
    canImport: documents.length === jsonFiles.length && !issues.some(issue => issue.severity === "error"),
  };
}

/** Validate several files as one dependency and reference namespace. */
export async function previewContentPackSet(
  jsonFiles: readonly string[],
  database: LedgerDB,
): Promise<ImportSetPreview> {
  const built = await buildSetPreview(
    jsonFiles,
    database,
    await readInstalledSnapshot(database),
  );
  const result: ImportSetPreview = {
    documents: built.documents,
    issues: built.issues,
    plan: built.plan,
    canImport: built.canImport,
  };
  importSetStates.set(result, { previews: built.previews });
  return result;
}

/** Dependencies first, so a dependent pack never observes a half-installed set. */
function orderDocuments(documents: readonly ContentPackDocument[]): ContentPackDocument[] {
  const byId = new Map(documents.map(document => [document.pack.id, document] as const));
  const ordered: ContentPackDocument[] = [], visiting = new Set<string>(), visited = new Set<string>();
  const visit = (packId: string) => {
    if (visited.has(packId)) return;
    if (visiting.has(packId)) throw new ImportConfirmationError("SET_REVALIDATION_FAILED", `Dependency cycle includes pack ${packId}`, [{ code: "DEPENDENCY_CYCLE", severity: "error", recordId: packId, path: "pack.dependencies", message: `Dependency cycle includes pack ${packId}` }]);
    visiting.add(packId);
    const document = byId.get(packId);
    for (const dependency of document?.pack.dependencies ?? []) if (byId.has(dependency)) visit(dependency);
    visiting.delete(packId); visited.add(packId); if (document) ordered.push(document);
  };
  for (const packId of byId.keys()) visit(packId);
  return ordered;
}

async function writeDocument(
  document: ContentPackDocument,
  database: LedgerDB,
  now: string,
  signal?: AbortSignal,
): Promise<void> {
  abortIfNeeded(signal);
  const currentPack = await database.contentPacks.get(document.pack.id),
    currentSources = await database.sources.bulkGet(
      document.sources.map((source) => source.id),
    );
  const sourceRecords: Source[] = document.sources.map((incoming, index) => ({
    ...incoming,
    createdAt: currentSources[index]?.createdAt ?? now,
    updatedAt: now,
  }));
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
  if (histories.length) await database.contentEntryVersions.bulkAdd(histories);
  await database.contentEntries.bulkPut(records);
  abortIfNeeded(signal);
}

/**
 * Work that must land with the content or not at all.
 *
 * Creating a ruleset profile for an imported pack is the motivating case: a
 * profile written after the transaction could survive a rolled-back import and
 * point at content that was never installed, which is exactly the half-installed
 * state the set boundary exists to prevent. Running it inside the transaction
 * makes a failed or cancelled import leave neither content nor a partial profile.
 */
export type ImportSideEffect = (
  documents: readonly ContentPackDocument[],
  database: LedgerDB,
  now: string,
) => Promise<void>;

/**
 * The single confirmation boundary for every import. One flat Dexie transaction
 * asserts preview freshness, revalidates the complete set against confirmation-time
 * database state, and only then writes packs, sources, entries and history. Any
 * failure or cancellation rolls back every file in the set.
 */
async function commitImportStates(
  states: readonly PreviewState[],
  database: LedgerDB,
  signal?: AbortSignal,
  afterWrite?: ImportSideEffect,
): Promise<void> {
  abortIfNeeded(signal);
  await database.transaction(
    "rw",
    [
      database.sources,
      database.contentPacks,
      database.contentEntries,
      database.contentPackVersions,
      database.contentEntryVersions,
      database.rulesetProfiles,
    ],
    async () => {
      abortIfNeeded(signal);
      for (const state of states) await assertNotStale(state, database);
      abortIfNeeded(signal);
      const revalidated = await buildSetPreview(
        states.map((state) => state.json),
        database,
        await readInstalledSnapshot(database),
      );
      if (!revalidated.canImport)
        throw new ImportConfirmationError(
          "SET_REVALIDATION_FAILED",
          "Import set no longer passes validation at confirmation time",
          revalidated.issues.filter((issue) => issue.severity === "error"),
        );
      const now = new Date().toISOString();
      const ordered = orderDocuments(revalidated.documents);
      for (const document of ordered) await writeDocument(document, database, now, signal);
      abortIfNeeded(signal);
      if (afterWrite) await afterWrite(ordered, database, now);
      abortIfNeeded(signal);
    },
  );
}

/**
 * Confirm one previewed file. The document is revalidated as a one-file import set,
 * so a single-file import cannot bypass the dependency, reference and conflict
 * guarantees of the set boundary.
 */
export async function confirmImport(
  preview: ImportPreview,
  database: LedgerDB,
  signal?: AbortSignal,
  afterWrite?: ImportSideEffect,
): Promise<void> {
  const state = previewStates.get(preview);
  if (!preview.canImport || !state)
    throw new ImportConfirmationError(
      "PREVIEW_INVALID",
      "Import preview is invalid or contains blocking issues",
    );
  await commitImportStates([state], database, signal, afterWrite);
}

/** Confirm every file in one Dexie transaction; any failure rolls back the set. */
export async function confirmImportSet(
  preview: ImportSetPreview,
  database: LedgerDB,
  signal?: AbortSignal,
  afterWrite?: ImportSideEffect,
): Promise<void> {
  const setState = importSetStates.get(preview);
  if (!preview.canImport || !setState)
    throw new ImportConfirmationError(
      "PREVIEW_INVALID",
      "Import set preview is invalid or contains blocking issues",
    );
  const states = setState.previews.map((item) => {
    const state = previewStates.get(item);
    if (!state)
      throw new ImportConfirmationError(
        "PREVIEW_INVALID",
        "Import set preview state is unavailable",
      );
    return state;
  });
  await commitImportStates(states, database, signal, afterWrite);
}
