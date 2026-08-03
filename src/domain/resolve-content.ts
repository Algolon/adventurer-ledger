import type { ContentEntry, ContentLink } from "@/src/domain/model";

export interface ResolvedContentLink { fromId: string; link: ContentLink; target?: ContentEntry }
export interface RelationResolution {
  links: ResolvedContentLink[];
  missingRequired: ResolvedContentLink[];
  conflicts: Array<{ key: string; winner: ContentEntry; alternatives: ContentEntry[] }>;
}

/** Pure, deterministic resolution; imported text is never copied into diagnostics. */
export function resolveContentRelations(entries: readonly ContentEntry[]): RelationResolution {
  const byId = new Map(entries.map(entry => [entry.id, entry])), links: ResolvedContentLink[] = [], missingRequired: ResolvedContentLink[] = [];
  for (const entry of entries) for (const link of entry.links) {
    const resolved = { fromId: entry.id, link, target: byId.get(link.targetId) };
    links.push(resolved);
    if (link.required && !resolved.target) missingRequired.push(resolved);
  }
  const groups = new Map<string, ContentEntry[]>();
  for (const entry of entries) if (entry.conflict.conflictKey) {
    const group = groups.get(entry.conflict.conflictKey) ?? [];
    group.push(entry); groups.set(entry.conflict.conflictKey, group);
  }
  const conflicts = [...groups].filter(([, group]) => group.length > 1).map(([key, group]) => {
    const ranked = [...group].sort((left, right) => right.conflict.sourcePriority - left.conflict.sourcePriority || right.revision - left.revision || left.id.localeCompare(right.id));
    const winner = ranked[0];
    if (!winner) throw new Error(`Conflict group ${key} has no entries`);
    return { key, winner, alternatives: ranked.slice(1) };
  }).sort((left, right) => left.key.localeCompare(right.key));
  return { links, missingRequired, conflicts };
}
