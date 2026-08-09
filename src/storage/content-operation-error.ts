/**
 * Why a source, pack or entry operation was refused, as a value rather than prose.
 *
 * The repositories always knew: "Source X is still referenced", "Source X
 * already exists". None of it reached the user. Every content-workspace catch
 * funnelled into one string — "The operation could not be completed. Check IDs,
 * versions, and required fields." — which is the same sentence for a duplicate
 * ID, a source other entries depend on, and a genuine write failure. The pilot
 * hit it on Save source and had no way forward.
 *
 * A code and a record ID are enough for the UI to say something specific and
 * actionable. They are also safe to show: a stable ID and a field path are
 * explicitly permitted diagnostics, whereas the record's own content is not, and
 * nothing here carries content. `referencingEntryCount` is a count of records,
 * not a record.
 */
export type ContentOperationCode =
  | "SOURCE_ALREADY_EXISTS"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_REFERENCED"
  | "PACK_ALREADY_EXISTS"
  | "PACK_NOT_FOUND"
  | "ENTRY_ALREADY_EXISTS"
  | "ENTRY_NOT_FOUND";

export class ContentOperationError extends Error {
  readonly code: ContentOperationCode;
  readonly recordId: string;
  /** For `SOURCE_REFERENCED`: how many installed entries still name this source. */
  readonly referencingEntryCount?: number;

  constructor(
    code: ContentOperationCode,
    recordId: string,
    message: string,
    detail: { readonly referencingEntryCount?: number } = {},
  ) {
    super(message);
    this.name = "ContentOperationError";
    this.code = code;
    this.recordId = recordId;
    if (detail.referencingEntryCount !== undefined) this.referencingEntryCount = detail.referencingEntryCount;
  }
}

export const isContentOperationError = (error: unknown): error is ContentOperationError =>
  error instanceof ContentOperationError;
