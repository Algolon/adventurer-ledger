/**
 * CharacterRuntimeService.
 *
 * Applies bounded play mutations. A runtime action updates runtime state and
 * appends one lightweight session-action entry in a single transaction (D-05);
 * it never writes the durable character, a character version, a build override,
 * the ruleset or content. Undo is a new typed action that references the action
 * it reverses — history is never deleted.
 */
import type {
  CharacterActionRecord,
  CharacterRuntimeStateRecord,
  RuntimeActionKind,
} from "@/src/domain/character-record";
import type { ID } from "@/src/domain/model";
import { resolveDerivedCharacter, type DerivedCharacterSheet } from "@/src/services/derived-resolver";
import type { ServiceContext } from "@/src/services/character-services";
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

export type RuntimeOperation =
  | { kind: "damage"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "temporary-hit-points"; amount: number }
  | { kind: "resource-spend"; resourceId: ID; amount: number }
  | { kind: "resource-recover"; resourceId: ID; amount: number }
  | { kind: "condition-add"; conditionId: ID }
  | { kind: "condition-remove"; conditionId: ID }
  | { kind: "short-rest" }
  | { kind: "long-rest" };

export interface RuntimeCommand {
  readonly characterId: ID;
  readonly expectedRuntimeRevision: number;
  readonly operationId: ID;
  readonly operation: RuntimeOperation;
  /** Private user note. Stored as user content, never logged or summarised. */
  readonly note?: string;
}

export interface RuntimeResult {
  runtime: CharacterRuntimeStateRecord;
  actionId: ID;
  /** Present when the action can be reversed by a later undo. */
  undoable: boolean;
  warnings: readonly ServiceIssue[];
}

/** Pure preview of an operation so the UI can show the result before committing. */
export function previewRuntimeOperation(
  runtime: CharacterRuntimeStateRecord,
  sheet: DerivedCharacterSheet,
  operation: RuntimeOperation,
): { next: CharacterRuntimeStateRecord; delta?: number; targetId?: ID; warnings: ServiceIssue[] } {
  const warnings: ServiceIssue[] = [];
  const maximumHitPoints = sheet.hitPoints.maximum.value ?? runtime.maximumHitPointsAtLastSync;
  const clamp = (value: number, low: number, high: number, code: string, fieldPath: string) => {
    const clamped = Math.max(low, Math.min(high, value));
    if (clamped !== value) warnings.push({ code, fieldPath, severity: "warning" });
    return clamped;
  };
  const next = { ...runtime };

  switch (operation.kind) {
    case "damage": {
      const amount = Math.max(0, Math.trunc(operation.amount));
      // Temporary hit points absorb damage first and are never negative.
      const absorbed = Math.min(next.temporaryHitPoints, amount);
      next.temporaryHitPoints -= absorbed;
      const remaining = amount - absorbed;
      next.currentHitPoints = clamp(next.currentHitPoints - remaining, 0, maximumHitPoints, "HIT_POINTS_CLAMPED", "hitPoints.current");
      return { next, delta: -amount, warnings };
    }
    case "heal": {
      const amount = Math.max(0, Math.trunc(operation.amount));
      next.currentHitPoints = clamp(next.currentHitPoints + amount, 0, maximumHitPoints, "HIT_POINTS_CLAMPED", "hitPoints.current");
      return { next, delta: amount, warnings };
    }
    case "temporary-hit-points": {
      const amount = Math.max(0, Math.trunc(operation.amount));
      // Temporary hit points replace rather than stack.
      next.temporaryHitPoints = amount;
      return { next, delta: amount, warnings };
    }
    case "resource-spend":
    case "resource-recover": {
      const resource = sheet.resources.find(item => item.id === operation.resourceId);
      const maximum = resource?.maximum.value ?? runtime.resourceMaximaAtLastSync[operation.resourceId];
      if (maximum === undefined) {
        warnings.push({ code: "RESOURCE_UNKNOWN", recordId: operation.resourceId, severity: "error" });
        return { next, warnings };
      }
      const amount = Math.max(0, Math.trunc(operation.amount));
      const signed = operation.kind === "resource-spend" ? -amount : amount;
      const current = next.resourceUses[operation.resourceId] ?? maximum;
      const updated = clamp(current + signed, 0, maximum, "RESOURCE_BOUNDS_CLAMPED", `resource.${operation.resourceId}`);
      next.resourceUses = { ...next.resourceUses, [operation.resourceId]: updated };
      return { next, delta: updated - current, targetId: operation.resourceId, warnings };
    }
    case "condition-add": {
      if (next.conditions.some(item => item.conditionId === operation.conditionId)) {
        warnings.push({ code: "CONDITION_ALREADY_ACTIVE", recordId: operation.conditionId, severity: "warning" });
        return { next, targetId: operation.conditionId, warnings };
      }
      next.conditions = [...next.conditions, { conditionId: operation.conditionId, appliedAt: runtime.updatedAt }];
      return { next, targetId: operation.conditionId, warnings };
    }
    case "condition-remove": {
      next.conditions = next.conditions.filter(item => item.conditionId !== operation.conditionId);
      return { next, targetId: operation.conditionId, warnings };
    }
    case "short-rest": {
      // Only resources the declarative data recharges on a short rest return.
      const uses = { ...next.resourceUses };
      for (const resource of sheet.resources)
        if (resource.recharge === "short-rest" && resource.maximum.value !== null) uses[resource.id] = resource.maximum.value;
      next.resourceUses = uses;
      return { next, warnings };
    }
    case "long-rest": {
      const uses = { ...next.resourceUses };
      for (const resource of sheet.resources)
        if (resource.maximum.value !== null && resource.recharge !== "none") uses[resource.id] = resource.maximum.value;
      next.resourceUses = uses;
      next.currentHitPoints = maximumHitPoints;
      next.temporaryHitPoints = 0;
      next.hitDiceRemaining = sheet.level;
      next.exhaustion = Math.max(0, next.exhaustion - 1);
      return { next, warnings };
    }
  }
}

/** The inverse of an action, when one exists that is safe to apply. */
export function inverseOperation(action: CharacterActionRecord): RuntimeOperation | undefined {
  switch (action.kind) {
    case "damage":
      return action.delta === undefined ? undefined : { kind: "heal", amount: Math.abs(action.delta) };
    case "heal":
      return action.delta === undefined ? undefined : { kind: "damage", amount: Math.abs(action.delta) };
    case "resource-spend":
      return action.targetId && action.delta !== undefined
        ? { kind: "resource-recover", resourceId: action.targetId, amount: Math.abs(action.delta) }
        : undefined;
    case "resource-recover":
      return action.targetId && action.delta !== undefined
        ? { kind: "resource-spend", resourceId: action.targetId, amount: Math.abs(action.delta) }
        : undefined;
    case "condition-add":
      return action.targetId ? { kind: "condition-remove", conditionId: action.targetId } : undefined;
    case "condition-remove":
      return action.targetId ? { kind: "condition-add", conditionId: action.targetId } : undefined;
    // A rest and a temporary-hit-point set are not safely reversible from the
    // delta alone, so no inverse is offered.
    default:
      return undefined;
  }
}

export class CharacterRuntimeService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  async apply(command: RuntimeCommand): Promise<ServiceOutcome<RuntimeResult>> {
    const outcome = await this.mutate(command.characterId, command.expectedRuntimeRevision, command.operationId, command.operation, command.note);
    this.log({
      operation: `runtime.${command.operation.kind}`,
      recordId: command.characterId,
      expectedRevision: command.expectedRuntimeRevision,
      ...(outcome.status === "ok" ? { actualRevision: outcome.result.runtime.revision } : {}),
    });
    return outcome;
  }

  /** Undo the most recent reversible action. It appends history rather than deleting it. */
  async undoLast(characterId: ID, expectedRuntimeRevision: number, operationId: ID): Promise<ServiceOutcome<RuntimeResult>> {
    const { repositories } = this.context;
    const recent = await repositories.actions.listByCharacter(characterId, 25);
    const target = recent.find(action => action.reversible && action.kind !== "undo");
    if (!target) return invalid([{ code: "NOTHING_TO_UNDO", recordId: characterId, severity: "warning" }]);
    const inverse = inverseOperation(target);
    if (!inverse) return invalid([{ code: "ACTION_NOT_REVERSIBLE", recordId: target.id, severity: "warning" }]);
    const outcome = await this.mutate(characterId, expectedRuntimeRevision, operationId, inverse, undefined, target.id);
    this.log({ operation: "runtime.undo", recordId: characterId, expectedRevision: expectedRuntimeRevision });
    return outcome;
  }

  private async mutate(
    characterId: ID,
    expectedRuntimeRevision: number,
    operationId: ID,
    operation: RuntimeOperation,
    note?: string,
    reversesActionId?: ID,
  ): Promise<ServiceOutcome<RuntimeResult>> {
    const { database, repositories } = this.context;
    const now = this.clock();
    return database.transaction(
      "rw",
      [
        database.characters,
        database.characterRuntimeStates,
        database.characterActions,
        database.characterOverrides,
        database.contentEntries,
      ],
      async (): Promise<ServiceOutcome<RuntimeResult>> => {
        const character = await repositories.characters.get(characterId);
        if (!character) return notFound(characterId);
        const runtime = await repositories.runtime.get(characterId);
        if (!runtime) return notFound(characterId);
        if (runtime.revision !== expectedRuntimeRevision)
          return stale(characterId, expectedRuntimeRevision, runtime.revision);

        // The resolver supplies the bounds and recharge behaviour; the runtime
        // service applies no rules of its own.
        const [entries, overrides] = await Promise.all([
          repositories.content.listEntries(),
          repositories.overrides.listByCharacter(characterId),
        ]);
        const sheet = resolveDerivedCharacter({ character, runtime, overrides, entries });

        const preview = previewRuntimeOperation(runtime, sheet, operation);
        if (preview.warnings.some(warning => warning.severity === "error")) return invalid(preview.warnings);

        const next: CharacterRuntimeStateRecord = { ...preview.next, revision: runtime.revision + 1, updatedAt: now };
        const accepted = await repositories.runtime.replace(next, expectedRuntimeRevision);
        if (!accepted) return stale(characterId, expectedRuntimeRevision, null);

        const sequence = (await repositories.actions.latestSequence(characterId)) + 1;
        const kind: RuntimeActionKind = reversesActionId ? "undo" : operation.kind;
        const action: CharacterActionRecord = {
          id: `${characterId}:action:${sequence}`,
          characterId,
          sequence,
          operationId,
          kind,
          ...(preview.delta !== undefined ? { delta: preview.delta } : {}),
          ...(preview.targetId ? { targetId: preview.targetId } : {}),
          resultingRuntimeRevision: next.revision,
          ...(reversesActionId ? { reversesActionId } : {}),
          reversible: !reversesActionId,
          ...(note ? { note } : {}),
          createdAt: now,
          updatedAt: now,
        };
        await repositories.actions.append(action);
        if (reversesActionId) await repositories.actions.markConsumed(reversesActionId);

        return ok({
          runtime: next,
          actionId: action.id,
          undoable: !reversesActionId && inverseOperation(action) !== undefined,
          warnings: preview.warnings,
        });
      },
    );
  }
}
