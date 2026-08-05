/**
 * CharacterLevelUpService.
 *
 * Preview is read-only. Confirm rechecks both the character and runtime
 * revisions plus the content fingerprint, then writes the pre-level restore
 * point, the new durable character and version, the adjusted runtime state and
 * the derived snapshot in one transaction. Cancel writes nothing. Undo calls an
 * explicit restore that appends history rather than deleting the level-up.
 *
 * The current-value policy is D-06 preserve deficit/expenditure:
 * `newCurrent = oldCurrent + (newMaximum - oldMaximum)`, clamped to the new range.
 */
import type {
  CharacterRecord,
  CharacterRuntimeStateRecord,
  CharacterSnapshotRecord,
  CharacterVersionRecord,
} from "@/src/domain/character-record";
import type { Category, ContentEntry, ID } from "@/src/domain/model";
import { requiredChoicesFor, type RequiredChoice } from "@/src/services/build-planner";
import { planActivation, type SubclassRequirement } from "@/src/services/choice-planner";
import { computeContentFingerprint, resolveDerivedCharacter, type DerivedCharacterSheet } from "@/src/services/derived-resolver";
import { derivedSnapshotOf, type ServiceContext } from "@/src/services/character-services";
import { loadRulesetScope } from "@/src/services/content-scope";
import {
  invalid,
  noopLogger,
  notFound,
  ok,
  stale,
  systemClock,
  type Clock,
  type ServiceLogger,
  type ServiceOutcome,
} from "@/src/services/contracts";

/** The documented policy identifier stored with the level-up result. */
export const CURRENT_VALUE_POLICY_ID = "preserve-deficit-expenditure";
export const CURRENT_VALUE_POLICY_LABEL = "Preserve deficit and expenditure";

export interface TrackedValueDiff {
  id: ID;
  label: string;
  beforeCurrent: number | null;
  beforeMaximum: number | null;
  afterMaximum: number | null;
  /** Result of the policy, which the user may change before confirming. */
  proposedCurrent: number | null;
  maximumDelta: number | null;
}

export interface ScalarDiff {
  id: string;
  label: string;
  before: number | string | null;
  after: number | string | null;
}

/** Something the target level adds, named so the level is never silent. */
export interface GainedEntryView {
  id: ID;
  label: string;
  category: Category;
  summary?: string;
}

/**
 * Whether the class's own content reaches the target level.
 *
 * A class whose progression stops at level 3 cannot honestly advance a
 * character to 4. Without this the preview showed an empty confirmation: no
 * features, no choices, nothing but a hit die, and a Confirm button that
 * committed a level the content does not describe.
 */
export interface LevelCoverage {
  classId?: ID;
  classLabel?: string;
  /** True when the class defines a progression row for the target level. */
  supported: boolean;
  /** Highest level the class's contiguous progression reaches. */
  progressionMax?: number;
}

export interface LevelUpPreview {
  characterId: ID;
  characterRevision: number;
  runtimeRevision: number;
  rulesetProfileId: ID;
  fromLevel: number;
  toLevel: number;
  /** Fingerprint the caller must send back with confirm. */
  contentFingerprint: string;
  policyId: string;
  policyLabel: string;
  hitPoints: TrackedValueDiff;
  resources: readonly TrackedValueDiff[];
  scalars: readonly ScalarDiff[];
  /** Only choices that become required at the new level. */
  newChoices: readonly RequiredChoice[];
  /** Features, traits and other entries the target level activates. */
  gainedFeatures: readonly GainedEntryView[];
  /** Actions and attacks the target level makes available. */
  gainedActions: readonly GainedEntryView[];
  /** Resources that appear, or whose maximum moves, at the target level. */
  gainedResources: readonly GainedEntryView[];
  /** The subclass decision, when the target level is where it is made. */
  subclass?: SubclassRequirement;
  coverage: LevelCoverage;
  /**
   * True when the level adds no feature, action, resource or choice. It is
   * stated outright rather than presented as an empty screen.
   */
  onlyHitDice: boolean;
  /** Restore point that will be taken before any edit. */
  restorePointLabel: string;
  blocked: boolean;
  blockingCodes: readonly string[];
}

/** Applies the preserve-deficit policy to one tracked value. */
export function applyCurrentValuePolicy(
  currentBefore: number | null,
  maximumBefore: number | null,
  maximumAfter: number | null,
): number | null {
  if (currentBefore === null || maximumBefore === null || maximumAfter === null) return null;
  const shifted = currentBefore + (maximumAfter - maximumBefore);
  // Clamped only to the new valid range; a decreasing maximum never goes negative.
  return Math.max(0, Math.min(maximumAfter, shifted));
}

export interface LevelUpGains {
  newChoices: readonly RequiredChoice[];
  gainedFeatures: readonly GainedEntryView[];
  gainedActions: readonly GainedEntryView[];
  gainedResources: readonly GainedEntryView[];
  subclass?: SubclassRequirement;
  coverage: LevelCoverage;
}

/** Pure diff between the resolved sheets at the current and the next level. */
export function planLevelUp(
  before: DerivedCharacterSheet,
  after: DerivedCharacterSheet,
  runtime: CharacterRuntimeStateRecord,
  gains: LevelUpGains,
  fingerprint: string,
  rulesetProfileId: ID,
): LevelUpPreview {
  const { newChoices, gainedFeatures, gainedActions, gainedResources, coverage } = gains;
  const hitPoints: TrackedValueDiff = {
    id: "hitPoints",
    label: "Hit points",
    beforeCurrent: runtime.currentHitPoints,
    beforeMaximum: before.hitPoints.maximum.value,
    afterMaximum: after.hitPoints.maximum.value,
    proposedCurrent: applyCurrentValuePolicy(runtime.currentHitPoints, before.hitPoints.maximum.value, after.hitPoints.maximum.value),
    maximumDelta:
      before.hitPoints.maximum.value === null || after.hitPoints.maximum.value === null
        ? null
        : after.hitPoints.maximum.value - before.hitPoints.maximum.value,
  };

  const resources: TrackedValueDiff[] = after.resources.map(resource => {
    const previous = before.resources.find(item => item.id === resource.id);
    const beforeMaximum = previous?.maximum.value ?? null;
    const currentUses = runtime.resourceUses[resource.id] ?? beforeMaximum;
    return {
      id: resource.id,
      label: resource.label,
      beforeCurrent: currentUses,
      beforeMaximum,
      afterMaximum: resource.maximum.value,
      proposedCurrent: applyCurrentValuePolicy(currentUses, beforeMaximum, resource.maximum.value),
      maximumDelta: beforeMaximum === null || resource.maximum.value === null ? null : resource.maximum.value - beforeMaximum,
    };
  });

  const scalars: ScalarDiff[] = [
    { id: "level", label: "Level", before: before.level, after: after.level },
    { id: "proficiencyBonus", label: "Proficiency bonus", before: before.proficiencyBonus.value, after: after.proficiencyBonus.value },
    { id: "hitDice", label: "Hit dice", before: before.hitDice.value, after: after.hitDice.value },
    { id: "armorClass", label: "Armour class", before: before.armorClass.value, after: after.armorClass.value },
  ];

  const blockingCodes = [
    ...new Set([
      // An uncovered level blocks first: everything downstream would be a
      // description of content that does not exist.
      ...(coverage.supported ? [] : ["CLASS_PROGRESSION_LEVEL_MISSING"]),
      ...(gains.subclass?.unresolved ? ["SUBCLASS_NOT_CHOSEN"] : []),
      ...after.issues.filter(issue => issue.severity === "error").map(issue => issue.code),
    ]),
  ];
  return {
    characterId: after.characterId,
    characterRevision: before.characterRevision,
    runtimeRevision: runtime.revision,
    rulesetProfileId,
    fromLevel: before.level,
    toLevel: after.level,
    contentFingerprint: fingerprint,
    policyId: CURRENT_VALUE_POLICY_ID,
    policyLabel: CURRENT_VALUE_POLICY_LABEL,
    hitPoints,
    resources,
    scalars,
    newChoices,
    gainedFeatures,
    gainedActions,
    gainedResources,
    ...(gains.subclass ? { subclass: gains.subclass } : {}),
    coverage,
    onlyHitDice:
      coverage.supported &&
      !newChoices.length &&
      !gainedFeatures.length &&
      !gainedActions.length &&
      !gainedResources.length &&
      resources.every(resource => !resource.maximumDelta),
    restorePointLabel: `Before level ${after.level}`,
    blocked: blockingCodes.length > 0,
    blockingCodes,
  };
}

/**
 * Projects the durable record onto the next level with the newly made choices.
 *
 * A subclass chosen during this level-up is written onto the first class level,
 * the same place creation writes it, so the identity travels with the class
 * rather than living as a loose selection.
 */
export function characterAtNextLevel(
  character: CharacterRecord,
  choiceSelections: Readonly<Record<ID, readonly ID[]>>,
  subclassId?: ID,
): CharacterRecord {
  const nextLevel = character.level + 1;
  return {
    ...character,
    level: nextLevel,
    classLevels: character.classLevels.map((item, index) =>
      index === 0
        ? { ...item, level: nextLevel, ...(subclassId ?? item.subclassId ? { subclassId: subclassId ?? item.subclassId } : {}) }
        : item,
    ),
    choiceSelections: { ...character.choiceSelections, ...choiceSelections },
  };
}

export interface LevelUpConfirmCommand {
  readonly operationId: ID;
  readonly characterId: ID;
  readonly expectedCharacterRevision: number;
  readonly expectedRuntimeRevision: number;
  readonly targetLevel: number;
  readonly expectedContentFingerprint: string;
  readonly choiceSelections: Readonly<Record<ID, readonly ID[]>>;
  /** Set when the target level is where this class's subclass is chosen. */
  readonly subclassId?: ID;
  /** Optional user adjustment to the proposed current values. */
  readonly currentValueOverrides?: Readonly<Record<string, number>>;
}

export interface LevelUpResult {
  characterId: ID;
  characterRevision: number;
  versionId: ID;
  restorePointId: ID;
  runtimeRevision: number;
  toLevel: number;
}

export class CharacterLevelUpService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  /** Read-only. It writes nothing, including no restore point. */
  async preview(
    characterId: ID,
    choiceSelections: Readonly<Record<ID, readonly ID[]>> = {},
    subclassId?: ID,
  ): Promise<ServiceOutcome<LevelUpPreview>> {
    const { repositories } = this.context;
    const character = await repositories.characters.get(characterId);
    if (!character) return notFound(characterId);
    const runtime = await repositories.runtime.get(characterId);
    if (!runtime) return notFound(characterId);
    const [scope, overrides] = await Promise.all([
      loadRulesetScope(repositories, character.rulesetProfileId),
      repositories.overrides.listByCharacter(characterId),
    ]);
    return ok(this.buildPreview(character, runtime, scope.entries, overrides, choiceSelections, subclassId));
  }

  private buildPreview(
    character: CharacterRecord,
    runtime: CharacterRuntimeStateRecord,
    entries: readonly ContentEntry[],
    overrides: Awaited<ReturnType<ServiceContext["repositories"]["overrides"]["listByCharacter"]>>,
    choiceSelections: Readonly<Record<ID, readonly ID[]>>,
    subclassId?: ID,
  ): LevelUpPreview {
    const next = characterAtNextLevel(character, choiceSelections, subclassId);
    const before = resolveDerivedCharacter({ character, runtime, overrides, entries });
    const after = resolveDerivedCharacter({ character: next, runtime, overrides, entries });
    const draftBefore = { ...toBuild(character), level: character.level };
    const draftAfter = { ...toBuild(next), level: next.level };
    const activationBefore = planActivation(draftBefore, entries);
    const activationAfter = planActivation(draftAfter, entries);

    const beforeChoiceIds = new Set(activationBefore.choices.map(activated => activated.choice.id));
    const newChoices = requiredChoicesFor(draftAfter, entries, activationAfter).filter(
      choice => !beforeChoiceIds.has(choice.choiceId),
    );

    // What the level adds is the difference between the two activations and the
    // two resolved sheets, so the preview names real gains rather than asserting
    // that something must have happened.
    const beforeEntryIds = new Set(activationBefore.entries.map(item => item.entry.id));
    const gainedFeatures = activationAfter.entries
      .filter(item => !beforeEntryIds.has(item.entry.id))
      .map(item => view(item.entry.id, item.entry.name, item.entry.category, item.entry.summary));
    const beforeActionIds = new Set(before.actions.map(action => action.id));
    const gainedActions = after.actions
      .filter(action => !beforeActionIds.has(action.id))
      .map(action => view(action.id, action.label, "rule"));
    const beforeResources = new Map(before.resources.map(resource => [resource.id, resource.maximum.value]));
    const gainedResources = after.resources
      .filter(resource => !beforeResources.has(resource.id) || beforeResources.get(resource.id) !== resource.maximum.value)
      .map(resource => view(resource.id, resource.label, "resource"));

    const classEntry = draftAfter.classId ? entries.find(entry => entry.id === draftAfter.classId) : undefined;
    const coverage: LevelCoverage = {
      ...(classEntry ? { classId: classEntry.id, classLabel: classEntry.name } : {}),
      // Only a class that genuinely stops short blocks a level-up. A character
      // with no class has no class progression to fall short of, and refusing
      // one here would block a manual sheet from ever gaining a level.
      supported: activationAfter.levelCoverage !== "not-covered",
      ...(activationAfter.classProgressionMax === undefined
        ? {}
        : { progressionMax: activationAfter.classProgressionMax }),
    };

    return planLevelUp(
      before,
      after,
      runtime,
      {
        newChoices,
        gainedFeatures,
        gainedActions,
        gainedResources,
        ...(activationAfter.subclass && activationAfter.subclass.reached && !activationBefore.subclass?.reached
          ? { subclass: activationAfter.subclass }
          : activationAfter.subclass?.unresolved
            ? { subclass: activationAfter.subclass }
            : {}),
        coverage,
      },
      computeContentFingerprint(entries, character.rulesetProfileId),
      character.rulesetProfileId,
    );
  }

  async confirm(command: LevelUpConfirmCommand): Promise<ServiceOutcome<LevelUpResult>> {
    const { database, repositories } = this.context;
    const now = this.clock();

    const outcome = await database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterSnapshots,
        database.characterRuntimeStates,
        database.characterOverrides,
        database.characterDerivedSnapshots,
        database.contentEntries,
        database.rulesetProfiles,
      ],
      async (): Promise<ServiceOutcome<LevelUpResult>> => {
        const character = await repositories.characters.get(command.characterId);
        if (!character) return notFound(command.characterId);
        if (character.revision !== command.expectedCharacterRevision)
          return stale(command.characterId, command.expectedCharacterRevision, character.revision);
        const runtime = await repositories.runtime.get(command.characterId);
        if (!runtime) return notFound(command.characterId);
        if (runtime.revision !== command.expectedRuntimeRevision)
          return stale(command.characterId, command.expectedRuntimeRevision, runtime.revision);
        // Exactly one single-class level increase.
        if (command.targetLevel !== character.level + 1)
          return invalid([{ code: "LEVEL_STEP_UNSUPPORTED", recordId: command.characterId, severity: "error" }]);

        const { entries } = await loadRulesetScope(repositories, character.rulesetProfileId);
        const fingerprint = computeContentFingerprint(entries, character.rulesetProfileId);
        if (fingerprint !== command.expectedContentFingerprint)
          return { status: "conflict", code: "STALE_PREVIEW", recordId: command.characterId };

        const overrides = await repositories.overrides.listByCharacter(command.characterId);
        const preview = this.buildPreview(
          character,
          runtime,
          entries,
          overrides,
          command.choiceSelections,
          command.subclassId,
        );
        // A level the class does not describe is refused before anything is
        // written, so the restore point is never taken for a level that cannot
        // be justified from content.
        if (!preview.coverage.supported)
          return invalid([
            {
              code: "CLASS_PROGRESSION_LEVEL_MISSING",
              recordId: preview.coverage.classId ?? command.characterId,
              severity: "error",
            },
          ]);
        if (preview.subclass?.unresolved)
          return invalid([
            { code: "SUBCLASS_NOT_CHOSEN", recordId: preview.subclass.classId, severity: "error" },
          ]);
        const unresolved = preview.newChoices.filter(choice => !choice.resolved);
        if (unresolved.length)
          return invalid(unresolved.map(choice => ({ code: "CHOICE_UNRESOLVED", recordId: choice.choiceId, severity: "error" as const })));

        const sequence = (await repositories.versions.latestSequence(command.characterId)) + 1;
        // The pre-level restore point references the outgoing durable version.
        const outgoingVersion: CharacterVersionRecord = {
          id: `${command.characterId}@${sequence}`,
          characterId: command.characterId,
          sequence,
          reason: "level-up",
          operationId: `${command.operationId}:outgoing`,
          snapshot: character,
          createdAt: now,
          updatedAt: now,
        };
        await repositories.versions.append(outgoingVersion);
        const restorePoint: CharacterSnapshotRecord = {
          id: `${command.characterId}:restore:${sequence}`,
          characterId: command.characterId,
          kind: "pre-level",
          label: preview.restorePointLabel,
          characterVersionId: outgoingVersion.id,
          runtimeState: runtime,
          overrides: overrides.map(item => ({ ...item })),
          createdAt: now,
          updatedAt: now,
        };
        await repositories.snapshots.add(restorePoint);

        const nextCharacter: CharacterRecord = {
          ...characterAtNextLevel(character, command.choiceSelections, command.subclassId),
          revision: character.revision + 1,
          contentFingerprint: fingerprint,
          updatedAt: now,
        };
        const nextVersion: CharacterVersionRecord = {
          id: `${command.characterId}@${sequence + 1}`,
          characterId: command.characterId,
          sequence: sequence + 1,
          reason: "level-up",
          operationId: command.operationId,
          snapshot: nextCharacter,
          parentVersionId: outgoingVersion.id,
          createdAt: now,
          updatedAt: now,
        };
        await repositories.versions.append(nextVersion);
        const replaced = await repositories.characters.replace(nextCharacter, character.revision);
        if (!replaced) return stale(command.characterId, command.expectedCharacterRevision, null);

        // `until-level-up` overrides expire here, in the same transaction. The
        // pre-level restore point above already captured them, so an undo brings
        // them back; a cancelled or failed level-up never reaches this point.
        const expiring = overrides.filter(item => item.scope === "until-level-up");
        for (const override of expiring) await repositories.overrides.delete(override.id);
        const remainingOverrides = overrides.filter(item => item.scope !== "until-level-up");

        const afterSheet = resolveDerivedCharacter({ character: nextCharacter, runtime, overrides: remainingOverrides, entries });
        const resourceUses: Record<ID, number> = { ...runtime.resourceUses };
        const resourceMaxima: Record<ID, number> = { ...runtime.resourceMaximaAtLastSync };
        for (const resource of preview.resources) {
          const chosen = command.currentValueOverrides?.[`resource.${resource.id}`] ?? resource.proposedCurrent;
          if (chosen === null || chosen === undefined || resource.afterMaximum === null) continue;
          resourceUses[resource.id] = Math.max(0, Math.min(resource.afterMaximum, Math.trunc(chosen)));
          resourceMaxima[resource.id] = resource.afterMaximum;
        }
        const proposedHitPoints = command.currentValueOverrides?.["hitPoints.current"] ?? preview.hitPoints.proposedCurrent;
        const nextRuntime: CharacterRuntimeStateRecord = {
          ...runtime,
          revision: runtime.revision + 1,
          currentHitPoints:
            proposedHitPoints === null || proposedHitPoints === undefined
              ? runtime.currentHitPoints
              : Math.max(0, Math.min(preview.hitPoints.afterMaximum ?? proposedHitPoints, Math.trunc(proposedHitPoints))),
          maximumHitPointsAtLastSync: preview.hitPoints.afterMaximum ?? runtime.maximumHitPointsAtLastSync,
          resourceUses,
          resourceMaximaAtLastSync: resourceMaxima,
          hitDiceRemaining: runtime.hitDiceRemaining + 1,
          updatedAt: now,
        };
        const runtimeAccepted = await repositories.runtime.replace(nextRuntime, runtime.revision);
        if (!runtimeAccepted) return stale(command.characterId, command.expectedRuntimeRevision, null);
        await repositories.derivedSnapshots.put(derivedSnapshotOf(afterSheet, now));

        return ok({
          characterId: command.characterId,
          characterRevision: nextCharacter.revision,
          versionId: nextVersion.id,
          restorePointId: restorePoint.id,
          runtimeRevision: nextRuntime.revision,
          toLevel: nextCharacter.level,
        });
      },
    );

    this.log({
      operation: "character.levelUp",
      recordId: command.characterId,
      expectedRevision: command.expectedCharacterRevision,
      fingerprint: command.expectedContentFingerprint,
      ...(outcome.status === "ok" ? { actualRevision: outcome.result.characterRevision } : {}),
    });
    return outcome;
  }

  /**
   * Restores a snapshot. It appends a new version and never deletes the
   * level-up history it reverses.
   */
  async restore(
    characterId: ID,
    snapshotId: ID,
    expectedCharacterRevision: number,
    operationId: ID,
  ): Promise<ServiceOutcome<LevelUpResult>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    return database.transaction(
      "rw",
      [
        database.characters,
        database.characterVersions,
        database.characterSnapshots,
        database.characterRuntimeStates,
        database.characterDerivedSnapshots,
        database.characterOverrides,
        database.contentEntries,
        database.rulesetProfiles,
      ],
      async (): Promise<ServiceOutcome<LevelUpResult>> => {
        const character = await repositories.characters.get(characterId);
        if (!character) return notFound(characterId);
        if (character.revision !== expectedCharacterRevision)
          return stale(characterId, expectedCharacterRevision, character.revision);
        const snapshot = await repositories.snapshots.get(snapshotId);
        if (!snapshot || snapshot.characterId !== characterId) return notFound(snapshotId);
        const version = await repositories.versions.get(snapshot.characterVersionId);
        if (!version) return notFound(snapshot.characterVersionId);
        const runtime = await repositories.runtime.get(characterId);
        if (!runtime) return notFound(characterId);

        const sequence = (await repositories.versions.latestSequence(characterId)) + 1;
        const restored: CharacterRecord = {
          ...version.snapshot,
          revision: character.revision + 1,
          updatedAt: now,
        };
        await repositories.versions.append({
          id: `${characterId}@${sequence}`,
          characterId,
          sequence,
          reason: "restore",
          operationId,
          snapshot: restored,
          parentVersionId: version.id,
          createdAt: now,
          updatedAt: now,
        });
        const replaced = await repositories.characters.replace(restored, character.revision);
        if (!replaced) return stale(characterId, expectedCharacterRevision, null);
        const restoredRuntime: CharacterRuntimeStateRecord = {
          ...snapshot.runtimeState,
          revision: runtime.revision + 1,
          updatedAt: now,
        };
        await repositories.runtime.put(restoredRuntime);

        // The override set belongs to the boundary. Rewriting it exactly is what
        // stops a restore producing a mix of two aggregate revisions.
        await repositories.overrides.deleteByCharacter(characterId);
        const restoredOverrides = snapshot.overrides.map(item => ({ ...item, characterId, updatedAt: now }));
        for (const override of restoredOverrides) await repositories.overrides.put(override);

        const { entries } = await loadRulesetScope(repositories, restored.rulesetProfileId);
        await repositories.derivedSnapshots.put(
          derivedSnapshotOf(
            resolveDerivedCharacter({ character: restored, runtime: restoredRuntime, overrides: restoredOverrides, entries }),
            now,
          ),
        );

        return ok({
          characterId,
          characterRevision: restored.revision,
          versionId: `${characterId}@${sequence}`,
          restorePointId: snapshotId,
          runtimeRevision: restoredRuntime.revision,
          toLevel: restored.level,
        });
      },
    );
  }
}

/** A gained entry, named for the preview. Labels are content names only. */
function view(id: ID, label: string, category: Category, summary?: string): GainedEntryView {
  return { id, label, category, ...(summary ? { summary } : {}) };
}

/** Minimal draft projection used only for choice planning. */
function toBuild(character: CharacterRecord) {
  return {
    name: character.name,
    level: character.level,
    ...(character.classLevels[0] ? { classId: character.classLevels[0].classId } : {}),
    ...(character.classLevels[0]?.subclassId ? { subclassId: character.classLevels[0].subclassId } : {}),
    ...(character.speciesId ? { speciesId: character.speciesId } : {}),
    ...(character.backgroundId ? { backgroundId: character.backgroundId } : {}),
    abilityMethod: character.abilityMethod,
    abilityScores: character.abilityScores,
    // A committed record no longer carries the draft-time assignment; choice
    // planning does not read it.
    abilityBaseScores: {},
    abilityIncreases: {},
    choiceSelections: character.choiceSelections,
    equipmentSelections: character.equipmentSelections,
    manualValues: character.manualValues,
    manualActions: character.manualActions,
    acknowledgedIssueCodes: character.acknowledgedIssueCodes,
  };
}
