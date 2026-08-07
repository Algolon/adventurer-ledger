/**
 * CharacterDraftService, CharacterBuildCommitService and CharacterQueryService.
 *
 * Each mutation validates its expected revision inside the same Dexie
 * transaction that performs the write, so a stale command performs no writes and
 * returns a typed outcome. Logs carry operation codes, stable IDs, revisions,
 * counts and fingerprints only.
 */
import type {
  CharacterDerivedSnapshotRecord,
  CharacterDraftBuild,
  CharacterDraftRecord,
  CharacterOverrideRecord,
  CharacterPresentationMode,
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CharacterVersionRecord,
  OverrideOperation,
  OverrideScope,
} from "@/src/domain/character-record";
import { EMPTY_DRAFT_BUILD, isAllowedTargetPath, parseOverrideTarget } from "@/src/domain/character-record";
import type { ContentEntry, ID } from "@/src/domain/model";
import type { LedgerDB } from "@/src/storage/db";
import type { CharacterRepositories } from "@/src/storage/character-repositories";
import {
  planBuild,
  STRUCTURAL_COMMIT_BLOCKERS,
  type BuildPlan,
  type BuilderStepId,
} from "@/src/services/build-planner";
import { reconcileAbilityAllocation } from "@/src/services/ability-allocation";
import { changeBackground } from "@/src/services/background-change";
import { draftBuildFromCharacter, type EditDraftRepairNote } from "@/src/services/edit-draft";
import {
  applyRulesetChange,
  planRulesetChange,
  type RulesetChangePreview,
} from "@/src/services/ruleset-change";
import {
  computeContentFingerprint,
  resolveDerivedCharacter,
  type DerivedCharacterSheet,
} from "@/src/services/derived-resolver";
import { loadRulesetScope, loadRulesetScopes } from "@/src/services/content-scope";
import {
  invalid,
  noopLogger,
  notFound,
  ok,
  stale,
  systemClock,
  type Clock,
  type ServiceIssue,
  type ServiceLogger,
  type ServiceOutcome,
} from "@/src/services/contracts";

export interface ServiceContext {
  database: LedgerDB;
  repositories: CharacterRepositories;
  clock?: Clock;
  logger?: ServiceLogger;
}

/**
 * Starts a new build. It cannot start an edit.
 *
 * `editingCharacterId` used to be accepted here, and that was the whole defect:
 * the command bound a draft to a character without carrying any of that
 * character's data, so Edit character opened an empty builder wearing the
 * character's ID. Editing now has one entry point — `openForCharacter` — which
 * cannot be called without hydrating.
 */
export interface CreateDraftCommand {
  readonly draftId: ID;
  readonly rulesetProfileId: ID;
  readonly level: number;
  readonly presentation: CharacterPresentationMode;
}

export interface UpdateDraftCommand {
  readonly draftId: ID;
  readonly expectedRevision: number;
  /** Immutable patch. Only the named keys change. */
  readonly patch: Readonly<Partial<CharacterDraftBuild>>;
  readonly lastStepId?: BuilderStepId;
}

export interface DraftSnapshot {
  draft: CharacterDraftRecord;
  plan: BuildPlan;
  /** Save receipt: the revision the caller must send with its next command. */
  revision: number;
}

/** A draft opened against a committed character, with how it was opened. */
export interface EditDraftSnapshot extends DraftSnapshot {
  /** True when an unfinished edit draft was resumed instead of hydrated afresh. */
  resumed: boolean;
  /**
   * Values carried across that the installed content cannot currently confirm.
   * Empty for the ordinary case. Never populated by dropping anything.
   */
  repairs: readonly EditDraftRepairNote[];
}

export class CharacterDraftService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  async create(command: CreateDraftCommand): Promise<ServiceOutcome<DraftSnapshot>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const draft: CharacterDraftRecord = {
      id: command.draftId,
      revision: 1,
      rulesetProfileId: command.rulesetProfileId,
      presentation: command.presentation,
      status: "in-progress",
      lastStepId: "start",
      build: { ...EMPTY_DRAFT_BUILD, level: command.level },
      createdAt: now,
      updatedAt: now,
    };
    try {
      await database.transaction("rw", database.characterDrafts, async () => {
        await repositories.drafts.add(draft);
      });
    } catch {
      return { status: "conflict", code: "DRAFT_ALREADY_EXISTS", recordId: command.draftId };
    }
    this.log({ operation: "draft.create", recordId: draft.id, actualRevision: 1 });
    return ok(await this.snapshot(draft));
  }

  /** One transaction containing compare-and-swap validation and the draft write. */
  async update(command: UpdateDraftCommand): Promise<ServiceOutcome<DraftSnapshot>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const outcome = await database.transaction(
      "rw",
      [database.characterDrafts, database.contentEntries, database.rulesetProfiles],
      async (): Promise<ServiceOutcome<CharacterDraftRecord>> => {
        const current = await repositories.drafts.get(command.draftId);
        if (!current) return notFound(command.draftId);
        if (current.revision !== command.expectedRevision)
          return stale(command.draftId, command.expectedRevision, current.revision);
        if (current.status !== "in-progress")
          return invalid([{ code: "DRAFT_NOT_EDITABLE", recordId: command.draftId, severity: "error" }]);
        const merged: CharacterDraftBuild = { ...current.build, ...command.patch };
        const next: CharacterDraftRecord = {
          ...current,
          revision: current.revision + 1,
          lastStepId: command.lastStepId ?? current.lastStepId,
          build: await reconcileOriginChange(current.build, merged, command.patch, () =>
            loadRulesetScope(repositories, current.rulesetProfileId),
          ),
          updatedAt: now,
        };
        const accepted = await repositories.drafts.replace(next, command.expectedRevision);
        if (!accepted) return stale(command.draftId, command.expectedRevision, null);
        return ok(next);
      },
    );
    if (outcome.status !== "ok") {
      this.log({ operation: "draft.update", recordId: command.draftId, expectedRevision: command.expectedRevision });
      return outcome;
    }
    this.log({ operation: "draft.update", recordId: command.draftId, actualRevision: outcome.result.revision });
    return ok(await this.snapshot(outcome.result));
  }

  /**
   * Opens the one edit draft for a committed character.
   *
   * Three properties make this a boundary rather than a convenience wrapper.
   *
   * It resumes. An unfinished edit draft already bound to this character is
   * returned as it stands. Replacing it with a fresh hydration would throw away
   * work the user had explicitly saved and closed, and there is no way for them
   * to know that pressing Edit again is the thing that discards it.
   *
   * It uses the character's own ruleset, never the device-wide default. A build
   * rescoped to whichever ruleset happens to be active now is a different build.
   *
   * It hydrates through `draftBuildFromCharacter` — the single conversion — so
   * the draft the builder edits is the committed aggregate, and the revision it
   * was taken from is recorded on the draft as the token the commit must send.
   *
   * The whole thing is one transaction, so two presses in the same tick cannot
   * both observe "no draft yet" and both create one.
   */
  async openForCharacter(
    characterId: ID,
    draftId?: ID,
  ): Promise<ServiceOutcome<EditDraftSnapshot>> {
    const { database, repositories } = this.context;
    const now = this.clock();

    const character = await repositories.characters.get(characterId);
    if (!character) return notFound(characterId);
    const { entries } = await loadRulesetScope(repositories, character.rulesetProfileId);

    const outcome = await database.transaction(
      "rw",
      [database.characters, database.characterDrafts],
      async (): Promise<ServiceOutcome<{ draft: CharacterDraftRecord; resumed: boolean; notes: readonly EditDraftRepairNote[] }>> => {
        // Re-read inside the transaction: the revision recorded on the draft has
        // to be the one that was current when the draft was written.
        const current = await repositories.characters.get(characterId);
        if (!current) return notFound(characterId);

        const existing = (await repositories.drafts.listByEditingCharacter(characterId)).find(
          item => item.status === "in-progress",
        );
        const hydration = draftBuildFromCharacter(current, entries);
        if (existing) return ok({ draft: existing, resumed: true, notes: hydration.notes });

        /*
         * A free ID, not simply the obvious one.
         *
         * `draft:edit:<characterId>` is taken for good after the first
         * discarded edit — the abandoned record keeps the ID, and history is
         * never deleted — so reusing it blindly made the second edit of a
         * character fail permanently. The suffix is a count of what is already
         * there rather than a timestamp, so the ID stays deterministic.
         */
        const base = draftId ?? `draft:edit:${characterId}`;
        let id = base;
        for (let attempt = 2; await repositories.drafts.get(id); attempt += 1) id = `${base}:${attempt}`;

        const draft: CharacterDraftRecord = {
          id,
          revision: 1,
          rulesetProfileId: current.rulesetProfileId,
          presentation: current.presentation,
          status: "in-progress",
          // The builder resumes where the user left it; a fresh edit draft has
          // no such place, and Basics is where the sequence starts.
          lastStepId: "start",
          editingCharacterId: characterId,
          editingCharacterRevision: current.revision,
          build: hydration.build,
          createdAt: now,
          updatedAt: now,
        };
        try {
          await repositories.drafts.add(draft);
        } catch {
          return { status: "conflict", code: "DRAFT_ALREADY_EXISTS", recordId: draft.id };
        }
        return ok({ draft, resumed: false, notes: hydration.notes });
      },
    );

    if (outcome.status !== "ok") return outcome;
    this.log({
      operation: outcome.result.resumed ? "draft.edit.resume" : "draft.edit.open",
      recordId: outcome.result.draft.id,
      actualRevision: outcome.result.draft.revision,
      ...(outcome.result.notes.length ? { issueCodes: outcome.result.notes.map(note => note.code) } : {}),
    });
    return ok({
      ...(await this.snapshot(outcome.result.draft)),
      resumed: outcome.result.resumed,
      repairs: outcome.result.notes,
    });
  }

  /**
   * What moving this draft to another installed ruleset would cost.
   *
   * Read-only. It opens no write transaction and touches no record, so a user
   * can look at the consequences of a switch — and walk away from it — without
   * the draft changing underneath them. The revision it reports is the one a
   * confirmation must carry, which is how a change accepted on screen cannot be
   * applied to a draft that has since moved on.
   */
  async previewRulesetChange(
    draftId: ID,
    rulesetProfileId: ID,
  ): Promise<ServiceOutcome<RulesetChangePreview>> {
    const { repositories } = this.context;
    const current = await repositories.drafts.get(draftId);
    if (!current) return notFound(draftId);
    if (current.status !== "in-progress")
      return invalid([{ code: "DRAFT_NOT_EDITABLE", recordId: draftId, severity: "error" }]);
    const proposed = await repositories.content.getRuleset(rulesetProfileId);
    if (!proposed) return notFound(rulesetProfileId);
    // One entry read, scoped twice: the comparison needs both profiles, not two
    // passes over the whole table.
    const [scope, proposedScope] = await loadRulesetScopes(repositories, [
      current.rulesetProfileId,
      rulesetProfileId,
    ]);
    return ok(
      planRulesetChange({
        draftId,
        expectedRevision: current.revision,
        build: current.build,
        currentRuleset: scope.ruleset,
        currentRulesetId: current.rulesetProfileId,
        currentEntries: scope.entries,
        proposedRuleset: proposed,
        proposedEntries: proposedScope.entries,
      }),
    );
  }

  /**
   * Moves a draft to a different installed ruleset.
   *
   * This is the write half of the two-phase change `previewRulesetChange`
   * describes, and it applies exactly that preview: both are one call into
   * `resolveRulesetChange`, so what was shown and what is written cannot differ.
   *
   * A content-scoped selection is cleared only when the incoming ruleset does
   * not resolve it. Carrying an ID the new ruleset never activates would leave a
   * build that looks complete and resolves to nothing; dropping one the new
   * ruleset does still define would destroy work for no reason. Name, level,
   * base scores and manual values survive unconditionally, because none of them
   * depends on which ruleset is active. Origin increases are revalidated against
   * whichever pattern is in force afterwards, so an increase the incoming origin
   * does not authorise is excluded from the finals rather than left baked in.
   *
   * The expected revision is validated inside the write transaction, so an
   * autosave that lands between preview and confirmation makes the confirmation
   * stale rather than silently reviving the values it was going to clear.
   */
  async changeRuleset(
    draftId: ID,
    expectedRevision: number,
    rulesetProfileId: ID,
  ): Promise<ServiceOutcome<DraftSnapshot>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const target = await repositories.content.getRuleset(rulesetProfileId);
    if (!target) return notFound(rulesetProfileId);
    const existing = await repositories.drafts.get(draftId);
    if (!existing) return notFound(draftId);
    // Both scopes are read outside the write, because the resolution the user
    // confirmed is a function of both. The revision is revalidated inside the
    // transaction, so a draft that moved on since makes this confirmation stale
    // rather than letting it apply against content it was not computed from.
    const [currentScope, nextScope] = await loadRulesetScopes(repositories, [
      existing.rulesetProfileId,
      rulesetProfileId,
    ]);

    const outcome = await database.transaction(
      "rw",
      [database.characterDrafts, database.contentEntries, database.rulesetProfiles],
      async (): Promise<ServiceOutcome<CharacterDraftRecord>> => {
        const current = await repositories.drafts.get(draftId);
        if (!current) return notFound(draftId);
        if (current.revision !== expectedRevision) return stale(draftId, expectedRevision, current.revision);
        if (current.status !== "in-progress")
          return invalid([{ code: "DRAFT_NOT_EDITABLE", recordId: draftId, severity: "error" }]);
        if (current.rulesetProfileId === rulesetProfileId) return ok(current);

        const next: CharacterDraftRecord = {
          ...current,
          rulesetProfileId,
          revision: current.revision + 1,
          build: applyRulesetChange({
            draftId,
            expectedRevision,
            build: current.build,
            currentRuleset: currentScope.ruleset,
            currentRulesetId: current.rulesetProfileId,
            currentEntries: currentScope.entries,
            proposedRuleset: target,
            proposedEntries: nextScope.entries,
          }),
          updatedAt: now,
        };
        const accepted = await repositories.drafts.replace(next, expectedRevision);
        return accepted ? ok(next) : stale(draftId, expectedRevision, null);
      },
    );
    if (outcome.status !== "ok") return outcome;
    this.log({ operation: "draft.ruleset", recordId: draftId, actualRevision: outcome.result.revision });
    return ok(await this.snapshot(outcome.result));
  }

  /**
   * Presentation is guidance only. It changes no selection, manual value or
   * override, and it keeps the same draft ID and revision history.
   */
  async changePresentation(
    draftId: ID,
    expectedRevision: number,
    presentation: CharacterPresentationMode,
  ): Promise<ServiceOutcome<DraftSnapshot>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const outcome = await database.transaction("rw", database.characterDrafts, async (): Promise<ServiceOutcome<CharacterDraftRecord>> => {
      const current = await repositories.drafts.get(draftId);
      if (!current) return notFound(draftId);
      if (current.revision !== expectedRevision) return stale(draftId, expectedRevision, current.revision);
      // `build` is carried across untouched by construction.
      const next: CharacterDraftRecord = { ...current, presentation, revision: current.revision + 1, updatedAt: now };
      const accepted = await repositories.drafts.replace(next, expectedRevision);
      return accepted ? ok(next) : stale(draftId, expectedRevision, null);
    });
    if (outcome.status !== "ok") return outcome;
    this.log({ operation: "draft.presentation", recordId: draftId, actualRevision: outcome.result.revision });
    return ok(await this.snapshot(outcome.result));
  }

  async abandon(draftId: ID, expectedRevision: number): Promise<ServiceOutcome<{ draftId: ID }>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    return database.transaction("rw", database.characterDrafts, async (): Promise<ServiceOutcome<{ draftId: ID }>> => {
      const current = await repositories.drafts.get(draftId);
      if (!current) return notFound(draftId);
      if (current.revision !== expectedRevision) return stale(draftId, expectedRevision, current.revision);
      // Abandon marks the draft; it never deletes committed history.
      const accepted = await repositories.drafts.replace(
        { ...current, status: "abandoned", revision: current.revision + 1, updatedAt: now },
        expectedRevision,
      );
      return accepted ? ok({ draftId }) : stale(draftId, expectedRevision, null);
    });
  }

  async get(draftId: ID): Promise<DraftSnapshot | undefined> {
    const draft = await this.context.repositories.drafts.get(draftId);
    return draft ? this.snapshot(draft) : undefined;
  }

  async list(): Promise<CharacterDraftRecord[]> {
    const drafts = await this.context.repositories.drafts.list();
    return drafts.filter(draft => draft.status === "in-progress");
  }

  private async snapshot(draft: CharacterDraftRecord): Promise<DraftSnapshot> {
    const { entries } = await loadRulesetScope(this.context.repositories, draft.rulesetProfileId);
    return { draft, plan: planBuild(draft.build, entries, draft.presentation), revision: draft.revision };
  }
}

/** Patch keys that can change which origin increases are authorised. */
const ORIGIN_OWNING_KEYS: readonly (keyof CharacterDraftBuild)[] = ["backgroundId", "speciesId"];

/**
 * Revalidates the origin allocation when the patch changed the origin.
 *
 * The increases a user placed were authorised by a specific origin's declared
 * pattern. Replacing or removing that origin removes the authorisation, and the
 * finals are what the sheet reads — so leaving them alone means a score keeps
 * carrying an increase no active content grants. The repair happens on the write
 * that causes it, in the same transaction, rather than being left for a later
 * reader to notice.
 *
 * A patch that sets the allocation itself is left alone: that is the abilities
 * step doing its own arithmetic, and second-guessing it here would fight the
 * user's edit.
 */
async function reconcileOriginChange(
  previous: CharacterDraftBuild,
  merged: CharacterDraftBuild,
  patch: Readonly<Partial<CharacterDraftBuild>>,
  loadScope: () => Promise<{ entries: ContentEntry[] }>,
): Promise<CharacterDraftBuild> {
  const backgroundChanged = "backgroundId" in patch && patch.backgroundId !== previous.backgroundId;
  const changedOrigin = ORIGIN_OWNING_KEYS.some(key => key in patch && patch[key] !== previous[key]);
  if (!changedOrigin) return merged;

  const { entries } = await loadScope();
  let next = merged;

  /*
   * A replaced background takes its own answers with it.
   *
   * Reconciling only the ability increases left the rest behind: the nested
   * decisions the old background declared, and the equipment choices inside the
   * kit it granted, stayed in the draft. The planner stopped reporting them
   * because an unreachable choice is never walked — but they were still written
   * and still committed. This prunes at the boundary that performs the write, so
   * every route to a background change gets the same treatment, and the rest of
   * the patch is re-applied on top so an explicit edit in the same command still
   * wins.
   *
   * `changeBackground` is idempotent, and this only runs when the patch actually
   * moves the background, so a repeated or replayed update cannot cascade.
   */
  if (backgroundChanged) next = { ...changeBackground(previous, patch.backgroundId, entries).build, ...patch };

  // A patch that sets the allocation itself is left alone: that is the abilities
  // step doing its own arithmetic, and second-guessing it would fight the edit.
  if ("abilityIncreases" in patch || "abilityScores" in patch) return next;
  if (!Object.keys(next.abilityIncreases).length) return next;

  const allocation = reconcileAbilityAllocation(next, entries);
  if (!allocation.invalid.length) return next;
  return {
    ...next,
    abilityBaseScores: { ...allocation.base },
    abilityIncreases: { ...allocation.increases },
    abilityScores: { ...allocation.final },
  };
}

export type CommitIntent = "create" | "edit" | "manual-sheet";

export interface CommitCommand {
  readonly operationId: ID;
  readonly draftId: ID;
  readonly expectedDraftRevision: number;
  readonly characterId: ID;
  /** Omitted for a first commit, which asserts the record must not exist. */
  readonly expectedCharacterRevision?: number;
  readonly intent: CommitIntent;
  readonly acknowledgedIssueCodes: readonly string[];
  /** Fingerprint the user reviewed. A mismatch returns a stale preview. */
  readonly expectedContentFingerprint: string;
}

export interface CommitResult {
  characterId: ID;
  characterRevision: number;
  versionId: ID;
  runtimeRevision: number;
  issueCodes: readonly string[];
}

/** Turns a reviewed draft into a committed character, version and runtime state. */
export class CharacterBuildCommitService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  async commit(command: CommitCommand): Promise<ServiceOutcome<CommitResult>> {
    const { database, repositories } = this.context;
    const now = this.clock();

    const outcome = await database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterRuntimeStates,
        database.characterOverrides,
        database.characterDrafts,
        database.characterDerivedSnapshots,
        database.contentEntries,
        database.rulesetProfiles,
      ],
      async (): Promise<ServiceOutcome<CommitResult>> => {
        const draft = await repositories.drafts.get(command.draftId);
        if (!draft) return notFound(command.draftId);
        if (draft.revision !== command.expectedDraftRevision)
          return stale(command.draftId, command.expectedDraftRevision, draft.revision);
        if (draft.status !== "in-progress")
          return invalid([{ code: "DRAFT_NOT_EDITABLE", recordId: command.draftId, severity: "error" }]);

        const { entries, ruleset } = await loadRulesetScope(repositories, draft.rulesetProfileId);
        // Recheck the reviewed fingerprint immediately before writing.
        const fingerprint = computeContentFingerprint(entries, draft.rulesetProfileId);
        if (fingerprint !== command.expectedContentFingerprint)
          return { status: "conflict", code: "STALE_PREVIEW", recordId: command.draftId };

        const existing = await repositories.characters.get(command.characterId);
        if (command.expectedCharacterRevision === undefined) {
          if (existing) return { status: "conflict", code: "CHARACTER_ALREADY_EXISTS", recordId: command.characterId };
        } else {
          if (!existing) return notFound(command.characterId);
          if (existing.revision !== command.expectedCharacterRevision)
            return stale(command.characterId, command.expectedCharacterRevision, existing.revision);
        }

        const plan = planBuild(draft.build, entries, draft.presentation);

        /*
         * The structural floor, checked before anything else and in both modes.
         *
         * These are not incomplete decisions, which flexible mode exists to
         * tolerate — they are records the content cannot describe. Committing a
         * level the class has no progression row for produces a sheet whose hit
         * dice and maximum hit points come from different levels, and it stays
         * wrong for as long as the character exists. It is checked ahead of the
         * acknowledgement filter deliberately: acknowledging an issue records
         * that the user accepts a gap, not that the gap has stopped existing.
         */
        const structural = plan.issues.filter(issue => STRUCTURAL_COMMIT_BLOCKERS.has(issue.code));
        if (command.intent !== "manual-sheet" && structural.length) return invalid(structural);

        const blocking = plan.issues.filter(
          issue => issue.severity === "error" && !command.acknowledgedIssueCodes.includes(issue.code),
        );
        // Guided mode must resolve or acknowledge every blocking issue; flexible
        // mode may save an incomplete build with visible issue provenance.
        if (draft.presentation === "guided" && command.intent !== "manual-sheet" && blocking.length)
          return invalid(blocking);

        const character = characterFromDraft(draft, command, fingerprint, existing, now, plan);
        const overrides = await repositories.overrides.listByCharacter(command.characterId);
        const sheet = resolveDerivedCharacter({ character, overrides, entries, ...(ruleset ? { ruleset } : {}) });

        if (command.intent === "manual-sheet" && sheet.completeness === "incomplete")
          return invalid([{ code: "MANUAL_MINIMUM_NOT_MET", recordId: command.characterId, severity: "error" }]);

        const sequence = (await repositories.versions.latestSequence(command.characterId)) + 1;
        // Version before replace: the outgoing record is archived first.
        if (existing) {
          await repositories.versions.append({
            id: `${command.characterId}@${sequence}`,
            characterId: command.characterId,
            sequence,
            reason: "edit",
            operationId: `${command.operationId}:outgoing`,
            snapshot: existing,
            createdAt: now,
            updatedAt: now,
          });
        }
        const versionSequence = existing ? sequence + 1 : 1;
        const version: CharacterVersionRecord = {
          id: `${command.characterId}@${versionSequence}`,
          characterId: command.characterId,
          sequence: versionSequence,
          reason: existing ? "edit" : "initial",
          operationId: command.operationId,
          snapshot: character,
          createdAt: now,
          updatedAt: now,
        };
        await repositories.versions.append(version);

        if (existing) await repositories.characters.replace(character, existing.revision);
        else await repositories.characters.add(character);

        const runtime = await repositories.runtime.get(command.characterId);
        const nextRuntime = runtime
          ? syncRuntimeToSheet(runtime, sheet, now)
          : initialRuntimeState(command.characterId, sheet, now);
        await repositories.runtime.put(nextRuntime);
        await repositories.derivedSnapshots.put(derivedSnapshotOf(sheet, now));
        await repositories.drafts.replace(
          { ...draft, status: "committed", revision: draft.revision + 1, updatedAt: now },
          draft.revision,
        );

        return ok({
          characterId: character.id,
          characterRevision: character.revision,
          versionId: version.id,
          runtimeRevision: nextRuntime.revision,
          issueCodes: sheet.issues.map(issue => issue.code),
        });
      },
    );

    this.log({
      operation: "character.commit",
      recordId: command.characterId,
      fingerprint: command.expectedContentFingerprint,
      ...(outcome.status === "ok"
        ? { actualRevision: outcome.result.characterRevision, issueCodes: outcome.result.issueCodes }
        : {}),
    });
    return outcome;
  }
}

/** Builds the durable record from a draft without copying runtime values. */
function characterFromDraft(
  draft: CharacterDraftRecord,
  command: CommitCommand,
  fingerprint: string,
  existing: CharacterRecord | undefined,
  now: string,
  plan: BuildPlan,
): CharacterRecord {
  const build = draft.build;
  return {
    id: command.characterId,
    revision: existing ? existing.revision + 1 : 1,
    rulesetProfileId: draft.rulesetProfileId,
    presentation: draft.presentation,
    name: build.name,
    ...(build.nickname ? { nickname: build.nickname } : {}),
    ...(build.pronouns ? { pronouns: build.pronouns } : {}),
    level: build.level,
    // The subclass travels with the class level it belongs to, so the committed
    // record carries its identity rather than leaving it only in the draft.
    classLevels: build.classId
      ? [{ classId: build.classId, level: build.level, ...(build.subclassId ? { subclassId: build.subclassId } : {}) }]
      : [],
    ...(build.speciesId ? { speciesId: build.speciesId } : {}),
    ...(build.backgroundId ? { backgroundId: build.backgroundId } : {}),
    abilityMethod: build.abilityMethod,
    // The planner's finals, not the draft's stored ones. They are the base
    // scores plus only those origin increases the active origin still
    // authorises, so an increase left over from a replaced origin cannot be
    // written into a durable score.
    abilityScores: { ...plan.abilities.final },
    choiceSelections: { ...build.choiceSelections },
    equipmentSelections: { ...build.equipmentSelections },
    manualValues: { ...build.manualValues },
    manualActions: [...build.manualActions],
    acknowledgedIssueCodes: [...command.acknowledgedIssueCodes],
    contentFingerprint: fingerprint,
    status: "active",
    kind: "player-character",
    tags: existing?.tags ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function initialRuntimeState(
  characterId: ID,
  sheet: DerivedCharacterSheet,
  now: string,
): CharacterRuntimeStateRecord {
  const maximum = sheet.hitPoints.maximum.value ?? 0;
  const resourceUses: Record<ID, number> = {};
  const resourceMaxima: Record<ID, number> = {};
  for (const resource of sheet.resources) {
    if (resource.maximum.value === null) continue;
    resourceUses[resource.id] = resource.maximum.value;
    resourceMaxima[resource.id] = resource.maximum.value;
  }
  return {
    characterId,
    revision: 1,
    currentHitPoints: maximum,
    maximumHitPointsAtLastSync: maximum,
    temporaryHitPoints: 0,
    resourceUses,
    resourceMaximaAtLastSync: resourceMaxima,
    conditions: [],
    hitDiceRemaining: sheet.level,
    exhaustion: 0,
    deathSaves: { successes: 0, failures: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Re-synchronises runtime state after a durable edit changed a maximum, using
 * the preserve-deficit policy from D-06 so an expenditure is never refunded.
 */
export function syncRuntimeToSheet(
  runtime: CharacterRuntimeStateRecord,
  sheet: DerivedCharacterSheet,
  now: string,
): CharacterRuntimeStateRecord {
  const maximum = sheet.hitPoints.maximum.value;
  const nextMaximum = maximum ?? runtime.maximumHitPointsAtLastSync;
  const hitPointDelta = nextMaximum - runtime.maximumHitPointsAtLastSync;
  const resourceUses: Record<ID, number> = { ...runtime.resourceUses };
  const resourceMaxima: Record<ID, number> = { ...runtime.resourceMaximaAtLastSync };
  for (const resource of sheet.resources) {
    if (resource.maximum.value === null) continue;
    const previousMaximum = runtime.resourceMaximaAtLastSync[resource.id] ?? resource.maximum.value;
    const previousUses = runtime.resourceUses[resource.id] ?? previousMaximum;
    resourceUses[resource.id] = Math.max(0, Math.min(resource.maximum.value, previousUses + (resource.maximum.value - previousMaximum)));
    resourceMaxima[resource.id] = resource.maximum.value;
  }
  return {
    ...runtime,
    revision: runtime.revision + 1,
    currentHitPoints: Math.max(0, Math.min(nextMaximum, runtime.currentHitPoints + hitPointDelta)),
    maximumHitPointsAtLastSync: nextMaximum,
    resourceUses,
    resourceMaximaAtLastSync: resourceMaxima,
    hitDiceRemaining: Math.min(runtime.hitDiceRemaining, sheet.level),
    updatedAt: now,
  };
}

export function derivedSnapshotOf(sheet: DerivedCharacterSheet, now: string): CharacterDerivedSnapshotRecord {
  const display = (value: number | null) => (value === null ? "—" : String(value));
  return {
    characterId: sheet.characterId,
    characterRevision: sheet.characterRevision,
    contentFingerprint: sheet.contentFingerprint,
    confidence: sheet.confidence,
    // Safe display summaries only: labels and numbers, never private text.
    summary: {
      level: String(sheet.level),
      class: sheet.classLabel ?? "—",
      armorClass: display(sheet.armorClass.value),
      maximumHitPoints: display(sheet.hitPoints.maximum.value),
      initiative: display(sheet.initiative.value),
      speed: display(sheet.speed.value),
      proficiencyBonus: display(sheet.proficiencyBonus.value),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export interface SetOverrideCommand {
  readonly operationId: ID;
  readonly characterId: ID;
  readonly expectedCharacterRevision: number;
  readonly targetPath: string;
  readonly operation: OverrideOperation;
  readonly value: number;
  readonly scope: OverrideScope;
  /** Optional private explanation. Stored, never logged or exported. */
  readonly reason?: string;
  readonly sourceId?: ID;
}

export interface OverrideResult {
  overrideId: ID;
  characterRevision: number;
  versionId: ID;
  automaticBaseline: number | null;
}

/**
 * Typed override writes.
 *
 * M2.1 accepts only `replace` and numeric `add` against an allow-listed derived
 * path (D-04). Anything conditional, multiplicative, formula-shaped or
 * expression-shaped is rejected here without being evaluated. The write versions
 * the outgoing character before replacing it, so an override is auditable and
 * reversible like any other durable edit.
 */
export class CharacterOverrideService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  async set(command: SetOverrideCommand): Promise<ServiceOutcome<OverrideResult>> {
    const rejections: ServiceIssue[] = [];
    if (!isAllowedTargetPath(command.targetPath))
      rejections.push({ code: "OVERRIDE_TARGET_NOT_ALLOWED", fieldPath: command.targetPath, severity: "error" });
    if (command.operation !== "replace" && command.operation !== "add")
      rejections.push({ code: "OVERRIDE_OPERATION_UNSUPPORTED", fieldPath: "operation", severity: "error" });
    if (typeof command.value !== "number" || !Number.isFinite(command.value))
      rejections.push({ code: "OVERRIDE_VALUE_NOT_NUMERIC", fieldPath: "value", severity: "error" });
    if (rejections.length) return invalid(rejections);

    return this.write(command.characterId, command.expectedCharacterRevision, command.operationId, "override", async (character, entries, overrides) => {
      // The automatic baseline is recalculated now, not trusted from the caller.
      const baseline = baselineFor(
        resolveDerivedCharacter({ character, overrides: overrides.filter(item => item.targetPath !== command.targetPath), entries }),
        command.targetPath,
      );
      const existing = overrides.find(item => item.targetPath === command.targetPath);
      const now = this.clock();
      const record: CharacterOverrideRecord = {
        id: existing?.id ?? `${command.characterId}:override:${command.targetPath}`,
        characterId: command.characterId,
        targetPath: command.targetPath,
        operation: command.operation,
        value: command.value,
        automaticBaseline: baseline,
        scope: command.scope,
        status: "active",
        ...(command.reason ? { reason: command.reason } : {}),
        ...(command.sourceId ? { sourceId: command.sourceId } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.context.repositories.overrides.put(record);
      return { overrideId: record.id, automaticBaseline: baseline };
    });
  }

  /** Removes an override. The caller previews the automatic replacement first. */
  async remove(
    characterId: ID,
    overrideId: ID,
    expectedCharacterRevision: number,
    operationId: ID,
  ): Promise<ServiceOutcome<OverrideResult>> {
    return this.write(characterId, expectedCharacterRevision, operationId, "override", async (character, entries, overrides) => {
      const target = overrides.find(item => item.id === overrideId);
      if (!target) throw new Error(`Override ${overrideId} was not found`);
      await this.context.repositories.overrides.delete(overrideId);
      return {
        overrideId,
        automaticBaseline: baselineFor(
          resolveDerivedCharacter({ character, overrides: overrides.filter(item => item.id !== overrideId), entries }),
          target.targetPath,
        ),
      };
    });
  }

  /** Shared durable-edit transaction: version before replace, then the change. */
  private async write(
    characterId: ID,
    expectedCharacterRevision: number,
    operationId: ID,
    reason: CharacterVersionRecord["reason"],
    apply: (
      character: CharacterRecord,
      entries: readonly ContentEntry[],
      overrides: readonly CharacterOverrideRecord[],
    ) => Promise<{ overrideId: ID; automaticBaseline: number | null }>,
  ): Promise<ServiceOutcome<OverrideResult>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const outcome = await database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterOverrides,
        database.characterRuntimeStates,
        database.characterDerivedSnapshots,
        database.contentEntries,
        database.rulesetProfiles,
      ],
      async (): Promise<ServiceOutcome<OverrideResult>> => {
        const character = await repositories.characters.get(characterId);
        if (!character) return notFound(characterId);
        if (character.revision !== expectedCharacterRevision)
          return stale(characterId, expectedCharacterRevision, character.revision);

        const [{ entries }, overrides] = await Promise.all([
          loadRulesetScope(repositories, character.rulesetProfileId),
          repositories.overrides.listByCharacter(characterId),
        ]);
        const applied = await apply(character, entries, overrides);

        const sequence = (await repositories.versions.latestSequence(characterId)) + 1;
        // Version before replace.
        await repositories.versions.append({
          id: `${characterId}@${sequence}`,
          characterId,
          sequence,
          reason,
          operationId,
          snapshot: character,
          createdAt: now,
          updatedAt: now,
        });
        const next: CharacterRecord = { ...character, revision: character.revision + 1, updatedAt: now };
        const accepted = await repositories.characters.replace(next, character.revision);
        if (!accepted) return stale(characterId, expectedCharacterRevision, null);

        const runtime = await repositories.runtime.get(characterId);
        const refreshed = await repositories.overrides.listByCharacter(characterId);
        await repositories.derivedSnapshots.put(
          derivedSnapshotOf(resolveDerivedCharacter({ character: next, runtime, overrides: refreshed, entries }), now),
        );

        return ok({
          overrideId: applied.overrideId,
          characterRevision: next.revision,
          versionId: `${characterId}@${sequence}`,
          automaticBaseline: applied.automaticBaseline,
        });
      },
    );
    this.log({ operation: `character.${reason}`, recordId: characterId, expectedRevision: expectedCharacterRevision });
    return outcome;
  }
}

/**
 * Reads the automatic value at a supported path from a resolved sheet.
 *
 * It shares `parseOverrideTarget` with validation and with the resolver, so a
 * target cannot be accepted by one and unknown to another.
 */
export function baselineFor(sheet: DerivedCharacterSheet, targetPath: string): number | null {
  const target = parseOverrideTarget(targetPath);
  if (!target) return null;
  switch (target.kind) {
    case "proficiencyBonus":
      return sheet.proficiencyBonus.value;
    case "hitPointsMaximum":
      return sheet.hitPoints.maximum.value;
    case "armorClass":
      return sheet.armorClass.value;
    case "initiative":
      return sheet.initiative.value;
    case "speed":
      return sheet.speed.value;
    case "abilityScore":
      return target.ability ? sheet.abilities[target.ability].score.value : null;
    case "abilityModifier":
      return target.ability ? sheet.abilities[target.ability].modifier.value : null;
    case "savingThrow":
      return sheet.saves.find(item => item.id === target.id)?.total.value ?? null;
    case "check":
      return sheet.checks.find(item => item.id === target.id)?.total.value ?? null;
    case "resourceMaximum":
      return sheet.resources.find(item => item.id === target.id)?.maximum.value ?? null;
    case "attackBonus":
      return sheet.actions.find(item => item.id === target.id)?.attackBonus.value ?? null;
  }
}

export interface DuplicateResult {
  characterId: ID;
  characterRevision: number;
  versionId: ID;
}

/**
 * Library-level character operations.
 *
 * Duplicate produces an independent aggregate: a new character ID with its own
 * runtime state, its own overrides and its own empty session history. Nothing is
 * shared with the original, so playing one cannot change the other. Archive
 * removes a character from the active library without deleting any history.
 */
export class CharacterLibraryService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  async duplicate(
    sourceCharacterId: ID,
    targetCharacterId: ID,
    operationId: ID,
  ): Promise<ServiceOutcome<DuplicateResult>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const outcome = await database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterRuntimeStates,
        database.characterOverrides,
        database.characterActions,
        database.characterDerivedSnapshots,
        database.contentEntries,
        database.rulesetProfiles,
      ],
      async (): Promise<ServiceOutcome<DuplicateResult>> => {
        const source = await repositories.characters.get(sourceCharacterId);
        if (!source) return notFound(sourceCharacterId);
        if (await repositories.characters.get(targetCharacterId))
          return { status: "conflict", code: "CHARACTER_ALREADY_EXISTS", recordId: targetCharacterId };

        const [sourceRuntime, sourceOverrides, scope] = await Promise.all([
          repositories.runtime.get(sourceCharacterId),
          repositories.overrides.listByCharacter(sourceCharacterId),
          loadRulesetScope(repositories, source.rulesetProfileId),
        ]);

        const copy: CharacterRecord = {
          ...source,
          id: targetCharacterId,
          revision: 1,
          name: `${source.name}`.trim() ? `${source.name} (Copy)` : source.name,
          createdAt: now,
          updatedAt: now,
        };
        await repositories.characters.add(copy);
        await repositories.versions.append({
          id: `${targetCharacterId}@1`,
          characterId: targetCharacterId,
          sequence: 1,
          reason: "initial",
          operationId,
          snapshot: copy,
          createdAt: now,
          updatedAt: now,
        });

        // Runtime ownership is remapped, never shared.
        const runtime: CharacterRuntimeStateRecord = sourceRuntime
          ? { ...sourceRuntime, characterId: targetCharacterId, revision: 1, createdAt: now, updatedAt: now }
          : {
              characterId: targetCharacterId,
              revision: 1,
              currentHitPoints: 0,
              maximumHitPointsAtLastSync: 0,
              temporaryHitPoints: 0,
              resourceUses: {},
              resourceMaximaAtLastSync: {},
              conditions: [],
              hitDiceRemaining: copy.level,
              exhaustion: 0,
              deathSaves: { successes: 0, failures: 0 },
              createdAt: now,
              updatedAt: now,
            };
        await repositories.runtime.put(runtime);

        // Override IDs and ownership are remapped so the copy cannot alias them.
        const copiedOverrides = sourceOverrides.map(item => ({
          ...item,
          id: `${targetCharacterId}:override:${item.targetPath}`,
          characterId: targetCharacterId,
          createdAt: now,
          updatedAt: now,
        }));
        for (const override of copiedOverrides) await repositories.overrides.put(override);

        // The copy starts with no session history of its own.
        await repositories.derivedSnapshots.put(
          derivedSnapshotOf(
            resolveDerivedCharacter({
              character: copy,
              runtime,
              overrides: copiedOverrides,
              entries: scope.entries,
              ...(scope.ruleset ? { ruleset: scope.ruleset } : {}),
            }),
            now,
          ),
        );

        return ok({ characterId: targetCharacterId, characterRevision: 1, versionId: `${targetCharacterId}@1` });
      },
    );
    this.log({ operation: "character.duplicate", recordId: sourceCharacterId });
    return outcome;
  }

  /** Archives or restores a character. History is never deleted. */
  async setArchived(
    characterId: ID,
    expectedRevision: number,
    archived: boolean,
    operationId: ID,
  ): Promise<ServiceOutcome<{ characterId: ID; characterRevision: number }>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    const outcome = await database.transaction(
      "rw",
      [database.characters, database.characterVersions],
      async (): Promise<ServiceOutcome<{ characterId: ID; characterRevision: number }>> => {
        const character = await repositories.characters.get(characterId);
        if (!character) return notFound(characterId);
        if (character.revision !== expectedRevision) return stale(characterId, expectedRevision, character.revision);

        const sequence = (await repositories.versions.latestSequence(characterId)) + 1;
        // Version before replace, so archiving is auditable and reversible.
        await repositories.versions.append({
          id: `${characterId}@${sequence}`,
          characterId,
          sequence,
          reason: "edit",
          operationId,
          snapshot: character,
          createdAt: now,
          updatedAt: now,
        });
        const next: CharacterRecord = {
          ...character,
          status: archived ? "archived" : "active",
          revision: character.revision + 1,
          updatedAt: now,
        };
        const accepted = await repositories.characters.replace(next, character.revision);
        if (!accepted) return stale(characterId, expectedRevision, null);
        return ok({ characterId, characterRevision: next.revision });
      },
    );
    this.log({ operation: archived ? "character.archive" : "character.unarchive", recordId: characterId });
    return outcome;
  }

  /**
   * Deletes a character and everything whose lifecycle it owns.
   *
   * The tables below are exactly those the schema keys by `characterId`, plus
   * the drafts that name it in `editingCharacterId`. Ownership is read off the
   * schema rather than assumed: a record is deleted because the character is
   * the only thing that can reach it, which is why content packs, sources,
   * entries, ruleset profiles, app preferences and every other character are
   * absent from the list and stay untouched.
   *
   * It runs as one transaction. A local-first hard delete that half-succeeds
   * would leave runtime state and version history pointing at a character that
   * no longer exists, and nothing in the app would ever surface it again — so
   * either all of it goes or none of it does.
   *
   * The returned counts are how the tests assert the cascade against real
   * relationships instead of against a guess about them.
   */
  async delete(characterId: ID): Promise<ServiceOutcome<CharacterDeletionReceipt>> {
    const { database, repositories } = this.context;
    const outcome = await database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterSnapshots,
        database.characterDrafts,
        database.characterRuntimeStates,
        database.characterActions,
        database.characterOverrides,
        database.characterDerivedSnapshots,
        database.validationIssues,
        database.overrideDecisions,
      ],
      async (): Promise<ServiceOutcome<CharacterDeletionReceipt>> => {
        const character = await repositories.characters.get(characterId);
        // A second delete of the same character is `not-found`, not a crash.
        // The UI treats that as "already gone" and returns to the library.
        if (!character) return notFound(characterId);

        const removed: CharacterDeletionReceipt["removed"] = {
          versions: await database.characterVersions.where("characterId").equals(characterId).delete(),
          snapshots: await database.characterSnapshots.where("characterId").equals(characterId).delete(),
          drafts: await database.characterDrafts.where("editingCharacterId").equals(characterId).delete(),
          runtimeStates: await database.characterRuntimeStates.where("characterId").equals(characterId).delete(),
          actions: await database.characterActions.where("characterId").equals(characterId).delete(),
          overrides: await database.characterOverrides.where("characterId").equals(characterId).delete(),
          derivedSnapshots: await database.characterDerivedSnapshots.where("characterId").equals(characterId).delete(),
          validationIssues: await database.validationIssues.where("characterId").equals(characterId).delete(),
          overrideDecisions: await database.overrideDecisions.where("characterId").equals(characterId).delete(),
        };
        await database.characters.delete(characterId);
        return ok({ characterId, removed });
      },
    );
    // The name is deliberately absent: a diagnostic identifies a record by ID.
    this.log({ operation: "character.delete", recordId: characterId });
    return outcome;
  }
}

/** What a delete actually removed, per owned table. */
export interface CharacterDeletionReceipt {
  characterId: ID;
  removed: {
    versions: number;
    snapshots: number;
    drafts: number;
    runtimeStates: number;
    actions: number;
    overrides: number;
    derivedSnapshots: number;
    validationIssues: number;
    overrideDecisions: number;
  };
}

export interface LibraryCard {
  characterId: ID;
  name: string;
  revision: number;
  level: number;
  classLabel: string | null;
  state: "automatic" | "manual" | "incomplete" | "missing-source";
  issueCount: number;
  rulesetId: ID;
  updatedAt: string;
  /** Where the primary tap should go. */
  primaryDestination: "sheet" | "build" | "read-only-sheet";
  resumeStepId?: BuilderStepId;
}

export interface DraftCard {
  draftId: ID;
  name: string;
  issueCount: number;
  updatedAt: string;
  resumeStepId: BuilderStepId;
}

/** Read models for Library, Review, Play, history and transfer preview. It writes nothing. */
export class CharacterQueryService {
  constructor(private readonly context: ServiceContext) {}

  /** Content the given ruleset activates. */
  private async scopedContent(rulesetProfileId: ID): Promise<ContentEntry[]> {
    const { entries } = await loadRulesetScope(this.context.repositories, rulesetProfileId);
    return entries;
  }

  async sheet(characterId: ID): Promise<DerivedCharacterSheet | undefined> {
    const { repositories } = this.context;
    const character = await repositories.characters.get(characterId);
    if (!character) return undefined;
    const [runtime, overrides, scope] = await Promise.all([
      repositories.runtime.get(characterId),
      repositories.overrides.listByCharacter(characterId),
      loadRulesetScope(repositories, character.rulesetProfileId),
    ]);
    return resolveDerivedCharacter({
      character,
      runtime,
      overrides,
      entries: scope.entries,
      ...(scope.ruleset ? { ruleset: scope.ruleset } : {}),
    });
  }

  async library(): Promise<{ characters: LibraryCard[]; drafts: DraftCard[] }> {
    const { repositories } = this.context;
    const [records, drafts] = await Promise.all([repositories.characters.list(), repositories.drafts.list()]);
    const characters: LibraryCard[] = [];
    for (const character of records) {
      if (character.status === "archived") continue;
      const [runtime, overrides, scope] = await Promise.all([
        repositories.runtime.get(character.id),
        repositories.overrides.listByCharacter(character.id),
        loadRulesetScope(repositories, character.rulesetProfileId),
      ]);
      const sheet = resolveDerivedCharacter({
        character,
        runtime,
        overrides,
        entries: scope.entries,
        ...(scope.ruleset ? { ruleset: scope.ruleset } : {}),
      });
      const state =
        sheet.missingDependencyIds.length > 0
          ? "missing-source"
          : sheet.completeness === "incomplete"
            ? "incomplete"
            : sheet.mode === "manual"
              ? "manual"
              : "automatic";
      characters.push({
        characterId: character.id,
        name: sheet.name,
        revision: character.revision,
        level: character.level,
        classLabel: sheet.classLabel,
        state,
        issueCount: sheet.issues.length,
        rulesetId: character.rulesetProfileId,
        updatedAt: character.updatedAt,
        primaryDestination: state === "missing-source" ? "read-only-sheet" : state === "incomplete" ? "build" : "sheet",
      });
    }
    return {
      characters,
      drafts: await Promise.all(
        drafts
          .filter(draft => draft.status === "in-progress")
          .map(async draft => {
            const { entries } = await loadRulesetScope(repositories, draft.rulesetProfileId);
            const plan = planBuild(draft.build, entries, draft.presentation);
            return {
              draftId: draft.id,
              name: draft.build.name.trim() || "Unnamed character",
              issueCount: plan.issueCount,
              updatedAt: draft.updatedAt,
              resumeStepId: plan.nextUnresolvedStepId,
            };
          }),
      ),
    };
  }

  async history(characterId: ID) {
    const { repositories } = this.context;
    const [versions, snapshots, actions] = await Promise.all([
      repositories.versions.listByCharacter(characterId),
      repositories.snapshots.listByCharacter(characterId),
      repositories.actions.listByCharacter(characterId),
    ]);
    return {
      versions: versions.map(version => ({ id: version.id, sequence: version.sequence, reason: version.reason, createdAt: version.createdAt })),
      snapshots: snapshots.map(snapshot => ({ id: snapshot.id, kind: snapshot.kind, label: snapshot.label, createdAt: snapshot.createdAt })),
      // Note bodies never appear in a list summary.
      actions: actions.map(action => ({
        id: action.id,
        kind: action.kind,
        delta: action.delta,
        targetId: action.targetId,
        sequence: action.sequence,
        reversible: action.reversible,
        createdAt: action.createdAt,
        hasNote: Boolean(action.note),
      })),
    };
  }

  /** Content the given ruleset activates, for builder option lists. */
  async contentForRuleset(rulesetId: ID): Promise<ContentEntry[]> {
    return this.scopedContent(rulesetId);
  }

  /** Ruleset profiles installed on this device. */
  async rulesets() {
    return this.context.repositories.content.listRulesets();
  }

  async contentFingerprint(rulesetId: ID): Promise<string> {
    return computeContentFingerprint(await this.scopedContent(rulesetId), rulesetId);
  }

  async overrides(characterId: ID): Promise<CharacterOverrideRecord[]> {
    return this.context.repositories.overrides.listByCharacter(characterId);
  }
}

export type { ServiceIssue };
