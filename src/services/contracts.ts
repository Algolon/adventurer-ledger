/**
 * Shared M2.1 service contracts.
 *
 * Every mutation command carries a stable target ID, an immutable payload, an
 * `expectedRevision` (or an explicit must-not-exist precondition), a
 * caller-generated operation ID for retry idempotency where appropriate, and an
 * ISO timestamp from an injectable clock.
 *
 * Stale state is a typed outcome, not an exception string: a stale command
 * performs no writes and returns `{ status: "stale" }` so the caller can show a
 * fresh preview instead of retrying blindly against a different revision.
 */
import type { ID, ISODate } from "@/src/domain/model";

/** Injectable clock so results stay deterministic under test. */
export type Clock = () => ISODate;

export const systemClock: Clock = () => new Date().toISOString();

/** Sanitized issue: a code plus a non-sensitive path or stable ID, never a value. */
export interface ServiceIssue {
  code: string;
  fieldPath?: string;
  recordId?: ID;
  severity?: "error" | "warning";
}

export type ServiceOutcome<T> =
  | { status: "ok"; result: T }
  | { status: "stale"; recordId: ID; expectedRevision: number; actualRevision: number | null }
  | { status: "not-found"; recordId: ID }
  | { status: "invalid"; issues: readonly ServiceIssue[] }
  | { status: "conflict"; code: string; recordId: ID };

export const ok = <T>(result: T): ServiceOutcome<T> => ({ status: "ok", result });
export const stale = <T>(recordId: ID, expectedRevision: number, actualRevision: number | null): ServiceOutcome<T> => ({
  status: "stale",
  recordId,
  expectedRevision,
  actualRevision,
});
export const notFound = <T>(recordId: ID): ServiceOutcome<T> => ({ status: "not-found", recordId });
export const invalid = <T>(issues: readonly ServiceIssue[]): ServiceOutcome<T> => ({ status: "invalid", issues });

/** Base shape every mutation command shares. */
export interface MutationCommand {
  readonly operationId: ID;
}

export interface RevisionPrecondition {
  readonly expectedRevision: number;
}

/**
 * Operational log line. It may carry operation codes, stable IDs, revisions,
 * counts, fingerprints and durations — never a name, biography, note, manual
 * value, imported payload or content text.
 */
export interface ServiceLogLine {
  operation: string;
  recordId?: ID;
  expectedRevision?: number;
  actualRevision?: number | null;
  issueCodes?: readonly string[];
  counts?: Readonly<Record<string, number>>;
  fingerprint?: string;
}

export type ServiceLogger = (line: ServiceLogLine) => void;

export const noopLogger: ServiceLogger = () => {};
