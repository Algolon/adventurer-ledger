/**
 * Installs the accepted synthetic slice content.
 *
 * The seed is idempotent and transactional: it writes the source, pack, entries
 * and ruleset profile in one Dexie transaction, and re-running it upgrades those
 * records in place without touching any other pack, source or character. It is
 * the only way M2.1 puts content in the database outside the existing import
 * pipeline, and it installs original synthetic material only.
 */
import type { ContentEntry, ContentPack, Source } from "@/src/domain/model";
import type { LedgerDB } from "@/src/storage/db";
import {
  SYNTHETIC_ENTRIES,
  SYNTHETIC_PACK_ID,
  SYNTHETIC_RULESET,
  SYNTHETIC_RULESET_ID,
  SYNTHETIC_SOURCE_ID,
  syntheticRunefolioPack,
} from "@/src/content/runefolio-synthetic";

export interface SeedResult {
  installed: boolean;
  entryCount: number;
  rulesetId: string;
}

/** True when the synthetic slice is already installed at the current revision. */
export async function isSyntheticSeedInstalled(database: LedgerDB): Promise<boolean> {
  const pack = await database.contentPacks.get(SYNTHETIC_PACK_ID);
  if (!pack) return false;
  const count = await database.contentEntries.where("sourceId").equals(SYNTHETIC_SOURCE_ID).count();
  return count === SYNTHETIC_ENTRIES.length;
}

export async function seedSyntheticContent(database: LedgerDB, now = new Date().toISOString()): Promise<SeedResult> {
  if (await isSyntheticSeedInstalled(database))
    return { installed: false, entryCount: SYNTHETIC_ENTRIES.length, rulesetId: SYNTHETIC_RULESET_ID };

  // Parsing here means an invalid seed fails before any write happens.
  const document = syntheticRunefolioPack();

  await database.transaction(
    "rw",
    [database.contentPacks, database.contentEntries, database.sources, database.rulesetProfiles],
    async () => {
      const source: Source = { ...document.sources[0], createdAt: now, updatedAt: now } as Source;
      await database.sources.put(source);

      const entries = document.entries as unknown as ContentEntry[];
      await database.contentEntries.bulkPut(entries);

      const pack: ContentPack = {
        ...document.pack,
        schemaVersion: document.schemaVersion,
        sourceIds: [SYNTHETIC_SOURCE_ID],
        entryIds: entries.map(entry => entry.id),
        createdAt: now,
        updatedAt: now,
      };
      await database.contentPacks.put(pack);
      await database.rulesetProfiles.put({ ...SYNTHETIC_RULESET, createdAt: now, updatedAt: now });
    },
  );

  return { installed: true, entryCount: SYNTHETIC_ENTRIES.length, rulesetId: SYNTHETIC_RULESET_ID };
}
