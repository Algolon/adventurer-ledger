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
  CharacterLibraryService,
  CharacterOverrideService,
  CharacterQueryService,
  type ServiceContext,
} from "@/src/services/character-services";
import { CharacterRuntimeService } from "@/src/services/runtime-service";
import { CharacterLevelUpService } from "@/src/services/levelup-service";
import { CharacterTransferService } from "@/src/services/transfer-service";
import { ContentInstallService } from "@/src/services/content-install-service";
import type { ServiceLogLine } from "@/src/services/contracts";
import { acceptancePackJson, ACCEPTANCE_PACK_ID, ACCEPTANCE_RULESET_ID } from "@/tests/fixtures/acceptance-ruleset";

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
  library: CharacterLibraryService;
  install: ContentInstallService;
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
    library: new CharacterLibraryService(context),
    install: new ContentInstallService(context),
    logLines,
    tick: () => {
      seconds += 1;
    },
  };
}

/**
 * Installs the acceptance pack the way a user would: through the import
 * boundary, with the ruleset profile created in the same confirmation. Tests
 * that assert imported content is reachable must reach it by the real route.
 */
export async function installAcceptanceRuleset(harness: Harness, { createRuleset = true } = {}): Promise<void> {
  const preview = await harness.install.preview([acceptancePackJson()]);
  if (!preview.canImport)
    throw new Error(`The acceptance pack did not validate: ${preview.issues.map(issue => issue.code).join(", ")}`);
  const outcome = await harness.install.confirm(preview, {
    ...(createRuleset ? { createRulesetForPackIds: [ACCEPTANCE_PACK_ID] } : {}),
  });
  if (outcome.status !== "ok") throw new Error(`The acceptance import failed: ${JSON.stringify(outcome)}`);
  if (createRuleset && !outcome.result.createdRulesetIds.includes(ACCEPTANCE_RULESET_ID))
    throw new Error("The acceptance import created no ruleset profile");
}

export async function closeHarnesses(): Promise<void> {
  while (open.length) open.pop()?.close();
}

/** Narrows a service outcome to its success payload, failing loudly otherwise. */
export function expectOk<T>(outcome: { status: string } & Record<string, unknown>): T {
  if (outcome.status !== "ok") throw new Error(`Expected an ok outcome but received ${JSON.stringify(outcome)}`);
  return outcome.result as T;
}
