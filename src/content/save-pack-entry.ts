import type { ContentEntry, ContentPack } from "@/src/domain/model";
import {
  ContentEntryRepository,
  ContentPackRepository,
} from "@/src/storage/content-repositories";
import type { LedgerDB } from "@/src/storage/db";
import { packCoverageMatchesIdentity } from "@/src/domain/content-pack";

export interface PackEntrySave {
  editingPackId?: string;
  entry: ContentEntry;
  pack: ContentPack;
}

export async function savePackEntry(
  database: LedgerDB,
  request: PackEntrySave,
): Promise<void> {
  if (!packCoverageMatchesIdentity(request.pack.id, request.pack.name, request.pack.coverage))
    throw new Error(`Content pack ${request.pack.id} has inconsistent coverage metadata`);
  await database.transaction(
    "rw",
    database.sources,
    database.contentEntries,
    database.contentEntryVersions,
    database.contentPacks,
    database.contentPackVersions,
    async () => {
      if (!(await database.sources.get(request.entry.sourceId)))
        throw new Error(`Source ${request.entry.sourceId} was not found`);
      const entryRepository = new ContentEntryRepository(database),
        packRepository = new ContentPackRepository(database),
        currentEntry = await entryRepository.get(request.entry.id),
        currentPack = request.editingPackId
          ? await packRepository.get(request.editingPackId)
          : undefined;
      if (currentEntry) {
        const { id: _, createdAt: __, revision: ___, ...changes } = request.entry;
        await entryRepository.update(currentEntry.id, changes);
      } else await entryRepository.create(request.entry);
      if (currentPack) {
        const { id: _, createdAt: __, ...changes } = request.pack;
        await packRepository.update(currentPack.id, changes);
      } else await packRepository.create(request.pack);
    },
  );
}
