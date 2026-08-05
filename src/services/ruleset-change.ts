/**
 * Moving a draft to a different ruleset, as a two-phase decision.
 *
 * A ruleset change can be destructive: a class, an origin, a background, a
 * subclass and every choice and equipment package belong to the ruleset that
 * defined them, and one the incoming ruleset does not carry has to be dropped.
 * Doing that on the click that selects the new ruleset means the user finds out
 * what it cost afterwards, which is the wrong order for an action that cannot be
 * undone from inside the builder.
 *
 * So the change is computed first and written second — and it is computed per
 * value, not per ruleset. A ruleset ID changing is not by itself a reason to
 * discard a selection: two profiles can scope the same entries, and a class the
 * incoming ruleset still activates is still a valid class. Each value is
 * therefore checked against the content the *target* ruleset actually resolves.
 * The entry has to be present, under the category its field means, and a stored
 * choice's options have to still be offered by a choice the target build
 * reaches. Only what fails that check is cleared.
 *
 * `resolveRulesetChange` produces the report and the resulting build in one pass
 * over the same inputs, so what the user reads and what is written cannot drift
 * apart. Nothing here writes, and nothing here names a class, a species or a
 * choice: every label comes from the content entry the draft actually points at.
 */
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { Category, ContentEntry, ID, RulesetProfile } from "@/src/domain/model";
import { originIncreasePatternFor, reconcileAbilityAllocation } from "@/src/services/ability-allocation";
import { maxSupportedLevel, planActivation } from "@/src/services/choice-planner";
import { requiredChoicesFor, requiredEquipmentChoices } from "@/src/services/build-planner";

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
  /** Values that survive untouched — both ruleset-independent and still-valid. */
  retained: readonly RulesetChangeField[];
  /** Values the change clears, because the target ruleset does not carry them. */
  cleared: readonly RulesetChangeField[];
  /** Values that are neither kept as-is nor dropped, but derived again. */
  recomputed: readonly RulesetChangeField[];
  /**
   * Values the change leaves in an explicit repair state rather than silently
   * rewriting — today, a target level the incoming content does not reach.
   */
  conflicts: readonly RulesetChangeField[];
  /** True when the proposal is the ruleset the draft is already in. */
  noop: boolean;
  /** The revision a confirmation must carry. A later write invalidates it. */
  expectedRevision: number;
}

export interface RulesetChangeResolution {
  preview: RulesetChangePreview;
  /** Exactly the build the previewed change produces. */
  nextBuild: CharacterDraftBuild;
}

/**
 * The identity fields a ruleset owns, and the categories each one may hold.
 *
 * `speciesId` accepts `race` too: the legacy category is still in the public
 * schema, and a draft recorded under it names a real origin, not a broken one.
 */
const IDENTITY_FIELDS: readonly {
  field: "classId" | "subclassId" | "speciesId" | "backgroundId";
  label: string;
  categories: readonly Category[];
}[] = [
  { field: "classId", label: "Class", categories: ["class"] },
  { field: "subclassId", label: "Subclass", categories: ["subclass"] },
  { field: "speciesId", label: "Origin species", categories: ["species", "race"] },
  { field: "backgroundId", label: "Background", categories: ["background"] },
];

/** The build fields no ruleset owns, so no ruleset change can touch them. */
const INDEPENDENT_FIELDS: readonly { field: keyof CharacterDraftBuild; label: string }[] = [
  { field: "name", label: "Character name" },
  { field: "nickname", label: "Nickname" },
  { field: "level", label: "Target level" },
  { field: "abilityMethod", label: "Ability generation method" },
  { field: "abilityBaseScores", label: "Base ability scores" },
  { field: "manualValues", label: "Manual values" },
  { field: "manualActions", label: "Manual actions" },
];

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/**
 * The exact effect of moving `build` from one ruleset to another, and the build
 * that effect produces.
 *
 * Pure. The caller decides whether to apply it, and applying it is a separate
 * command that revalidates the revision the preview was computed at.
 */
export function resolveRulesetChange(input: {
  draftId: ID;
  expectedRevision: number;
  build: CharacterDraftBuild;
  currentRuleset: RulesetProfile | undefined;
  currentRulesetId: ID;
  currentEntries: readonly ContentEntry[];
  proposedRuleset: RulesetProfile;
  proposedEntries: readonly ContentEntry[];
}): RulesetChangeResolution {
  const { build, currentEntries, proposedEntries } = input;
  const noop = input.currentRulesetId === input.proposedRuleset.id;

  const currentById = new Map(currentEntries.map(entry => [entry.id, entry]));
  const proposedById = new Map(proposedEntries.map(entry => [entry.id, entry]));
  /** A name the user recognises, preferring whichever scope still holds it. */
  const nameOf = (id: ID) => proposedById.get(id)?.name ?? currentById.get(id)?.name ?? id;

  const retained: RulesetChangeField[] = [];
  const cleared: RulesetChangeField[] = [];
  const recomputed: RulesetChangeField[] = [];
  const conflicts: RulesetChangeField[] = [];

  for (const { field, label } of INDEPENDENT_FIELDS)
    if (isPresent(build[field])) retained.push({ fieldPath: field, label });

  if (noop) {
    return {
      preview: {
        draftId: input.draftId,
        currentRulesetId: input.currentRulesetId,
        currentRulesetName: input.currentRuleset?.name ?? input.currentRulesetId,
        proposedRulesetId: input.proposedRuleset.id,
        proposedRulesetName: input.proposedRuleset.name,
        retained,
        cleared,
        recomputed,
        conflicts,
        noop,
        expectedRevision: input.expectedRevision,
      },
      nextBuild: build,
    };
  }

  // ---- identity ------------------------------------------------------------
  // Each field survives only when the target ruleset resolves the same entry
  // under a category the field can actually mean.
  const keptIdentity: Partial<Record<(typeof IDENTITY_FIELDS)[number]["field"], ID>> = {};
  for (const { field, label, categories } of IDENTITY_FIELDS) {
    const value = build[field];
    if (!value) continue;
    const targetEntry = proposedById.get(value);
    if (targetEntry && categories.includes(targetEntry.category)) keptIdentity[field] = value;
    else cleared.push({ fieldPath: field, label: `${label}: ${nameOf(value)}`, recordId: value });
  }
  // A subclass belongs to its class. Keeping one whose class was dropped would
  // leave a subclass with nothing to be a subclass of.
  if (keptIdentity.subclassId && !keptIdentity.classId) {
    const dropped = keptIdentity.subclassId;
    delete keptIdentity.subclassId;
    cleared.push({ fieldPath: "subclassId", label: `Subclass: ${nameOf(dropped)}`, recordId: dropped });
  }

  let candidate: CharacterDraftBuild = { ...build, ...identityPatch(keptIdentity) };
  let activation = planActivation(candidate, proposedEntries);

  // The class has to declare the subclass, not merely coexist with it.
  if (keptIdentity.subclassId && activation.subclass) {
    const offered = activation.subclass.options.some(option => option.id === keptIdentity.subclassId);
    if (!offered) {
      const dropped = keptIdentity.subclassId;
      delete keptIdentity.subclassId;
      cleared.push({ fieldPath: "subclassId", label: `Subclass: ${nameOf(dropped)}`, recordId: dropped });
      candidate = { ...build, ...identityPatch(keptIdentity) };
      activation = planActivation(candidate, proposedEntries);
    }
  }

  for (const { field, label } of IDENTITY_FIELDS) {
    const value = keptIdentity[field];
    if (value) retained.push({ fieldPath: field, label: `${label}: ${nameOf(value)}`, recordId: value });
  }

  // ---- choices and equipment ----------------------------------------------
  // A stored selection survives when the target build still reaches that choice
  // and still offers every option the draft had picked.
  //
  // Reached to a fixpoint rather than in one pass: a choice can be reachable
  // only because another choice's selected option activated the entry that
  // declares it. Dropping the outer selection therefore removes the inner
  // choice, and a single pass would keep an inner selection that nothing offers
  // any more. Each round can only remove selections, so this terminates.
  let choiceSelections = build.choiceSelections;
  for (let round = 0; round < 8; round += 1) {
    const offered = offeredOptionsFor(requiredChoicesFor(candidate, proposedEntries, activation));
    const surviving = survivingSelections(choiceSelections, offered);
    if (sameSelections(surviving, choiceSelections)) break;
    choiceSelections = surviving;
    candidate = { ...candidate, choiceSelections };
    activation = planActivation(candidate, proposedEntries);
  }

  // Equipment is resolved after the choices settle, because a bundle can be
  // granted by an entry a now-cleared selection was the only route to.
  const equipmentSelections = survivingSelections(
    build.equipmentSelections,
    offeredOptionsFor(requiredEquipmentChoices(candidate, proposedEntries, activation)),
  );
  candidate = { ...candidate, choiceSelections, equipmentSelections };

  recordSelectionVerdicts({
    stored: build.choiceSelections,
    kept: choiceSelections,
    fieldPrefix: "choiceSelections",
    labelPrefix: "Choice",
    nameOf,
    retained,
    cleared,
  });
  recordSelectionVerdicts({
    stored: build.equipmentSelections,
    kept: equipmentSelections,
    fieldPrefix: "equipmentSelections",
    labelPrefix: "Equipment choice",
    nameOf,
    retained,
    cleared,
  });

  // ---- origin increases ----------------------------------------------------
  // Neither ruleset-independent nor owned by a single cleared field: they were
  // authorised by an origin that may or may not have survived, so they are
  // revalidated against whatever pattern is now in force rather than assumed.
  const allocation = reconcileAbilityAllocation(candidate, proposedEntries);
  const hadIncreases = Object.keys(build.abilityIncreases).length > 0;
  if (hadIncreases) {
    if (allocation.invalid.length) {
      const pattern = originIncreasePatternFor(build, currentEntries);
      recomputed.push({
        fieldPath: "abilityIncreases",
        label: pattern
          ? `Origin increases from ${pattern.sourceLabel} the incoming content does not authorise are removed`
          : "Origin increases the incoming content does not authorise are removed",
        ...(pattern ? { recordId: pattern.sourceEntryId } : {}),
      });
      recomputed.push({ fieldPath: "abilityScores", label: "Final ability scores are recalculated" });
    } else {
      retained.push({ fieldPath: "abilityIncreases", label: "Origin ability increases" });
    }
  }

  // ---- target level --------------------------------------------------------
  // Reported, never silently reduced: choosing the level is the user's decision,
  // and quietly lowering it produces a character they did not ask for.
  const supported = maxSupportedLevel(proposedEntries, keptIdentity.classId);
  if (build.level > supported)
    conflicts.push({
      fieldPath: "level",
      label: `Target level ${build.level} is beyond the level this content reaches (${supported}). Choose a supported level or a class that covers it.`,
    });

  return {
    preview: {
      draftId: input.draftId,
      currentRulesetId: input.currentRulesetId,
      currentRulesetName: input.currentRuleset?.name ?? input.currentRulesetId,
      proposedRulesetId: input.proposedRuleset.id,
      proposedRulesetName: input.proposedRuleset.name,
      retained,
      cleared,
      recomputed,
      conflicts,
      noop,
      expectedRevision: input.expectedRevision,
    },
    nextBuild: {
      ...candidate,
      abilityBaseScores: { ...allocation.base },
      abilityIncreases: { ...allocation.increases },
      abilityScores: { ...allocation.final },
    },
  };
}

/** The identity fields as a patch, with anything dropped explicitly undefined. */
function identityPatch(kept: Partial<Record<(typeof IDENTITY_FIELDS)[number]["field"], ID>>) {
  return {
    classId: kept.classId,
    subclassId: kept.subclassId,
    speciesId: kept.speciesId,
    backgroundId: kept.backgroundId,
  };
}

/** Each choice's offered option IDs, keyed by the choice's own ID. */
function offeredOptionsFor(
  choices: readonly { choiceId: ID; options: readonly { id: ID }[] }[],
): Map<ID, Set<ID>> {
  return new Map(choices.map(choice => [choice.choiceId, new Set(choice.options.map(option => option.id))]));
}

/**
 * The stored selections the target still offers in full.
 *
 * Pure, so it can be re-run to a fixpoint without recording anything twice.
 * A selection survives only when its choice is reachable *and* every option it
 * holds is still on offer — a partially valid selection is not silently trimmed
 * into a different answer than the user gave.
 */
function survivingSelections(
  stored: Readonly<Record<ID, readonly ID[]>>,
  offered: ReadonlyMap<ID, ReadonlySet<ID>>,
): Record<ID, readonly ID[]> {
  const next: Record<ID, readonly ID[]> = {};
  for (const [choiceId, selected] of Object.entries(stored)) {
    if (!selected.length) continue;
    const options = offered.get(choiceId);
    if (options && selected.every(option => options.has(option))) next[choiceId] = [...selected];
  }
  return next;
}

/** Whether two selection maps hold the same choices with the same options. */
function sameSelections(a: Readonly<Record<ID, readonly ID[]>>, b: Readonly<Record<ID, readonly ID[]>>): boolean {
  const keysA = Object.keys(a).filter(key => a[key]?.length);
  const keysB = Object.keys(b).filter(key => b[key]?.length);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => {
    const left = a[key] ?? [];
    const right = b[key] ?? [];
    return left.length === right.length && left.every((value, index) => value === right[index]);
  });
}

/** Records one retained-or-cleared verdict per stored selection, once. */
function recordSelectionVerdicts(input: {
  stored: Readonly<Record<ID, readonly ID[]>>;
  kept: Readonly<Record<ID, readonly ID[]>>;
  fieldPrefix: string;
  labelPrefix: string;
  nameOf(id: ID): string;
  retained: RulesetChangeField[];
  cleared: RulesetChangeField[];
}): void {
  for (const [choiceId, selected] of Object.entries(input.stored)) {
    if (!selected.length) continue;
    const field = {
      fieldPath: `${input.fieldPrefix}.${choiceId}`,
      label: `${input.labelPrefix}: ${input.nameOf(choiceId)}`,
      recordId: choiceId,
    };
    if (input.kept[choiceId]?.length) input.retained.push(field);
    else input.cleared.push(field);
  }
}

/**
 * What moving this draft would cost, without the resulting build.
 *
 * The read half of the two-phase change.
 */
export function planRulesetChange(input: Parameters<typeof resolveRulesetChange>[0]): RulesetChangePreview {
  return resolveRulesetChange(input).preview;
}

/**
 * The build a confirmed change produces.
 *
 * Derived from the same pass as the preview, so the values the user read and the
 * values that are written are the same values.
 */
export function applyRulesetChange(input: Parameters<typeof resolveRulesetChange>[0]): CharacterDraftBuild {
  return resolveRulesetChange(input).nextBuild;
}
