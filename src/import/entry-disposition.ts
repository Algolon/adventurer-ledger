import type { ContentEntry } from "@/src/domain/model";
import { canonicalJson } from "@/src/services/canonical";

/**
 * How one incoming entry relates to what is already installed.
 *
 * A pack version is a statement about the pack, not about every record in it.
 * A newer version legitimately carries mostly untouched entries, so "already
 * installed at this revision, byte-for-byte" is the normal case for an additive
 * update and must not be reported as a conflict. Reusing a revision for
 * *different* content still is one: the revision is how a pack says a record
 * changed, so changing content without changing it leaves installations unable
 * to tell the two apart.
 */
export type EntryDisposition =
  | "add"
  | "update"
  | "unchanged"
  | "revision-reuse"
  | "downgrade";

/**
 * Fields the installation owns rather than the pack. They are audit state
 * stamped at write time, so they say nothing about whether a pack changed a
 * record and are excluded from the comparison. Everything else the document
 * carries -- mechanics, effects, choices, links, aliases, conflict metadata,
 * equipment bundles, visibility, source and summaries -- is compared.
 */
const INSTALL_MANAGED_FIELDS = ["createdAt", "updatedAt"] as const;

/**
 * Canonical form of the pack-owned payload.
 *
 * Array order is preserved throughout: no entry array is declared order-insensitive
 * by the domain, and treating a reordered list as unchanged would let a real content
 * change import silently under a reused revision. Preferring a false conflict over a
 * false no-op keeps the safe failure on the side that refuses.
 */
export function entryPayload(entry: ContentEntry): string {
  const payload: Record<string, unknown> = { ...entry };
  for (const field of INSTALL_MANAGED_FIELDS) delete payload[field];
  return canonicalJson(payload);
}

/** True when a pack restates a record exactly as installed. */
export function isSemanticallyIdentical(
  incoming: ContentEntry,
  installed: ContentEntry,
): boolean {
  return entryPayload(incoming) === entryPayload(installed);
}

/**
 * The single classification used by preview and by the write path, so what a
 * preview promises and what confirmation performs cannot drift apart.
 */
export function classifyEntry(
  incoming: ContentEntry,
  installed: ContentEntry | undefined,
): EntryDisposition {
  if (!installed) return "add";
  if (incoming.revision > installed.revision) return "update";
  if (incoming.revision < installed.revision) return "downgrade";
  return isSemanticallyIdentical(incoming, installed) ? "unchanged" : "revision-reuse";
}
