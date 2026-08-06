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
  legacyRulesetIdsForPack,
  rulesetIdCandidatesForPack,
  rulesetIdForPack,
  rulesetProfileFrom,
  type InstalledRulesetView,
  type ResolvedDependency,
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
  /**
   * True when a profile already holds one of the IDs this pack maps to,
   * including the ID an earlier derivation would have produced. Checking both is
   * what stops a re-import creating a second profile for the same pack.
   */
  alreadyInstalled: boolean;
  /** The ID it is installed under, when it already is. */
  installedRulesetId?: ID;
  /**
   * Which candidate matched.
   *
   * `current` means the profile is this pack's own derived ID, so the pack is
   * genuinely already installed. `legacy` means the match came only from the ID
   * an earlier derivation would have produced — which that derivation shared
   * with a differently-named pack. It may be this pack installed under the old
   * scheme, or it may be an unrelated pack whose current ID collides with it,
   * and the two are indistinguishable from the ID alone. Either way the install
   * refuses; the distinction exists so the refusal can say which it is.
   */
  installedMatch?: "current" | "legacy";
}

/**
 * What this import would actually do, as a single presentable answer.
 *
 * The issue list is the machine contract and stays as it is. This is the
 * headline the user reads, and it exists because "blocked" was doing the work of
 * four different outcomes: a first install, an upgrade, a re-import of what is
 * already there, and an attempt to install something older. The middle two are
 * not failures, and describing them as a blocked import — under a raw issue code
 * — is what made an ordinary re-import look like a broken app.
 */
export type InstallVerdict =
  /** Nothing installed under this pack ID yet. */
  | "install"
  /** A newer version of an installed pack. */
  | "update"
  /** Byte-for-byte the version already installed. Nothing to do. */
  | "already-current"
  /** Older than what is installed. Refused; the installed content is kept. */
  | "older-than-installed"
  /** Entry revisions are not ahead of the installed ones. Refused. */
  | "revision-conflict"
  /** Refused for a reason unrelated to versioning. */
  | "blocked";

export interface InstallPreview {
  set: ImportSetPreview;
  /** One offer per pack in the set, in the order the set declares them. */
  offers: readonly RulesetOffer[];
  issues: readonly ImportIssue[];
  canImport: boolean;
  /** The presentable outcome, derived from the issues this preview produced. */
  verdict: InstallVerdict;
  /**
   * Rulesets that already exist for the packs in this set and can still be
   * selected right now.
   *
   * A refused import must not imply that no usable content is present. When the
   * refusal is precisely that something newer is already installed, the thing
   * the user should do next is use it — so the preview names it and the UI can
   * offer it as an action rather than leaving a dead end.
   */
  usableExistingRulesets: readonly InstalledRulesetView[];
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
    // A dependency is satisfiable from another pack in the same set, so the set
    // is indexed once and consulted explicitly rather than inferred from sources.
    const inSet = new Map(set.documents.map(document => [document.pack.id, document.entries]));
    const offers = set.documents.map<RulesetOffer>(document => {
      const dependencies: ResolvedDependency[] = (document.pack.dependencies ?? []).flatMap(packId => {
        const entries = inSet.get(packId);
        return entries ? [{ packId, entries }] : [];
      });
      const proposal = proposeRulesetForPack(
        {
          id: document.pack.id,
          name: document.pack.name,
          sourceIds: document.sources.map(source => source.id),
          dependencies: document.pack.dependencies ?? [],
        },
        document.entries,
        dependencies,
      );
      return { ...proposal, ...describeInstallation(proposal.packId, installed) };
    });
    /*
     * Which existing rulesets this set's packs already have, and can still be
     * used. Read from the installed profiles rather than from the incoming
     * document, so a refusal reports what the device actually holds.
     */
    const installedViews = await this.installedRulesets();
    const offeredRulesetIds = new Set(
      offers.flatMap(offer => (offer.installedRulesetId ? [offer.installedRulesetId] : [])),
    );
    const usableExistingRulesets = installedViews.filter(
      view => view.usable && offeredRulesetIds.has(view.id),
    );
    return {
      set,
      offers,
      issues: set.issues,
      canImport: set.canImport,
      verdict: verdictFor(set.issues, set.canImport, set.plan),
      usableExistingRulesets,
    };
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
        return [
          {
            // A legacy match cannot honestly claim this pack is installed: the
            // profile it found may belong to a different pack entirely.
            code:
              offer.installedMatch === "legacy"
                ? "RULESET_LEGACY_ID_AMBIGUOUS"
                : "RULESET_ALREADY_INSTALLED",
            recordId: offer.installedRulesetId ?? offer.rulesetId,
            severity: "error" as const,
          },
        ];
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
          // the one an existing character is resolved against. Every ID this
          // pack could be installed under is checked, so a profile created by an
          // earlier derivation is not duplicated under the current one.
          let taken = false;
          for (const candidate of rulesetIdCandidatesForPack(offer.packId))
            if (await database.rulesetProfiles.get(candidate)) taken = true;
          if (taken) continue;
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
    const packsById = new Map(packs.map(pack => [pack.id, pack]));
    return packs
      .map<RulesetOffer>(pack => {
        const dependencies: ResolvedDependency[] = (pack.dependencies ?? []).flatMap(packId => {
          const dependency = packsById.get(packId);
          return dependency ? [{ packId, entries: entriesOfPack(dependency, byId, entries) }] : [];
        });
        const proposal = proposeRulesetForPack(pack, entriesOfPack(pack, byId, entries), dependencies);
        return { ...proposal, ...describeInstallation(proposal.packId, installed) };
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
        const dependencies: ResolvedDependency[] = [];
        for (const dependencyId of pack.dependencies ?? []) {
          const dependency = await database.contentPacks.get(dependencyId);
          if (dependency) dependencies.push({ packId: dependencyId, entries: entriesOfPack(dependency, byId, entries) });
        }
        const proposal = proposeRulesetForPack(pack, entriesOfPack(pack, byId, entries), dependencies);
        if (!proposal.usable)
          return invalid(
            proposal.missingCategories.map(category => ({
              code: "RULESET_CATEGORY_MISSING",
              fieldPath: `entries.category.${category}`,
              severity: "error" as const,
            })),
          );
        for (const candidate of rulesetIdCandidatesForPack(proposal.packId))
          if (await database.rulesetProfiles.get(candidate))
            return { status: "conflict", code: "RULESET_ALREADY_INSTALLED", recordId: candidate };
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
 * The presentable outcome of a preview.
 *
 * Derived from the issues rather than stored, so it cannot drift from what the
 * pipeline actually decided. Order matters: a genuine downgrade is the most
 * important thing to say, and "already current" must not be reported when
 * something older is also present in the same set.
 */
function verdictFor(
  issues: readonly ImportIssue[],
  canImport: boolean,
  plan: ImportSetPreview["plan"],
): InstallVerdict {
  if (canImport) return plan.packs.update.length ? "update" : "install";

  const versionIssues = issues.filter(issue => issue.code === "PACK_VERSION_CONFLICT");
  const older = versionIssues.some(
    issue => issue.installedVersion !== undefined && issue.incomingVersion !== issue.installedVersion,
  );
  if (older) return "older-than-installed";

  const revisionIssues = issues.filter(issue => issue.code === "ENTRY_REVISION_CONFLICT");
  const otherErrors = issues.some(
    issue =>
      issue.severity === "error" &&
      issue.code !== "PACK_VERSION_CONFLICT" &&
      issue.code !== "ENTRY_REVISION_CONFLICT",
  );
  if (otherErrors) return "blocked";

  // Every version present is the installed one. Whether entry revisions are
  // equal or behind decides which of the two benign refusals this is.
  if (versionIssues.length)
    return revisionIssues.some(
      issue => issue.incomingRevision !== undefined && issue.incomingRevision < (issue.installedRevision ?? 0),
    )
      ? "revision-conflict"
      : "already-current";
  return revisionIssues.length ? "revision-conflict" : "blocked";
}

/** Whether this pack already has a profile, under any ID it maps to. */
function describeInstallation(
  packId: ID,
  installed: ReadonlySet<ID>,
): { alreadyInstalled: boolean; installedRulesetId?: ID; installedMatch?: "current" | "legacy" } {
  const current = rulesetIdForPack(packId);
  if (installed.has(current))
    return { alreadyInstalled: true, installedRulesetId: current, installedMatch: "current" };
  const legacy = legacyRulesetIdsForPack(packId).find(candidate => installed.has(candidate));
  return legacy
    ? { alreadyInstalled: true, installedRulesetId: legacy, installedMatch: "legacy" }
    : { alreadyInstalled: false };
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
