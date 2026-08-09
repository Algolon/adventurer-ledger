import type {
  ContentEntry,
  ContentEntryVersion,
  ContentPack,
  ContentPackVersion,
  Source,
} from "@/src/domain/model";
import { ContentOperationError } from "@/src/storage/content-operation-error";
import type { LedgerDB } from "@/src/storage/db";

const timestamp = () => new Date().toISOString();

export class SourceRepository {
  constructor(private readonly database: LedgerDB) {}
  list() {
    return this.database.sources.orderBy("name").toArray();
  }
  get(id: string) {
    return this.database.sources.get(id);
  }
  /**
   * How many installed entries name this source.
   *
   * The same count that decides whether `delete` refuses, exposed so a caller
   * can say what *would* happen before asking the user to confirm. Discovering a
   * blocking dependency only by attempting the deletion is what made removal
   * feel arbitrary.
   */
  dependentEntryCount(id: string) {
    return this.database.contentEntries.where("sourceId").equals(id).count();
  }
  async create(source: Source) {
    if (await this.get(source.id))
      throw new ContentOperationError("SOURCE_ALREADY_EXISTS", source.id, `Source ${source.id} already exists`);
    await this.database.sources.add(source);
    return source;
  }
  async update(id: string, changes: Partial<Omit<Source, "id" | "createdAt">>) {
    const current = await this.get(id);
    if (!current) throw new ContentOperationError("SOURCE_NOT_FOUND", id, `Source ${id} was not found`);
    const next = { ...current, ...changes, id, updatedAt: timestamp() };
    await this.database.sources.put(next);
    return next;
  }
  async delete(id: string) {
    const referencingEntryCount = await this.dependentEntryCount(id);
    if (referencingEntryCount)
      throw new ContentOperationError("SOURCE_REFERENCED", id, `Source ${id} is still referenced`, {
        referencingEntryCount,
      });
    await this.database.sources.delete(id);
  }
}

export class ContentPackRepository {
  constructor(private readonly database: LedgerDB) {}
  list() {
    return this.database.contentPacks.orderBy("name").toArray();
  }
  get(id: string) {
    return this.database.contentPacks.get(id);
  }
  versions(id: string) {
    return this.database.contentPackVersions
      .where("packId")
      .equals(id)
      .sortBy("sequence");
  }
  async create(pack: ContentPack) {
    if (
      (await this.get(pack.id)) ||
      (await this.database.contentPackVersions
        .where("packId")
        .equals(pack.id)
        .count())
    )
      throw new ContentOperationError(
        "PACK_ALREADY_EXISTS",
        pack.id,
        `Content pack ${pack.id} already exists or is archived`,
      );
    await this.database.contentPacks.add(pack);
    return pack;
  }
  async update(
    id: string,
    changes: Partial<Omit<ContentPack, "id" | "createdAt">>,
  ) {
    return this.database.transaction(
      "rw",
      this.database.contentPacks,
      this.database.contentPackVersions,
      async () => {
        const current = await this.get(id);
        if (!current)
          throw new ContentOperationError("PACK_NOT_FOUND", id, `Content pack ${id} was not found`);
        const history = await this.versions(id);
        const archivedAt = timestamp();
        const version: ContentPackVersion = {
          id: `${id}@${history.length + 1}`,
          packId: id,
          sequence: history.length + 1,
          reason: "edit",
          snapshot: current,
          createdAt: archivedAt,
          updatedAt: archivedAt,
        };
        const next = { ...current, ...changes, id, updatedAt: archivedAt };
        await this.database.contentPackVersions.add(version);
        await this.database.contentPacks.put(next);
        return next;
      },
    );
  }
  async delete(id: string) {
    await this.database.transaction(
      "rw",
      this.database.contentPacks,
      this.database.contentPackVersions,
      async () => {
        const current = await this.get(id);
        if (!current) return;
        const history = await this.versions(id),
          archivedAt = timestamp();
        await this.database.contentPackVersions.add({
          id: `${id}@${history.length + 1}`,
          packId: id,
          sequence: history.length + 1,
          reason: "delete",
          snapshot: current,
          createdAt: archivedAt,
          updatedAt: archivedAt,
        });
        await this.database.contentPacks.delete(id);
      },
    );
  }
}

export class ContentEntryRepository {
  constructor(private readonly database: LedgerDB) {}
  list() {
    return this.database.contentEntries.orderBy("name").toArray();
  }
  get(id: string) {
    return this.database.contentEntries.get(id);
  }
  versions(id: string) {
    return this.database.contentEntryVersions
      .where("entryId")
      .equals(id)
      .sortBy("revision");
  }
  async create(entry: ContentEntry) {
    if (
      (await this.get(entry.id)) ||
      (await this.database.contentEntryVersions
        .where("entryId")
        .equals(entry.id)
        .count())
    )
      throw new ContentOperationError(
        "ENTRY_ALREADY_EXISTS",
        entry.id,
        `Content entry ${entry.id} already exists or is archived`,
      );
    await this.database.contentEntries.add(entry);
    return entry;
  }
  async update(
    id: string,
    changes: Partial<Omit<ContentEntry, "id" | "createdAt" | "revision">>,
  ) {
    return this.database.transaction(
      "rw",
      this.database.contentEntries,
      this.database.contentEntryVersions,
      async () => {
        const current = await this.get(id);
        if (!current)
          throw new ContentOperationError("ENTRY_NOT_FOUND", id, `Content entry ${id} was not found`);
        const archivedAt = timestamp();
        const version: ContentEntryVersion = {
          id: `${id}@${current.revision}`,
          entryId: id,
          revision: current.revision,
          reason: "edit",
          snapshot: current,
          createdAt: archivedAt,
          updatedAt: archivedAt,
        };
        const next = {
          ...current,
          ...changes,
          id,
          revision: current.revision + 1,
          updatedAt: archivedAt,
        };
        await this.database.contentEntryVersions.add(version);
        await this.database.contentEntries.put(next);
        return next;
      },
    );
  }
  async delete(id: string) {
    await this.database.transaction(
      "rw",
      this.database.contentEntries,
      this.database.contentEntryVersions,
      async () => {
        const current = await this.get(id);
        if (!current) return;
        const archivedAt = timestamp(),
          revision = current.revision;
        await this.database.contentEntryVersions.add({
          id: `${id}@${revision}`,
          entryId: id,
          revision,
          reason: "delete",
          snapshot: current,
          createdAt: archivedAt,
          updatedAt: archivedAt,
        });
        await this.database.contentEntries.delete(id);
      },
    );
  }
}
