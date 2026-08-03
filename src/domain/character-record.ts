/**
 * M2.1 character persistence contracts.
 *
 * These records are additive to the M1.4 content and rules model. The legacy
 * `Character` shape in `model.ts` stays untouched so the merged rules-engine
 * coverage keeps compiling; `toRuleCharacter` in the derived resolver projects a
 * `CharacterRecord` onto it when pure evaluation is required.
 *
 * Durable build state, runtime play state, session actions and typed overrides
 * are separate records with independent revisions, as required by
 * `docs/product/M2_SERVICE_BOUNDARIES.md`.
 */
import type { Ability, Audit, ID, ISODate } from "@/src/domain/model";

/** Guidance preference only. It never clears selections, manual values or overrides. */
export type CharacterPresentationMode = "guided" | "flexible";
export type AbilityMethod = "standard-array" | "manual";

/** D-04 accepts exactly two typed operations. */
export type OverrideOperation = "replace" | "add";
export type OverrideScope = "persistent" | "until-level-up";
export type OverrideStatus = "active" | "stale";

/** D-03 completion vocabulary. Renderable and guided-complete are independent. */
export type CompletenessClass =
  | "renderable-automatic"
  | "renderable-manual"
  | "guided-complete"
  | "incomplete";

export interface ClassLevelSelection {
  readonly classId: ID;
  readonly subclassId?: ID;
  readonly level: number;
}

/**
 * Stable allow-listed derived-field paths. Overrides and manual values may only
 * target one of these; anything else is rejected without evaluation.
 */
export const ABILITIES: readonly Ability[] = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];

const STATIC_TARGET_PATHS = [
  "proficiencyBonus",
  "hitPoints.maximum",
  "hitPoints.current",
  "armorClass",
  "initiative",
  "speed",
  "hitDice.total",
] as const;

/**
 * Prefixes whose remainder is a stable content ID. Ability paths are deliberately
 * absent: they are matched exhaustively against the six abilities above, so
 * `abilityScore.<anything-else>` is rejected rather than treated as an ID.
 */
const PREFIX_TARGET_PATHS = ["savingThrow.", "check.", "resource.", "attack."] as const;

/** Pure allow-list check. No string is ever evaluated. */
export function isAllowedTargetPath(path: string): boolean {
  if ((STATIC_TARGET_PATHS as readonly string[]).includes(path)) return true;
  for (const ability of ABILITIES) {
    if (path === `abilityScore.${ability}` || path === `abilityModifier.${ability}`) return true;
  }
  const prefix = PREFIX_TARGET_PATHS.find(candidate => path.startsWith(candidate));
  if (!prefix) return false;
  const remainder = path.slice(prefix.length);
  if (!remainder || remainder.length > 160) return false;
  // Stable IDs and one optional suffix segment, e.g. `resource:rallying-breath.maximum`.
  return /^[a-z0-9][a-z0-9:_-]*(?:\.[a-z][a-zA-Z]*)?$/.test(remainder);
}

/**
 * Durable, revision-bearing committed character. Runtime play values are NOT
 * stored here; they live in `CharacterRuntimeStateRecord`.
 */
export interface CharacterRecord extends Audit {
  id: ID;
  /** Compare-and-swap token. Increments on every durable write. */
  revision: number;
  rulesetProfileId: ID;
  presentation: CharacterPresentationMode;
  /** May be empty; the sheet falls back to `Unnamed character`. */
  name: string;
  /** D-02: identity only, never a mechanical input. */
  nickname?: string;
  pronouns?: string;
  level: number;
  classLevels: readonly ClassLevelSelection[];
  speciesId?: ID;
  backgroundId?: ID;
  abilityMethod: AbilityMethod;
  /** Partial: an unresolved ability is unknown, never zero. */
  abilityScores: Readonly<Partial<Record<Ability, number>>>;
  choiceSelections: Readonly<Record<ID, readonly ID[]>>;
  equipmentSelections: Readonly<Record<ID, readonly ID[]>>;
  /** Explicit user-entered values keyed by allow-listed target path. */
  manualValues: Readonly<Record<string, number>>;
  /** Manual-sheet action labels for a classless flexible character. */
  manualActions: readonly { readonly id: ID; readonly label: string; readonly expression?: string }[];
  acknowledgedIssueCodes: readonly string[];
  /** Fingerprint of the ruleset and content the last commit was reviewed against. */
  contentFingerprint: string;
  status: "active" | "archived";
  kind: "player-character";
  tags: readonly string[];
  lastPlayedAt?: ISODate;
}

/** Immutable durable history. Never updated or deleted in normal flows. */
export interface CharacterVersionRecord extends Audit {
  id: ID;
  characterId: ID;
  sequence: number;
  reason: "initial" | "edit" | "override" | "level-up" | "import" | "restore";
  /** Operation ID for retry idempotency; duplicates are rejected. */
  operationId: ID;
  snapshot: CharacterRecord;
  parentVersionId?: ID;
}

export type ConditionStateRecord = { readonly conditionId: ID; readonly appliedAt: ISODate };

/** Session play state. Its own revision; never written by a durable build path alone. */
export interface CharacterRuntimeStateRecord extends Audit {
  /** One current runtime state per character; the character ID is the key. */
  characterId: ID;
  revision: number;
  currentHitPoints: number;
  maximumHitPointsAtLastSync: number;
  temporaryHitPoints: number;
  /** Current uses keyed by resource stable ID. */
  resourceUses: Readonly<Record<ID, number>>;
  resourceMaximaAtLastSync: Readonly<Record<ID, number>>;
  conditions: readonly ConditionStateRecord[];
  hitDiceRemaining: number;
  exhaustion: number;
  deathSaves: { readonly successes: number; readonly failures: number };
}

export type RuntimeActionKind =
  | "damage"
  | "heal"
  | "temporary-hit-points"
  | "resource-spend"
  | "resource-recover"
  | "condition-add"
  | "condition-remove"
  | "short-rest"
  | "long-rest"
  | "undo";

/**
 * A bounded snapshot of only the runtime fields one action changed.
 *
 * Storing the prior values is what makes undo exact. Inferring an inverse from
 * the requested amount cannot be correct: healing 5 at 9/10 clamps to 10, so the
 * inverse of "heal 5" is not "damage 5", and damage absorbed by temporary hit
 * points cannot be undone by healing at all. Only changed fields are present, so
 * an action record stays small and carries no unrelated state.
 */
export interface RuntimeFragment {
  currentHitPoints?: number;
  temporaryHitPoints?: number;
  hitDiceRemaining?: number;
  exhaustion?: number;
  /** Only the resources whose current uses changed. */
  resourceUses?: Readonly<Record<ID, number>>;
  /** The whole condition list, when it changed. */
  conditions?: readonly ConditionStateRecord[];
}

/**
 * Lightweight reversible runtime mutation metadata. Deltas, stable IDs and
 * bounded numeric runtime fragments only — never copied private notes, names or
 * rule text. A user note is stored in `note` as user content and is omitted from
 * every list/query summary.
 */
export interface CharacterActionRecord extends Audit {
  id: ID;
  characterId: ID;
  sequence: number;
  operationId: ID;
  kind: RuntimeActionKind;
  /** Signed numeric delta actually applied, for display. Never used to undo. */
  delta?: number;
  targetId?: ID;
  /** Runtime revision the action produced. */
  resultingRuntimeRevision: number;
  /** Exact prior values of every field the action changed. */
  before?: RuntimeFragment;
  /** Exact resulting values, so a stale replay can be detected. */
  after?: RuntimeFragment;
  /** Set on an undo action; references the action it reverses. */
  reversesActionId?: ID;
  /**
   * True while this action can still be reversed. It is only ever true when
   * `before` holds enough information to restore the exact prior state.
   */
  reversible: boolean;
  note?: string;
}

/** Restore point: durable version reference plus the runtime state at a recovery boundary. */
export interface CharacterSnapshotRecord extends Audit {
  id: ID;
  characterId: ID;
  kind: "explicit-session" | "pre-level" | "pre-import-replace" | "pre-restore";
  label: string;
  characterVersionId: ID;
  runtimeState: CharacterRuntimeStateRecord;
}

/** Typed durable `replace`/`add` provenance. Strings are never evaluated. */
export interface CharacterOverrideRecord extends Audit {
  id: ID;
  characterId: ID;
  targetPath: string;
  operation: OverrideOperation;
  value: number;
  /** Resolver output at the revision on which the override was accepted. */
  automaticBaseline: number | null;
  scope: OverrideScope;
  status: OverrideStatus;
  /** Optional private user explanation. Never logged or exported. */
  reason?: string;
  sourceId?: ID;
}

/**
 * Last safe derived snapshot. Display and recovery evidence for a character whose
 * definitions are missing; never trusted as a fresh calculation.
 */
export interface CharacterDerivedSnapshotRecord extends Audit {
  characterId: ID;
  characterRevision: number;
  contentFingerprint: string;
  confidence: "calculated" | "uncertain";
  /** Safe display summaries only: labels and numbers, no private text. */
  summary: Readonly<Record<string, string>>;
}

/** In-progress build. Independent revision; never queried as a committed character. */
export interface CharacterDraftRecord extends Audit {
  id: ID;
  revision: number;
  rulesetProfileId: ID;
  presentation: CharacterPresentationMode;
  status: "in-progress" | "committed" | "abandoned";
  /** Step ID the user last committed a choice on. */
  lastStepId: string;
  /** Set when the draft edits an existing character rather than creating one. */
  editingCharacterId?: ID;
  build: CharacterDraftBuild;
}

/** The mutable build payload of a draft. Mirrors the durable record's choice surface. */
export interface CharacterDraftBuild {
  name: string;
  nickname?: string;
  pronouns?: string;
  level: number;
  classId?: ID;
  speciesId?: ID;
  backgroundId?: ID;
  abilityMethod: AbilityMethod;
  /** Final scores, i.e. `abilityBaseScores` plus `abilityIncreases`. */
  abilityScores: Readonly<Partial<Record<Ability, number>>>;
  /** Standard-array assignment before origin increases, so a resume is faithful. */
  abilityBaseScores: Readonly<Partial<Record<Ability, number>>>;
  /** Origin increases the user placed, keyed by ability. */
  abilityIncreases: Readonly<Partial<Record<Ability, number>>>;
  choiceSelections: Readonly<Record<ID, readonly ID[]>>;
  equipmentSelections: Readonly<Record<ID, readonly ID[]>>;
  manualValues: Readonly<Record<string, number>>;
  manualActions: readonly { readonly id: ID; readonly label: string; readonly expression?: string }[];
  acknowledgedIssueCodes: readonly string[];
}

export const EMPTY_DRAFT_BUILD: CharacterDraftBuild = {
  name: "",
  level: 1,
  abilityMethod: "standard-array",
  abilityScores: {},
  abilityBaseScores: {},
  abilityIncreases: {},
  choiceSelections: {},
  equipmentSelections: {},
  manualValues: {},
  manualActions: [],
  acknowledgedIssueCodes: [],
};
