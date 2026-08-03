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
import { EMPTY_DRAFT_BUILD, isAllowedTargetPath } from "@/src/domain/character-record";
import type { ContentEntry, ID } from "@/src/domain/model";
import type { LedgerDB } from "@/src/storage/db";
import type { CharacterRepositories } from "@/src/storage/character-repositories";
import { planBuild, type BuildPlan, type BuilderStepId } from "@/src/services/build-planner";
import {
  computeContentFingerprint,
  resolveDerivedCharacter,
  type DerivedCharacterSheet,
} from "@/src/services/derived-resolver";
import { loadRulesetScope } from "@/src/services/content-scope";
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

export interface CreateDraftCommand {
  readonly draftId: ID;
  readonly rulesetProfileId: ID;
  readonly level: number;
  readonly presentation: CharacterPresentationMode;
  readonly editingCharacterId?: ID;
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
      ...(command.editingCharacterId ? { editingCharacterId: command.editingCharacterId } : {}),
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
    const outcome = await database.transaction("rw", database.characterDrafts, async (): Promise<ServiceOutcome<CharacterDraftRecord>> => {
      const current = await repositories.drafts.get(command.draftId);
      if (!current) return notFound(command.draftId);
      if (current.revision !== command.expectedRevision)
        return stale(command.draftId, command.expectedRevision, current.revision);
      if (current.status !== "in-progress")
        return invalid([{ code: "DRAFT_NOT_EDITABLE", recordId: command.draftId, severity: "error" }]);
      const next: CharacterDraftRecord = {
        ...current,
        revision: current.revision + 1,
        lastStepId: command.lastStepId ?? current.lastStepId,
        build: { ...current.build, ...command.patch },
        updatedAt: now,
      };
      const accepted = await repositories.drafts.replace(next, command.expectedRevision);
      if (!accepted) return stale(command.draftId, command.expectedRevision, null);
      return ok(next);
    });
    if (outcome.status !== "ok") {
      this.log({ operation: "draft.update", recordId: command.draftId, expectedRevision: command.expectedRevision });
      return outcome;
    }
    this.log({ operation: "draft.update", recordId: command.draftId, actualRevision: outcome.result.revision });
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
        const blocking = plan.issues.filter(
          issue => issue.severity === "error" && !command.acknowledgedIssueCodes.includes(issue.code),
        );
        // Guided mode must resolve or acknowledge every blocking issue; flexible
        // mode may save an incomplete build with visible issue provenance.
        if (draft.presentation === "guided" && command.intent !== "manual-sheet" && blocking.length)
          return invalid(blocking);

        const character = characterFromDraft(draft, command, fingerprint, existing, now);
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
    classLevels: build.classId ? [{ classId: build.classId, level: build.level }] : [],
    ...(build.speciesId ? { speciesId: build.speciesId } : {}),
    ...(build.backgroundId ? { backgroundId: build.backgroundId } : {}),
    abilityMethod: build.abilityMethod,
    abilityScores: { ...build.abilityScores },
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

/** Reads the automatic value at an allow-listed path from a resolved sheet. */
export function baselineFor(sheet: DerivedCharacterSheet, targetPath: string): number | null {
  if (targetPath === "proficiencyBonus") return sheet.proficiencyBonus.value;
  if (targetPath === "armorClass") return sheet.armorClass.value;
  if (targetPath === "initiative") return sheet.initiative.value;
  if (targetPath === "speed") return sheet.speed.value;
  if (targetPath === "hitPoints.maximum") return sheet.hitPoints.maximum.value;
  if (targetPath === "hitPoints.current") return sheet.hitPoints.current.value;
  const ability = targetPath.startsWith("abilityScore.")
    ? targetPath.slice("abilityScore.".length)
    : targetPath.startsWith("abilityModifier.")
      ? targetPath.slice("abilityModifier.".length)
      : undefined;
  if (ability && ability in sheet.abilities) {
    const entry = sheet.abilities[ability as keyof typeof sheet.abilities];
    return targetPath.startsWith("abilityScore.") ? entry.score.value : entry.modifier.value;
  }
  if (targetPath.startsWith("savingThrow."))
    return sheet.saves.find(item => item.id === targetPath.slice("savingThrow.".length))?.total.value ?? null;
  if (targetPath.startsWith("check."))
    return sheet.checks.find(item => item.id === targetPath.slice("check.".length))?.total.value ?? null;
  if (targetPath.startsWith("resource.") && targetPath.endsWith(".maximum"))
    return sheet.resources.find(item => item.id === targetPath.slice("resource.".length, -".maximum".length))?.maximum.value ?? null;
  if (targetPath.startsWith("attack.") && targetPath.endsWith(".attackBonus"))
    return sheet.actions.find(item => item.id === targetPath.slice("attack.".length, -".attackBonus".length))?.attackBonus.value ?? null;
  return null;
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
