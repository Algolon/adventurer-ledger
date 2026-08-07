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
import type { ContentEntry, ContentPack, ID, RulesetProfile } from "@/src/domain/model";
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
  reconcileRulesetMembership,
  rulesetIdCandidatesForPack,
  rulesetIdForPack,
  rulesetProfileFrom,
  rulesetProfileOwnership,
  type InstalledRulesetView,
  type ResolvedDependency,
  type RulesetProposal,
} from "@/src/services/ruleset-planner";
import type { LedgerDB } from "@/src/storage/db";
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
  /**
   * Existing profiles whose pack-owned membership advanced with this import.
   *
   * An update to an installed pack keeps the profile it already has; what has to
   * move is what that profile activates. Reporting it separately from
   * `createdRulesetIds` is what lets the import boundary say the ruleset was
   * updated rather than either claiming a new one or saying nothing at all.
   */
  updatedRulesetIds: readonly ID[];
  activeRulesetId?: ID;
}

/** One profile whose membership a reconciliation brought back into line. */
export interface RulesetMembershipRepair {
  rulesetId: ID;
  packId: ID;
  previousEntryCount: number;
  entryCount: number;
  addedEntryCount: number;
  removedEntryCount: number;
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
    const { content } = this.context.repositories;
    const set = await previewContentPackSet(jsonFiles, this.context.database);
    const [profiles, packs, entries] = await Promise.all([
      content.listRulesets(),
      content.listPacks(),
      content.listEntries(),
    ]);
    const installed = new Set(profiles.map(profile => profile.id));
    // A dependency is satisfiable from another pack in the same set, so the set
    // is indexed once and consulted explicitly rather than inferred from sources.
    const inSet = new Map(set.documents.map(document => [document.pack.id, document.entries]));
    /*
     * A declared dependency may also already be installed. Reading it from the
     * device as well as from the set is what keeps this preview describing the
     * profile the confirmation will actually write, which derives membership
     * from installed state inside its own transaction.
     */
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const installedPackEntries = new Map(packs.map(pack => [pack.id, entriesOfPack(pack, byId, entries)]));
    const offers = set.documents.map<RulesetOffer>(document => {
      const dependencies = resolveDeclaredDependencies(
        document.pack.dependencies ?? [],
        inSet,
        installedPackEntries,
      );
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
    const installedViews = describeInstalledRulesets(profiles, entries);
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
   *
   * Every written pack that *already* has a profile has that profile's
   * membership advanced in the same transaction, whether or not the caller asked
   * for anything. That is not an extra creation: it is the same logical profile,
   * under the same ID, activating the pack as it now stands. Leaving it behind is
   * what made an update install content that no ruleset could reach.
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
    const updatedRulesetIds: ID[] = [];
    try {
      await confirmImportSet(preview.set, this.context.database, command.signal, async (documents, database, now) => {
        /*
         * Read after the content is written, so membership is derived from what
         * the device now actually holds rather than from what the preview
         * expected it to hold. Inside the transaction, so a rollback takes the
         * membership change with the content it describes.
         */
        const state = await readInstalledPackState(database);
        for (const document of documents) {
          const pack = state.packsById.get(document.pack.id);
          if (!pack) continue;
          const proposal = proposalForInstalledPack(pack, state);
          const existing = await ownedProfile(pack.id, state, database);
          if (existing) {
            // The same logical profile, advanced to the pack as it now stands.
            const update = reconcileRulesetMembership(existing, proposal, now);
            if (update?.changed) {
              await database.rulesetProfiles.put(update.profile);
              updatedRulesetIds.push(existing.id);
            }
            continue;
          }
          if (!requested.includes(pack.id)) continue;
          // Refuse rather than overwrite: a profile that already exists may be
          // the one an existing character is resolved against. Every ID this
          // pack could be installed under is checked, so a profile created by an
          // earlier derivation is not duplicated under the current one.
          let taken = false;
          for (const candidate of rulesetIdCandidatesForPack(pack.id))
            if (await database.rulesetProfiles.get(candidate)) taken = true;
          if (taken) continue;
          await database.rulesetProfiles.put(rulesetProfileFrom(proposal, now));
          createdRulesetIds.push(proposal.rulesetId);
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
        updated: updatedRulesetIds.length,
      },
    });
    return ok({
      packIds: preview.set.documents.map(document => document.pack.id),
      entryCount: preview.set.documents.reduce((total, document) => total + document.entries.length, 0),
      createdRulesetIds,
      updatedRulesetIds,
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
    const { database } = this.context;
    const now = this.clock();
    return database.transaction(
      "rw",
      [database.contentPacks, database.contentEntries, database.rulesetProfiles],
      async (): Promise<ServiceOutcome<{ rulesetId: ID }>> => {
        const state = await readInstalledPackState(database);
        const pack = state.packsById.get(packId);
        if (!pack) return notFound(packId);
        const proposal = proposalForInstalledPack(pack, state);
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

  /**
   * Brings every installed pack's own profile back in line with that pack.
   *
   * This repairs a device that updated a pack before the install transaction
   * carried the profile with it: the pack is at its new version, the entries are
   * installed, and the profile is still scoped to the membership it was created
   * with. Nothing is deleted, nothing is reinstalled and no pack is downgraded.
   *
   * It is deliberately narrow. Only a profile that an installed pack
   * unambiguously owns and that already declares an explicit membership is
   * touched, and the replacement is derived from that pack's own entries plus
   * its resolved declared dependencies — never from a shared source ID and never
   * from a name. Everything else about the profile, including its ID, its name,
   * `createdAt`, its policies and any exclusions, is left exactly as it is, so a
   * character referencing it keeps resolving against the same profile.
   *
   * Idempotent: a profile that already matches its pack is not rewritten, so a
   * second run reports nothing and no `updatedAt` moves.
   */
  async reconcileInstalledRulesets(): Promise<RulesetMembershipRepair[]> {
    const { database } = this.context;
    const now = this.clock();
    const repairs = await database.transaction(
      "rw",
      [database.contentPacks, database.contentEntries, database.rulesetProfiles],
      async (): Promise<RulesetMembershipRepair[]> => {
        const state = await readInstalledPackState(database);
        const repaired: RulesetMembershipRepair[] = [];
        for (const pack of state.packs) {
          const existing = await ownedProfile(pack.id, state, database);
          if (!existing) continue;
          const update = reconcileRulesetMembership(existing, proposalForInstalledPack(pack, state), now);
          if (!update?.changed) continue;
          await database.rulesetProfiles.put(update.profile);
          repaired.push({
            rulesetId: existing.id,
            packId: pack.id,
            previousEntryCount: existing.allowedEntryIds?.length ?? 0,
            entryCount: update.profile.allowedEntryIds?.length ?? 0,
            addedEntryCount: update.addedEntryIds.length,
            removedEntryCount: update.removedEntryIds.length,
          });
        }
        return repaired;
      },
    );
    if (repairs.length)
      this.log({ operation: "ruleset.reconcile", counts: { repaired: repairs.length } });
    return repairs;
  }

  /**
   * The installed rulesets, repaired first.
   *
   * Settings is where a user goes to find out what a ruleset currently reaches,
   * so it is also where a stale profile has to stop being stale. The repair is
   * safe enough to run without asking — it can only replace a pack-derived
   * membership with the membership that same pack currently has — and running it
   * here means a device that already imported the newer pack is corrected by
   * opening the page, with nothing to reinstall and nothing to delete.
   */
  async inspectInstalledRulesets(): Promise<{
    views: InstalledRulesetView[];
    repaired: readonly RulesetMembershipRepair[];
  }> {
    const repaired = await this.reconcileInstalledRulesets();
    return { views: await this.installedRulesets(), repaired };
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
 * Declared dependencies resolved to the entries they contribute.
 *
 * A dependency may arrive in the same import set or already be installed. Both
 * are looked up by pack identity; neither widens membership by source. A
 * dependency that is available from neither is simply not resolved, and the
 * proposal reports it as missing rather than guessing at its content.
 */
function resolveDeclaredDependencies(
  declared: readonly ID[],
  fromSet: ReadonlyMap<ID, readonly ContentEntry[]>,
  fromInstalled: ReadonlyMap<ID, readonly ContentEntry[]>,
): ResolvedDependency[] {
  return declared.flatMap(packId => {
    const entries = fromSet.get(packId) ?? fromInstalled.get(packId);
    return entries ? [{ packId, entries }] : [];
  });
}

/**
 * Installed packs, the entries each one owns, and the profile IDs each owns.
 *
 * Read once and passed around, so creating a profile, updating one during an
 * import and repairing one later all derive membership from the same installed
 * state by the same rule.
 */
interface InstalledPackState {
  packs: readonly ContentPack[];
  packsById: ReadonlyMap<ID, ContentPack>;
  entriesByPack: ReadonlyMap<ID, readonly ContentEntry[]>;
  /** Profile ID to the single installed pack entitled to derive it. */
  ownership: ReadonlyMap<ID, ID>;
}

async function readInstalledPackState(database: LedgerDB): Promise<InstalledPackState> {
  const packs = await database.contentPacks.toArray();
  const entries = await database.contentEntries.toArray();
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return {
    packs,
    packsById: new Map(packs.map(pack => [pack.id, pack])),
    entriesByPack: new Map(packs.map(pack => [pack.id, entriesOfPack(pack, byId, entries)])),
    ownership: rulesetProfileOwnership(packs.map(pack => pack.id)),
  };
}

/** The profile an installed pack expresses, as installed state stands now. */
function proposalForInstalledPack(pack: ContentPack, state: InstalledPackState): RulesetProposal {
  return proposeRulesetForPack(
    pack,
    state.entriesByPack.get(pack.id) ?? [],
    resolveDeclaredDependencies(pack.dependencies ?? [], new Map(), state.entriesByPack),
  );
}

/**
 * The existing profile a pack owns, if it has one.
 *
 * The pack's current ID is preferred; a compatibility ID is accepted only when
 * no other installed pack could claim it, so a profile two packs both map to is
 * never attributed to one of them.
 */
async function ownedProfile(
  packId: ID,
  state: InstalledPackState,
  database: LedgerDB,
): Promise<RulesetProfile | undefined> {
  for (const candidate of rulesetIdCandidatesForPack(packId)) {
    if (state.ownership.get(candidate) !== packId) continue;
    const profile = await database.rulesetProfiles.get(candidate);
    if (profile) return profile;
  }
  return undefined;
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
