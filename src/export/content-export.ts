import type { ContentPackDocument } from "@/src/domain/content-pack";
import type { LedgerDB } from "@/src/storage/db";

export class RestrictedExportConfirmationError extends Error {
  constructor() {
    super("Restricted content export requires explicit confirmation");
    this.name = "RestrictedExportConfirmationError";
  }
}
export interface ExportOptions {
  packIds?: string[];
  includeRestricted?: boolean;
  confirmedRestrictedExport?: boolean;
}

export async function createContentExport(
  database: LedgerDB,
  options: ExportOptions = {},
): Promise<ContentPackDocument[]> {
  if (options.includeRestricted && !options.confirmedRestrictedExport)
    throw new RestrictedExportConfirmationError();
  const selected = options.packIds
    ? await database.contentPacks.where("id").anyOf(options.packIds).toArray()
    : await database.contentPacks.toArray();
  const documents: ContentPackDocument[] = [];
  for (const pack of selected) {
    if (pack.exportRestricted && !options.includeRestricted) continue;
    const entries = (
      await database.contentEntries.where("id").anyOf(pack.entryIds).toArray()
    ).filter((entry) => options.includeRestricted || !entry.exportRestricted);
    const includedSourceIds = new Set(entries.map((entry) => entry.sourceId));
    const sources = (
      await database.sources.where("id").anyOf(pack.sourceIds).toArray()
    ).filter((source) => includedSourceIds.has(source.id));
    documents.push({
      schemaVersion: 1,
      pack: {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        version: pack.version,
        rulesEditions: pack.rulesEditions,
        visibility: pack.visibility,
        licenseType: pack.licenseType,
        exportRestricted: pack.exportRestricted,
        includeFullText: pack.includeFullText,
      },
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        abbreviation: source.abbreviation,
        edition: source.edition,
        type: source.type,
        licenseType: source.licenseType,
        visibility: source.visibility,
        priority: source.priority,
        enabledByDefault: source.enabledByDefault,
        campaignIds: source.campaignIds,
        version: source.version,
        notes: source.notes,
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        slug: entry.slug,
        name: entry.name,
        aliases: entry.aliases,
        category: entry.category,
        rulesEdition: entry.rulesEdition,
        sourceId: entry.sourceId,
        sourceBook: entry.sourceBook,
        sourcePage: entry.sourcePage,
        sourceSection: entry.sourceSection,
        licenseType: entry.licenseType,
        visibility: entry.visibility,
        fullText: entry.fullText,
        summary: entry.summary,
        prerequisites: entry.prerequisites,
        choices: entry.choices,
        effects: entry.effects,
        tags: entry.tags,
        version: entry.version,
        revision: entry.revision,
        legacy: entry.legacy,
        optional: entry.optional,
        private: entry.private,
        exportRestricted: entry.exportRestricted,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    });
  }
  return documents;
}
