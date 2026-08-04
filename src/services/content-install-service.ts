/**
 * ContentInstallService.
 *
 * The import pipeline installs packs, sources and entries. That is not enough to
 * make imported content reachable: every builder and resolver read is scoped to
 * a ruleset profile, so a pack with no profile is installed and invisible. This
 * service closes that gap and owns the explicit selection that follows.
 *
 * Two rules shape it:
 *
 * 1. A failed or cancelled import creates neither content nor a partial profile.
 *    Profile creation runs inside the import's own transaction, so a rollback
 *    takes it with the content.
 * 2. A ruleset is never chosen by sort order. `resolveStartingRuleset` returns a
 *    ruleset only when the user has activated one or exactly one usable profile
 *    exists; otherwise it reports the choice as ambiguous and the caller asks.
 *
 * It is also the boundary the import UI talks to, so no React component opens a
 * Dexie table to install content.
 */
import type { ContentEntry, ContentPack, ID } from "@/src/domain/model";
import {
  confirmImportSet,
  previewContentPackSet,
  type ImportIssue,
  type ImportSetPreview,
} from "@/src/import/content-pipeline";
import {
  describeInstalledRulesets,
  proposeRulesetForPack,
  rulesetProfileFrom,
  type InstalledRulesetView,
  type RulesetProposal,
} from "@/src/services/ruleset-planner";
import type { ServiceContext } from "@/src/services/character-services";
import {
  invalid,
  noopLogger,
  notFound,
  ok,
  systemClock,
  type Clock,
  type ServiceLogger,
  type ServiceOutcome,
} from "@/src/services/contracts";

/** A proposal plus what installing it would mean against current state. */
export interface RulesetOffer extends RulesetProposal {
  /** True when a profile already holds the ID this pack maps to. */
  alreadyInstalled: boolean;
}

export interface InstallPreview {
  set: ImportSetPreview;
  /** One offer per pack in the set, in the order the set declares them. */
  offers: readonly RulesetOffer[];
  issues: readonly ImportIssue[];
  canImport: boolean;
}

export interface InstallResult {
  packIds: readonly ID[];
  entryCount: number;
  createdRulesetIds: readonly ID[];
  activeRulesetId?: ID;
}

/**
 * Which ruleset a new build should start in.
 *
 * `ambiguous` is a real answer, not a failure: with more than one usable ruleset
 * installed and none activated, there is no honest default, and picking the
 * first row of a list would silently decide which content a character is built
 * against.
 */
export type RulesetSelection =
  | { kind: "none" }
  | { kind: "resolved"; rulesetId: ID; reason: "active" | "only-usable" }
  | { kind: "ambiguous"; options: readonly InstalledRulesetView[] };

export class ContentInstallService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  /** Validates the files and reports the ruleset each pack would produce. */
  async preview(jsonFiles: readonly string[]): Promise<InstallPreview> {
    const set = await previewContentPackSet(jsonFiles, this.context.database);
    const installed = new Set((await this.context.repositories.content.listRulesets()).map(profile => profile.id));
    const offers = set.documents.map<RulesetOffer>(document => {
      const proposal = proposeRulesetForPack(
        { id: document.pack.id, name: document.pack.name, sourceIds: document.sources.map(source => source.id) },
        document.entries,
      );
      return { ...proposal, alreadyInstalled: installed.has(proposal.rulesetId) };
    });
    return { set, offers, issues: set.issues, canImport: set.canImport };
  }

  /**
   * Confirms a previewed set and, for each named pack, writes its ruleset
   * profile in the same transaction.
   *
   * An unknown pack ID, or one whose profile already exists, is refused before
   * the transaction opens rather than silently skipped: quietly not creating the
   * profile the caller asked for is how content becomes unreachable again.
   */
  async confirm(
    preview: InstallPreview,
    command: {
      readonly createRulesetForPackIds?: readonly ID[];
      /** Activate the named profile once the import lands. */
      readonly activateRulesetId?: ID;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<ServiceOutcome<InstallResult>> {
    const requested = [...new Set(command.createRulesetForPackIds ?? [])];
    const offersById = new Map(preview.offers.map(offer => [offer.packId, offer]));
    const rejections = requested.flatMap(packId => {
      const offer = offersById.get(packId);
      if (!offer) return [{ code: "RULESET_PACK_NOT_IN_SET", recordId: packId, severity: "error" as const }];
      if (offer.alreadyInstalled)
        return [{ code: "RULESET_ALREADY_INSTALLED", recordId: offer.rulesetId, severity: "error" as const }];
      if (!offer.usable) return [{ code: "RULESET_NOT_USABLE", recordId: offer.rulesetId, severity: "error" as const }];
      return [];
    });
    if (rejections.length) return invalid(rejections);

    const createdRulesetIds: ID[] = [];
    try {
      await confirmImportSet(preview.set, this.context.database, command.signal, async (documents, database, now) => {
        for (const document of documents) {
          if (!requested.includes(document.pack.id)) continue;
          const offer = offersById.get(document.pack.id);
          if (!offer) continue;
          // Refuse rather than overwrite: a profile that already exists may be
          // the one an existing character is resolved against.
          if (await database.rulesetProfiles.get(offer.rulesetId)) continue;
          await database.rulesetProfiles.put(rulesetProfileFrom(offer, now));
          createdRulesetIds.push(offer.rulesetId);
        }
      });
    } catch {
      // The pipeline already rolled the whole set back; nothing was written.
      this.log({ operation: "content.install", counts: { packs: preview.set.documents.length, created: 0 } });
      return { status: "conflict", code: "IMPORT_NOT_APPLIED", recordId: preview.set.documents[0]?.pack.id ?? "import" };
    }

    let activeRulesetId: ID | undefined;
    if (command.activateRulesetId) {
      const activation = await this.activate(command.activateRulesetId);
      if (activation.status === "ok") activeRulesetId = activation.result.rulesetId;
    }

    this.log({
      operation: "content.install",
      counts: {
        packs: preview.set.documents.length,
        entries: preview.set.documents.reduce((total, document) => total + document.entries.length, 0),
        created: createdRulesetIds.length,
      },
    });
    return ok({
      packIds: preview.set.documents.map(document => document.pack.id),
      entryCount: preview.set.documents.reduce((total, document) => total + document.entries.length, 0),
      createdRulesetIds,
      ...(activeRulesetId ? { activeRulesetId } : {}),
    });
  }

  /** Installed packs that no ruleset profile yet expresses. */
  async pendingOffers(): Promise<RulesetOffer[]> {
    const { content } = this.context.repositories;
    const [packs, entries, profiles] = await Promise.all([
      content.listPacks(),
      content.listEntries(),
      content.listRulesets(),
    ]);
    const installed = new Set(profiles.map(profile => profile.id));
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    return packs
      .map<RulesetOffer>(pack => {
        const proposal = proposeRulesetForPack(pack, entriesOfPack(pack, byId, entries));
        return { ...proposal, alreadyInstalled: installed.has(proposal.rulesetId) };
      })
      .filter(offer => !offer.alreadyInstalled)
      .sort((left, right) => left.name.localeCompare(right.name) || left.packId.localeCompare(right.packId));
  }

  /** Creates the profile for a pack that is already installed. */
  async createRulesetForPack(packId: ID): Promise<ServiceOutcome<{ rulesetId: ID }>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    return database.transaction(
      "rw",
      [database.contentPacks, database.contentEntries, database.rulesetProfiles],
      async (): Promise<ServiceOutcome<{ rulesetId: ID }>> => {
        const pack = await database.contentPacks.get(packId);
        if (!pack) return notFound(packId);
        const entries = await repositories.content.listEntries();
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        const proposal = proposeRulesetForPack(pack, entriesOfPack(pack, byId, entries));
        if (!proposal.usable)
          return invalid(
            proposal.missingCategories.map(category => ({
              code: "RULESET_CATEGORY_MISSING",
              fieldPath: `entries.category.${category}`,
              severity: "error" as const,
            })),
          );
        if (await database.rulesetProfiles.get(proposal.rulesetId))
          return { status: "conflict", code: "RULESET_ALREADY_INSTALLED", recordId: proposal.rulesetId };
        await database.rulesetProfiles.put(rulesetProfileFrom(proposal, now));
        return ok({ rulesetId: proposal.rulesetId });
      },
    );
  }

  async installedRulesets(): Promise<InstalledRulesetView[]> {
    const { content } = this.context.repositories;
    const [profiles, entries] = await Promise.all([content.listRulesets(), content.listEntries()]);
    return describeInstalledRulesets(profiles, entries);
  }

  async activeRulesetId(): Promise<ID | undefined> {
    return this.context.repositories.rulesets.getActiveRulesetId();
  }

  /** Records an explicit activation. An unknown profile is refused. */
  async activate(rulesetId: ID): Promise<ServiceOutcome<{ rulesetId: ID }>> {
    const profile = await this.context.repositories.content.getRuleset(rulesetId);
    if (!profile) return notFound(rulesetId);
    await this.context.repositories.rulesets.setActiveRulesetId(rulesetId, this.clock());
    this.log({ operation: "ruleset.activate", recordId: rulesetId });
    return ok({ rulesetId });
  }

  /**
   * The ruleset a new build should start in.
   *
   * Only an explicit activation, or a single usable profile, produces an answer.
   * Anything else is reported as ambiguous so the builder asks instead of
   * letting list order decide.
   */
  async resolveStartingRuleset(): Promise<RulesetSelection> {
    const [views, active] = await Promise.all([this.installedRulesets(), this.activeRulesetId()]);
    if (!views.length) return { kind: "none" };
    if (active && views.some(view => view.id === active))
      return { kind: "resolved", rulesetId: active, reason: "active" };
    const usable = views.filter(view => view.usable);
    if (usable.length === 1) return { kind: "resolved", rulesetId: usable[0].id, reason: "only-usable" };
    return { kind: "ambiguous", options: usable.length ? usable : views };
  }
}

/**
 * The entries a pack owns.
 *
 * `entryIds` is authoritative when the pack declares it; a pack that declares
 * none falls back to its sources, which is how a locally edited pack behaves.
 */
function entriesOfPack(
  pack: Pick<ContentPack, "entryIds" | "sourceIds">,
  byId: ReadonlyMap<ID, ContentEntry>,
  all: readonly ContentEntry[],
): ContentEntry[] {
  if (pack.entryIds.length)
    return pack.entryIds.flatMap(id => {
      const entry = byId.get(id);
      return entry ? [entry] : [];
    });
  const sources = new Set(pack.sourceIds);
  return all.filter(entry => sources.has(entry.sourceId));
}

export type { InstalledRulesetView };
