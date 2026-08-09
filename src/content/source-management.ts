/**
 * Saving and removing a local source, said in terms a user can act on.
 *
 * The Sources panel had one failure sentence for every way a save could go
 * wrong. The pilot met it on "Save source" and could not tell whether the ID was
 * malformed, already taken, the version unacceptable, or the write itself
 * broken — and the most likely cause, by some distance, is the one the panel was
 * worst at: the form reopens holding the same default ID it just saved, so the
 * next press is a duplicate-ID collision that reads as an unexplained failure.
 *
 * Two jobs live here, both pure:
 *
 * 1. check the form *before* the write, so a fixable mistake is named against
 *    its own field rather than surfacing as a persistence failure; and
 * 2. turn a repository refusal into a specific, safe sentence.
 *
 * Nothing here relaxes an invariant. A duplicate ID is still refused; it is
 * merely refused out loud.
 */
import { isContentOperationError, type ContentOperationCode } from "@/src/storage/content-operation-error";

export interface SourceFormValues {
  readonly id: string;
  readonly name: string;
  readonly abbreviation: string;
  readonly version: string;
}

/** Which control a failure belongs to, so the message can be tied to it. */
export type SourceField = "id" | "name" | "abbreviation" | "version";

export type SourceSaveReason =
  | "invalid-id"
  | "duplicate-id"
  | "unknown-source"
  | "invalid-version"
  | "missing-field"
  | "source-referenced"
  | "persistence";

export interface SourceSaveProblem {
  readonly reason: SourceSaveReason;
  /** The control to associate the message with, when one control owns it. */
  readonly field?: SourceField;
  readonly message: string;
}

export type SourceFormCheck = { readonly ok: true } | { readonly ok: false; readonly problem: SourceSaveProblem };

/**
 * Source IDs are namespaced and machine-stable, and the rest of the app matches
 * on them exactly. Accepting free text here produces a record nothing can find
 * later, so the shape is enforced at the boundary the user types into.
 */
const SOURCE_ID = /^source:[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Three dotted numbers, optionally with a suffix, as packs already require. */
const SOURCE_VERSION = /^\d+\.\d+\.\d+.*$/;

const accepted: SourceFormCheck = { ok: true };
const refuse = (reason: SourceSaveReason, message: string, field?: SourceField): SourceFormCheck => ({
  ok: false,
  problem: field === undefined ? { reason, message } : { reason, field, message },
});

/**
 * Checks a source form against the rules the write will enforce anyway.
 *
 * `existingIds` is the installed set, so a create that would collide is reported
 * as a collision here, against the ID field, rather than as a failed write.
 */
export function validateSourceForm(
  values: SourceFormValues,
  context: { readonly mode: "create" | "edit"; readonly existingIds: readonly string[] },
): SourceFormCheck {
  if (!values.name.trim()) return refuse("missing-field", "Give this source a name before saving.", "name");
  if (!values.abbreviation.trim())
    return refuse("missing-field", "Give this source a short abbreviation before saving.", "abbreviation");
  if (!values.version.trim()) return refuse("missing-field", "Give this source a version before saving.", "version");
  if (!SOURCE_VERSION.test(values.version.trim()))
    return refuse(
      "invalid-version",
      `Version must be three numbers separated by dots, such as 1.0.0. “${values.version.trim()}” is not.`,
      "version",
    );

  if (context.mode === "edit") {
    if (!context.existingIds.includes(values.id))
      return refuse(
        "unknown-source",
        `The source ${values.id} is no longer on this device, so there is nothing to update. Save it as a new source instead.`,
        "id",
      );
    return accepted;
  }

  if (!values.id.trim()) return refuse("missing-field", "Give this source a stable ID before saving.", "id");
  if (!SOURCE_ID.test(values.id.trim()))
    return refuse(
      "invalid-id",
      "A source ID looks like source:my-source — the prefix source:, then lower-case words joined by hyphens.",
      "id",
    );
  if (context.existingIds.includes(values.id.trim()))
    return refuse(
      "duplicate-id",
      `${values.id.trim()} is already on this device. Edit that source instead, or choose a different ID.`,
      "id",
    );
  return accepted;
}

const REPOSITORY_MESSAGES: Partial<
  Record<ContentOperationCode, (recordId: string, referencingEntryCount?: number) => SourceSaveProblem>
> = {
  SOURCE_ALREADY_EXISTS: recordId => ({
    reason: "duplicate-id",
    field: "id",
    message: `${recordId} is already on this device. Edit that source instead, or choose a different ID.`,
  }),
  SOURCE_NOT_FOUND: recordId => ({
    reason: "unknown-source",
    field: "id",
    message: `The source ${recordId} is no longer on this device, so there is nothing to update.`,
  }),
  SOURCE_REFERENCED: (recordId, count) => ({
    reason: "source-referenced",
    message:
      count === undefined
        ? `${recordId} is still named by installed entries, so it cannot be removed yet.`
        : `${recordId} is still named by ${count === 1 ? "1 installed entry" : `${count} installed entries`}, so it cannot be removed yet.`,
  }),
};

/**
 * The most specific safe sentence available for a failed save.
 *
 * An unrecognised failure falls back to a persistence message that says what is
 * true — the write did not happen and nothing changed — rather than inviting the
 * user to hunt through fields that are all correct.
 */
export function describeSourceSaveFailure(error: unknown): SourceSaveProblem {
  if (isContentOperationError(error)) {
    const build = REPOSITORY_MESSAGES[error.code];
    if (build) return build(error.recordId, error.referencingEntryCount);
  }
  return {
    reason: "persistence",
    message: "This source could not be written to local storage. Nothing was changed; try again.",
  };
}

/**
 * What removing a source would do, before it is done.
 *
 * "Cannot remove" and "can remove, and here is what goes with it" are different
 * answers and the panel has to be able to tell them apart: a source other
 * entries still name is load-bearing, and deleting it would leave those entries
 * pointing at nothing.
 */
export type SourceRemoval =
  | {
      readonly kind: "blocked";
      readonly referencingEntryCount: number;
      readonly title: string;
      readonly explanation: string;
    }
  | { readonly kind: "removable"; readonly title: string; readonly explanation: string };

export function describeSourceRemoval(input: {
  readonly sourceName: string;
  readonly sourceId: string;
  readonly referencingEntryCount: number;
}): SourceRemoval {
  if (input.referencingEntryCount > 0)
    return {
      kind: "blocked",
      referencingEntryCount: input.referencingEntryCount,
      title: `${input.sourceName} cannot be removed yet`,
      explanation:
        input.referencingEntryCount === 1
          ? "1 installed entry still names this source. Remove the pack that owns it first; the source can go once nothing points at it."
          : `${input.referencingEntryCount} installed entries still name this source. Remove the packs that own them first; the source can go once nothing points at it.`,
    };
  return {
    kind: "removable",
    title: `Remove ${input.sourceName}?`,
    explanation:
      "No installed entry names this source, so removing it affects nothing else. This deletes the source record from this device and cannot be undone.",
  };
}

/** What removing a content pack takes with it, before it is confirmed. */
export function describePackRemoval(input: {
  readonly packName: string;
  readonly entryCount: number;
}): { readonly title: string; readonly explanation: string } {
  return {
    title: `Remove ${input.packName}?`,
    explanation:
      `This removes the pack record and its ${input.entryCount === 1 ? "1 entry" : `${input.entryCount} entries`} from the ` +
      "installed list, and any ruleset built from it stops offering that content. A copy is kept in local pack history; " +
      "the entries themselves stay in the compendium until a later import replaces them.",
  };
}
