/**
 * Moving a draft to a different ruleset, as a two-phase decision.
 *
 * A ruleset change is destructive in a way no other builder action is: a class,
 * an origin, a background, a subclass and every choice and equipment package
 * belong to the ruleset that defined them, so switching has to drop all of them.
 * Doing that on the click that selects the new ruleset means the user finds out
 * what it cost afterwards, which is the wrong order for an action that cannot be
 * undone from inside the builder.
 *
 * So the change is computed first and written second. `previewRulesetChange`
 * reads both rulesets and reports exactly what would be cleared, what would
 * survive and what would be recomputed; the service applies precisely that.
 * Nothing here writes, and nothing here names a class, a species or a choice:
 * every label comes from the content entry the draft actually points at.
 */
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry, ID, RulesetProfile } from "@/src/domain/model";
import { originIncreasePatternFor, reconcileAbilityAllocation } from "@/src/services/ability-allocation";

/** One value the change touches, addressed by its path in the build. */
export interface RulesetChangeField {
  /** Path within `CharacterDraftBuild`, e.g. `classId` or `choiceSelections.<id>`. */
  fieldPath: string;
  /** What to call it on screen. A content name when one is available. */
  label: string;
  /** The record whose identity is being dropped, when there is one. */
  recordId?: ID;
}

export interface RulesetChangePreview {
  draftId: ID;
  currentRulesetId: ID;
  currentRulesetName: string;
  proposedRulesetId: ID;
  proposedRulesetName: string;
  /** Values that survive untouched, because nothing about them is ruleset-scoped. */
  retained: readonly RulesetChangeField[];
  /** Values the change clears, because the outgoing ruleset defined them. */
  cleared: readonly RulesetChangeField[];
  /** Values that are neither kept as-is nor dropped, but derived again. */
  recomputed: readonly RulesetChangeField[];
  /** True when the proposal is the ruleset the draft is already in. */
  noop: boolean;
  /** The revision a confirmation must carry. A later write invalidates it. */
  expectedRevision: number;
}

/** The build fields a ruleset change always clears. */
const CLEARED_IDENTITY_FIELDS: readonly { field: "classId" | "subclassId" | "speciesId" | "backgroundId"; label: string }[] = [
  { field: "classId", label: "Class" },
  { field: "subclassId", label: "Subclass" },
  { field: "speciesId", label: "Origin species" },
  { field: "backgroundId", label: "Background" },
];

/** The build fields a ruleset change never touches. */
const RETAINED_FIELDS: readonly { field: keyof CharacterDraftBuild; label: string }[] = [
  { field: "name", label: "Character name" },
  { field: "nickname", label: "Nickname" },
  { field: "level", label: "Target level" },
  { field: "abilityMethod", label: "Ability generation method" },
  { field: "abilityBaseScores", label: "Base ability scores" },
  { field: "manualValues", label: "Manual values" },
  { field: "manualActions", label: "Manual actions" },
];

/**
 * The exact effect of moving `build` from one ruleset to another.
 *
 * Pure. The caller decides whether to apply it, and applying it is a separate
 * command that revalidates the revision this preview was computed at.
 */
export function planRulesetChange(input: {
  draftId: ID;
  expectedRevision: number;
  build: CharacterDraftBuild;
  currentRuleset: RulesetProfile | undefined;
  currentRulesetId: ID;
  currentEntries: readonly ContentEntry[];
  proposedRuleset: RulesetProfile;
}): RulesetChangePreview {
  const { build, currentEntries } = input;
  const byId = new Map(currentEntries.map(entry => [entry.id, entry]));
  const nameOf = (id: ID | undefined) => (id ? (byId.get(id)?.name ?? id) : undefined);
  const noop = input.currentRulesetId === input.proposedRuleset.id;

  const cleared: RulesetChangeField[] = [];
  if (!noop) {
    for (const { field, label } of CLEARED_IDENTITY_FIELDS) {
      const value = build[field];
      if (!value) continue;
      cleared.push({ fieldPath: field, label: `${label}: ${nameOf(value) ?? value}`, recordId: value });
    }
    for (const [choiceId, selected] of Object.entries(build.choiceSelections)) {
      if (!selected.length) continue;
      cleared.push({
        fieldPath: `choiceSelections.${choiceId}`,
        label: `Choice: ${nameOf(choiceId) ?? choiceId}`,
        recordId: choiceId,
      });
    }
    for (const [choiceId, selected] of Object.entries(build.equipmentSelections)) {
      if (!selected.length) continue;
      cleared.push({
        fieldPath: `equipmentSelections.${choiceId}`,
        label: `Equipment choice: ${nameOf(choiceId) ?? choiceId}`,
        recordId: choiceId,
      });
    }
  }

  const retained: RulesetChangeField[] = RETAINED_FIELDS.filter(({ field }) => {
    const value = build[field];
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  }).map(({ field, label }) => ({ fieldPath: field, label }));

  // The origin increases are the one value that is neither ruleset-independent
  // nor simply owned by a cleared field: they were authorised by an origin that
  // is about to be dropped, so they are recomputed rather than kept or deleted
  // by assumption.
  const recomputed: RulesetChangeField[] = [];
  const hasIncreases = Object.keys(build.abilityIncreases).length > 0;
  if (!noop && hasIncreases) {
    const pattern = originIncreasePatternFor(build, currentEntries);
    recomputed.push({
      fieldPath: "abilityIncreases",
      label: pattern
        ? `Origin increases from ${pattern.sourceLabel} are removed, and the final scores fall back to the base scores`
        : "Origin increases are removed, and the final scores fall back to the base scores",
      ...(pattern ? { recordId: pattern.sourceEntryId } : {}),
    });
    recomputed.push({ fieldPath: "abilityScores", label: "Final ability scores are recalculated" });
  }

  return {
    draftId: input.draftId,
    currentRulesetId: input.currentRulesetId,
    currentRulesetName: input.currentRuleset?.name ?? input.currentRulesetId,
    proposedRulesetId: input.proposedRuleset.id,
    proposedRulesetName: input.proposedRuleset.name,
    retained,
    cleared,
    recomputed,
    noop,
    expectedRevision: input.expectedRevision,
  };
}

/**
 * The build a confirmed change produces.
 *
 * It is derived from the same inputs as the preview, so the values the user read
 * and the values that are written cannot drift apart. The allocation is
 * reconciled against the *new* ruleset's content, which with no origin selected
 * means every increase is dropped and the finals return to the base scores.
 */
export function applyRulesetChange(
  build: CharacterDraftBuild,
  nextEntries: readonly ContentEntry[],
): CharacterDraftBuild {
  const cleared: CharacterDraftBuild = {
    ...build,
    classId: undefined,
    subclassId: undefined,
    speciesId: undefined,
    backgroundId: undefined,
    choiceSelections: {},
    equipmentSelections: {},
  };
  const allocation = reconcileAbilityAllocation(cleared, nextEntries);
  return {
    ...cleared,
    abilityBaseScores: { ...allocation.base },
    abilityIncreases: { ...allocation.increases },
    abilityScores: { ...allocation.final },
  };
}
