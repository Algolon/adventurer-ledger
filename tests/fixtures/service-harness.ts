/**
 * Dexie test harness for the M2.1 character services.
 *
 * Each harness opens an isolated database seeded with the synthetic slice, wires
 * the real repositories and services, and supplies a deterministic clock so
 * results are reproducible.
 */
import { LedgerDB } from "@/src/storage/db";
import { createCharacterRepositories } from "@/src/storage/character-repositories";
import { seedSyntheticContent } from "@/src/content/seed-synthetic";
import {
  CharacterBuildCommitService,
  CharacterDraftService,
  CharacterOverrideService,
  CharacterQueryService,
  type ServiceContext,
} from "@/src/services/character-services";
import { CharacterRuntimeService } from "@/src/services/runtime-service";
import { CharacterLevelUpService } from "@/src/services/levelup-service";
import { CharacterTransferService } from "@/src/services/transfer-service";
import type { ServiceLogLine } from "@/src/services/contracts";

const open: LedgerDB[] = [];

export interface Harness {
  database: LedgerDB;
  context: ServiceContext;
  drafts: CharacterDraftService;
  commit: CharacterBuildCommitService;
  query: CharacterQueryService;
  runtime: CharacterRuntimeService;
  levelUp: CharacterLevelUpService;
  transfer: CharacterTransferService;
  overrides: CharacterOverrideService;
  logLines: ServiceLogLine[];
  /** Advances the deterministic clock by one second. */
  tick(): void;
}

export async function createHarness(): Promise<Harness> {
  const database = new LedgerDB(`ledger-service-${Math.random().toString(36).slice(2)}`);
  open.push(database);
  await database.open();
  await seedSyntheticContent(database, "2026-08-03T08:00:00.000Z");

  let seconds = 0;
  const logLines: ServiceLogLine[] = [];
  const context: ServiceContext = {
    database,
    repositories: createCharacterRepositories(database),
    clock: () => new Date(Date.UTC(2026, 7, 3, 9, 0, seconds)).toISOString(),
    logger: line => logLines.push(line),
  };

  return {
    database,
    context,
    drafts: new CharacterDraftService(context),
    commit: new CharacterBuildCommitService(context),
    query: new CharacterQueryService(context),
    runtime: new CharacterRuntimeService(context),
    levelUp: new CharacterLevelUpService(context),
    transfer: new CharacterTransferService(context),
    overrides: new CharacterOverrideService(context),
    logLines,
    tick: () => {
      seconds += 1;
    },
  };
}

export async function closeHarnesses(): Promise<void> {
  while (open.length) open.pop()?.close();
}

/** Narrows a service outcome to its success payload, failing loudly otherwise. */
export function expectOk<T>(outcome: { status: string } & Record<string, unknown>): T {
  if (outcome.status !== "ok") throw new Error(`Expected an ok outcome but received ${JSON.stringify(outcome)}`);
  return outcome.result as T;
}
