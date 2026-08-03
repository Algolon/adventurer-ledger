/**
 * CharacterRuntimeService.
 *
 * Applies bounded play mutations. A runtime action updates runtime state and
 * appends one lightweight session-action entry in a single transaction (D-05);
 * it never writes the durable character, a character version, a build override,
 * the ruleset or content.
 *
 * Undo is exact. Every reversible action stores the prior values of the fields
 * it changed, and undo restores those fields rather than inferring an inverse
 * from the requested amount. That is required for correctness, not tidiness:
 * healing 5 at 9/10 clamps to 10 so "damage 5" would land at 5, and damage
 * absorbed by temporary hit points cannot be reversed by healing at all.
 *
 * A resource fragment records values and absences separately. A missing
 * `resourceUses` key is a real state that the resolver reads as "starts full",
 * so an action that introduces a key must be reversed by deleting it again —
 * which a value merge cannot do. `resourceUsesRemoved` carries those keys, and
 * `fragmentRestoresExactly` proves the whole fragment round-trips before the
 * action is allowed to call itself reversible.
 *
 * Undo appends a new typed action referencing the one it reverses; history is
 * never deleted, and a reversed action is marked spent so it cannot be undone
 * twice.
 *
 * Known bound: `undoLast` searches the most recent actions only (the repository
 * default is 50). Deep history stays readable, but an undo target older than
 * that window is not offered. No acceptance criterion requires unbounded undo
 * depth, and widening it is a history-browsing feature rather than a runtime
 * correctness fix.
 */
import type {
  CharacterActionRecord,
  CharacterRuntimeStateRecord,
  RuntimeActionKind,
  RuntimeFragment,
} from "@/src/domain/character-record";
import type { ID } from "@/src/domain/model";
import { resolveDerivedCharacter, type DerivedCharacterSheet } from "@/src/services/derived-resolver";
import { loadRulesetScope } from "@/src/services/content-scope";
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
  /** True when the stored fragment can restore the exact prior state. */
  undoable: boolean;
  warnings: readonly ServiceIssue[];
}

const NUMERIC_FIELDS = ["currentHitPoints", "temporaryHitPoints", "hitDiceRemaining", "exhaustion"] as const;

const sameConditions = (
  left: CharacterRuntimeStateRecord["conditions"],
  right: CharacterRuntimeStateRecord["conditions"],
) =>
  left.length === right.length &&
  left.every((item, index) => item.conditionId === right[index]?.conditionId && item.appliedAt === right[index]?.appliedAt);

/**
 * Bounded diff of two runtime states: only the fields that actually changed.
 * Returns `undefined` for both sides when nothing changed, which marks the
 * action as having no effect to reverse.
 */
export function runtimeFragmentDiff(
  previous: CharacterRuntimeStateRecord,
  next: CharacterRuntimeStateRecord,
): { before: RuntimeFragment; after: RuntimeFragment; changed: boolean } {
  const before: RuntimeFragment = {};
  const after: RuntimeFragment = {};
  let changed = false;

  for (const field of NUMERIC_FIELDS) {
    if (previous[field] !== next[field]) {
      before[field] = previous[field];
      after[field] = next[field];
      changed = true;
    }
  }

  const resourceKeys = new Set([...Object.keys(previous.resourceUses), ...Object.keys(next.resourceUses)]);
  const beforeUses: Record<ID, number> = {};
  const afterUses: Record<ID, number> = {};
  const beforeRemoved: ID[] = [];
  const afterRemoved: ID[] = [];
  let resourcesChanged = false;
  for (const key of [...resourceKeys].sort()) {
    const from = previous.resourceUses[key];
    const to = next.resourceUses[key];
    if (from === to) continue;
    resourcesChanged = true;
    // A key that is absent on one side is recorded as an explicit removal for
    // that side. Recording only the values would make the absence unrecoverable,
    // because applying the fragment merges and a merge cannot delete a key.
    if (from === undefined) beforeRemoved.push(key);
    else beforeUses[key] = from;
    if (to === undefined) afterRemoved.push(key);
    else afterUses[key] = to;
  }
  if (resourcesChanged) {
    before.resourceUses = beforeUses;
    after.resourceUses = afterUses;
    if (beforeRemoved.length) before.resourceUsesRemoved = beforeRemoved;
    if (afterRemoved.length) after.resourceUsesRemoved = afterRemoved;
    changed = true;
  }

  if (!sameConditions(previous.conditions, next.conditions)) {
    before.conditions = previous.conditions.map(item => ({ ...item }));
    after.conditions = next.conditions.map(item => ({ ...item }));
    changed = true;
  }

  return { before, after, changed };
}

/** Writes a bounded fragment back onto a runtime state. */
export function applyRuntimeFragment(
  state: CharacterRuntimeStateRecord,
  fragment: RuntimeFragment,
): CharacterRuntimeStateRecord {
  const next: CharacterRuntimeStateRecord = { ...state };
  for (const field of NUMERIC_FIELDS) {
    const value = fragment[field];
    if (typeof value === "number") next[field] = value;
  }
  if (fragment.resourceUses || fragment.resourceUsesRemoved) {
    const uses: Record<ID, number> = { ...state.resourceUses, ...fragment.resourceUses };
    // Removals are applied after the merge, because deleting a key is exactly
    // what a merge cannot express.
    for (const key of fragment.resourceUsesRemoved ?? []) delete uses[key];
    next.resourceUses = uses;
  }
  if (fragment.conditions) next.conditions = fragment.conditions.map(item => ({ ...item }));
  return next;
}

/** Presence-sensitive comparison: an absent key and a numeric value differ. */
const sameResourceUses = (left: Readonly<Record<ID, number>>, right: Readonly<Record<ID, number>>) => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
};

/**
 * True when applying `fragment` to `next` reproduces `previous` exactly.
 *
 * Reversibility is derived from this check rather than from the mere presence
 * of a stored fragment, so an action cannot be labelled reversible unless its
 * fragment demonstrably restores the prior runtime state. Deriving the label
 * from the property it claims is what keeps the two from drifting apart.
 */
export function fragmentRestoresExactly(
  previous: CharacterRuntimeStateRecord,
  next: CharacterRuntimeStateRecord,
  fragment: RuntimeFragment,
): boolean {
  const restored = applyRuntimeFragment(next, fragment);
  return (
    NUMERIC_FIELDS.every(field => restored[field] === previous[field]) &&
    sameResourceUses(restored.resourceUses, previous.resourceUses) &&
    sameConditions(restored.conditions, previous.conditions)
  );
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
      const from = next.currentHitPoints;
      next.currentHitPoints = clamp(from - remaining, 0, maximumHitPoints, "HIT_POINTS_CLAMPED", "hitPoints.current");
      // The reported delta is what was applied, not what was requested.
      return { next, delta: next.currentHitPoints - from - absorbed, warnings };
    }
    case "heal": {
      const amount = Math.max(0, Math.trunc(operation.amount));
      const from = next.currentHitPoints;
      next.currentHitPoints = clamp(from + amount, 0, maximumHitPoints, "HIT_POINTS_CLAMPED", "hitPoints.current");
      return { next, delta: next.currentHitPoints - from, warnings };
    }
    case "temporary-hit-points": {
      const amount = Math.max(0, Math.trunc(operation.amount));
      // Temporary hit points replace rather than stack.
      const from = next.temporaryHitPoints;
      next.temporaryHitPoints = amount;
      return { next, delta: amount - from, warnings };
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

export class CharacterRuntimeService {
  private readonly clock: Clock;
  private readonly log: ServiceLogger;

  constructor(private readonly context: ServiceContext) {
    this.clock = context.clock ?? systemClock;
    this.log = context.logger ?? noopLogger;
  }

  async apply(command: RuntimeCommand): Promise<ServiceOutcome<RuntimeResult>> {
    const outcome = await this.mutate(command.characterId, command.expectedRuntimeRevision, command.operationId, {
      kind: "operation",
      operation: command.operation,
      ...(command.note ? { note: command.note } : {}),
    });
    this.log({
      operation: `runtime.${command.operation.kind}`,
      recordId: command.characterId,
      expectedRevision: command.expectedRuntimeRevision,
      ...(outcome.status === "ok" ? { actualRevision: outcome.result.runtime.revision } : {}),
    });
    return outcome;
  }

  /**
   * Undoes the most recent reversible action by restoring its stored prior
   * fragment. It appends history rather than deleting it, and marks the reversed
   * action spent so the same action cannot be undone twice.
   */
  async undoLast(characterId: ID, expectedRuntimeRevision: number, operationId: ID): Promise<ServiceOutcome<RuntimeResult>> {
    const { repositories } = this.context;
    const recent = await repositories.actions.listByCharacter(characterId, 50);
    const target = recent.find(action => action.reversible && action.kind !== "undo");
    if (!target) return invalid([{ code: "NOTHING_TO_UNDO", recordId: characterId, severity: "warning" }]);
    if (!target.before)
      return invalid([{ code: "ACTION_NOT_REVERSIBLE", recordId: target.id, severity: "warning" }]);

    const outcome = await this.mutate(characterId, expectedRuntimeRevision, operationId, {
      kind: "restore",
      fragment: target.before,
      reversesActionId: target.id,
    });
    this.log({ operation: "runtime.undo", recordId: characterId, expectedRevision: expectedRuntimeRevision });
    return outcome;
  }

  private async mutate(
    characterId: ID,
    expectedRuntimeRevision: number,
    operationId: ID,
    intent:
      | { kind: "operation"; operation: RuntimeOperation; note?: string }
      | { kind: "restore"; fragment: RuntimeFragment; reversesActionId: ID },
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
        database.rulesetProfiles,
      ],
      async (): Promise<ServiceOutcome<RuntimeResult>> => {
        const character = await repositories.characters.get(characterId);
        if (!character) return notFound(characterId);
        const runtime = await repositories.runtime.get(characterId);
        if (!runtime) return notFound(characterId);
        // The revision is validated inside the transaction that writes.
        if (runtime.revision !== expectedRuntimeRevision)
          return stale(characterId, expectedRuntimeRevision, runtime.revision);

        let proposed: CharacterRuntimeStateRecord;
        let delta: number | undefined;
        let targetId: ID | undefined;
        let warnings: ServiceIssue[] = [];

        if (intent.kind === "operation") {
          // The resolver supplies the bounds and recharge behaviour; the runtime
          // service applies no rules of its own.
          const [scope, overrides] = await Promise.all([
            loadRulesetScope(repositories, character.rulesetProfileId),
            repositories.overrides.listByCharacter(characterId),
          ]);
          const sheet = resolveDerivedCharacter({
            character,
            runtime,
            overrides,
            entries: scope.entries,
            ...(scope.ruleset ? { ruleset: scope.ruleset } : {}),
          });
          const preview = previewRuntimeOperation(runtime, sheet, intent.operation);
          if (preview.warnings.some(warning => warning.severity === "error")) return invalid(preview.warnings);
          proposed = preview.next;
          delta = preview.delta;
          targetId = preview.targetId;
          warnings = preview.warnings;
        } else {
          proposed = applyRuntimeFragment(runtime, intent.fragment);
        }

        const diff = runtimeFragmentDiff(runtime, proposed);
        // The label is derived from the fragment actually restoring the prior
        // state, not from the fragment merely existing.
        const reversible =
          intent.kind === "operation" && diff.changed && fragmentRestoresExactly(runtime, proposed, diff.before);
        const next: CharacterRuntimeStateRecord = { ...proposed, revision: runtime.revision + 1, updatedAt: now };
        const accepted = await repositories.runtime.replace(next, expectedRuntimeRevision);
        if (!accepted) return stale(characterId, expectedRuntimeRevision, null);

        const sequence = (await repositories.actions.latestSequence(characterId)) + 1;
        const kind: RuntimeActionKind = intent.kind === "restore" ? "undo" : intent.operation.kind;
        const action: CharacterActionRecord = {
          id: `${characterId}:action:${sequence}`,
          characterId,
          sequence,
          operationId,
          kind,
          ...(delta !== undefined ? { delta } : {}),
          ...(targetId ? { targetId } : {}),
          resultingRuntimeRevision: next.revision,
          // The fragments are history for every action that changed something;
          // `reversible` is the narrower claim that `before` can restore it.
          ...(diff.changed ? { before: diff.before, after: diff.after } : {}),
          ...(intent.kind === "restore" ? { reversesActionId: intent.reversesActionId } : {}),
          reversible,
          ...(intent.kind === "operation" && intent.note ? { note: intent.note } : {}),
          createdAt: now,
          updatedAt: now,
        };
        await repositories.actions.append(action);
        // Marking the reversed action spent prevents undoing it twice.
        if (intent.kind === "restore") await repositories.actions.markConsumed(intent.reversesActionId);

        return { status: "ok", result: { runtime: next, actionId: action.id, undoable: action.reversible, warnings } };
      },
    );
  }
}
