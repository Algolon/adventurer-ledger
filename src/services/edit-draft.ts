/**
 * The one conversion from a committed character to an editable build.
 *
 * Edit character is the only route to permanent change, so the draft it opens
 * has to be the character — not a blank form that happens to carry its ID. The
 * conversion lives here, alone, because the previous arrangement had no
 * conversion at all: the page created an empty draft, the commit service read
 * whatever that draft contained, and "editing" a character quietly meant
 * rebuilding it from nothing. Two partial reconstructions in two layers would
 * have been the same failure with more places to disagree.
 *
 * Two rules govern it.
 *
 * Nothing is dropped. A saved ID whose entry the installed content no longer
 * defines is copied across verbatim, not cleared. The build planner already
 * reports an unresolvable class, species, background, choice or equipment
 * selection against the step that owns it, so preserving the value turns a
 * silent deletion into a visible repair — and a user who reinstalls the content
 * finds their selection still there.
 *
 * Nothing is invented. The committed record stores final ability scores only,
 * so the base/increase split is *recovered* from the origin's own declared
 * pattern and rejected when it does not fit, rather than guessed at. Every other
 * field is a direct copy.
 */
import type {
  CharacterDraftBuild,
  CharacterRecord,
} from "@/src/domain/character-record";
import { EMPTY_DRAFT_BUILD } from "@/src/domain/character-record";
import type { ChoiceDefinition, ContentEntry, EquipmentBundleNode, ID } from "@/src/domain/model";
import { originIncreasePatternFor, recoverAbilityAllocation } from "@/src/services/ability-allocation";
import { standardArrayFor } from "@/src/services/content-scope";
import type { BuilderStepId } from "@/src/services/builder-steps";

/**
 * Something the hydration preserved but could not confirm against the content
 * installed right now. It names the step that can repair it and the record it
 * concerns — never the value itself.
 */
export interface EditDraftRepairNote {
  code:
    | "CLASS_SOURCE_MISSING"
    | "SUBCLASS_SOURCE_MISSING"
    | "SPECIES_SOURCE_MISSING"
    | "BACKGROUND_SOURCE_MISSING"
    | "CHOICE_OPTION_NO_LONGER_OFFERED"
    | "EQUIPMENT_OPTION_NO_LONGER_OFFERED"
    | "ORIGIN_ALLOCATION_NOT_RECOVERED";
  stepId: BuilderStepId;
  /** The stable ID the note concerns. Never private text. */
  recordId?: ID;
}

export interface EditDraftHydration {
  build: CharacterDraftBuild;
  notes: readonly EditDraftRepairNote[];
}

/**
 * A manual sheet is a durable intent, and the committed record does not carry a
 * flag for it. It is recognised by what only a manual sheet has: no class, and
 * hand-entered values or actions. A half-finished automatic build also has no
 * class, but has neither of the other two, so the two do not collide.
 */
function isManualSheet(character: CharacterRecord): boolean {
  if (character.classLevels.length > 0) return false;
  return character.manualActions.length > 0 || Object.keys(character.manualValues).length > 0;
}

/**
 * Every option ID the installed content still offers.
 *
 * Both trees are walked in full — nested `childChoices` and nested equipment
 * bundle groups — because a selection stored against a nested option is exactly
 * as real as one stored against a top-level option, and reporting the deeper one
 * as "no longer offered" purely because the walk stopped early would send the
 * user to repair something that is not broken.
 */
function offeredOptionIds(entries: readonly ContentEntry[]): Set<ID> {
  const offered = new Set<ID>();

  const walkChoices = (choices: readonly ChoiceDefinition[]) => {
    for (const choice of choices) {
      for (const option of choice.options) {
        offered.add(option.id);
        if (option.childChoices) walkChoices(option.childChoices);
      }
      if (choice.childChoices) walkChoices(choice.childChoices);
    }
  };

  const walkBundle = (nodes: readonly EquipmentBundleNode[]) => {
    for (const node of nodes) {
      if (node.type === "bundle") walkBundle(node.entries);
      else if (node.type === "choice")
        for (const option of node.options) {
          offered.add(option.id);
          walkBundle(option.entries);
        }
    }
  };

  for (const entry of entries) {
    walkChoices(entry.choices ?? []);
    for (const bundle of entry.equipmentBundles ?? []) walkBundle(bundle.entries);
  }
  return offered;
}

/**
 * Projects a committed character onto the draft build the builder edits.
 *
 * `entries` is the character's *own* ruleset scope, which is what makes the
 * repair notes honest: a selection is only reported as no longer offered when
 * the content this character is built against stopped offering it.
 */
export function draftBuildFromCharacter(
  character: CharacterRecord,
  entries: readonly ContentEntry[],
): EditDraftHydration {
  const notes: EditDraftRepairNote[] = [];
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const primary = character.classLevels[0];
  const manualSheet = isManualSheet(character);

  const note = (
    code: EditDraftRepairNote["code"],
    stepId: BuilderStepId,
    recordId?: ID,
  ) => notes.push({ code, stepId, ...(recordId ? { recordId } : {}) });

  if (primary?.classId && !byId.has(primary.classId)) note("CLASS_SOURCE_MISSING", "class", primary.classId);
  if (primary?.subclassId && !byId.has(primary.subclassId))
    note("SUBCLASS_SOURCE_MISSING", "class", primary.subclassId);
  if (character.speciesId && !byId.has(character.speciesId))
    note("SPECIES_SOURCE_MISSING", "origin", character.speciesId);
  if (character.backgroundId && !byId.has(character.backgroundId))
    note("BACKGROUND_SOURCE_MISSING", "origin", character.backgroundId);

  const offered = offeredOptionIds(entries);
  for (const [choiceId, optionIds] of Object.entries(character.choiceSelections))
    for (const optionId of optionIds)
      if (!offered.has(optionId)) note("CHOICE_OPTION_NO_LONGER_OFFERED", "class-choices", choiceId);
  for (const [choiceId, optionIds] of Object.entries(character.equipmentSelections))
    for (const optionId of optionIds)
      if (!offered.has(optionId)) note("EQUIPMENT_OPTION_NO_LONGER_OFFERED", "equipment", choiceId);

  /*
   * The base/increase split is recovered against the pattern the *background*
   * declares, read through the same helper the abilities step and the commit
   * path use, so a character cannot be reopened under a different reading of
   * its own origin than the one that committed it.
   */
  const allocation = recoverAbilityAllocation({
    finals: character.abilityScores,
    pattern: originIncreasePatternFor({ backgroundId: character.backgroundId }, entries),
    standardArray: standardArrayFor(entries),
    abilityMethod: character.abilityMethod,
  });
  if (!allocation.recovered) note("ORIGIN_ALLOCATION_NOT_RECOVERED", "abilities");

  const build: CharacterDraftBuild = {
    ...EMPTY_DRAFT_BUILD,
    name: character.name,
    manualSheet,
    ...(character.nickname ? { nickname: character.nickname } : {}),
    // Carried, not collected: the creation flow no longer offers pronouns, and
    // an edit must not be the thing that finally deletes them.
    ...(character.pronouns ? { pronouns: character.pronouns } : {}),
    level: character.level,
    ...(primary?.classId ? { classId: primary.classId } : {}),
    ...(primary?.subclassId ? { subclassId: primary.subclassId } : {}),
    ...(character.speciesId ? { speciesId: character.speciesId } : {}),
    ...(character.backgroundId ? { backgroundId: character.backgroundId } : {}),
    abilityMethod: character.abilityMethod,
    abilityScores: { ...character.abilityScores },
    abilityBaseScores: { ...allocation.base },
    abilityIncreases: { ...allocation.increases },
    choiceSelections: Object.fromEntries(
      Object.entries(character.choiceSelections).map(([choiceId, optionIds]) => [choiceId, [...optionIds]]),
    ),
    equipmentSelections: Object.fromEntries(
      Object.entries(character.equipmentSelections).map(([choiceId, optionIds]) => [choiceId, [...optionIds]]),
    ),
    manualValues: { ...character.manualValues },
    manualActions: character.manualActions.map(action => ({ ...action })),
    acknowledgedIssueCodes: [...character.acknowledgedIssueCodes],
  };

  return { build, notes };
}
