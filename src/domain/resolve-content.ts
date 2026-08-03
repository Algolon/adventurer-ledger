import type { ContentEntry, ContentLink } from "@/src/domain/model";

export interface ResolvedContentLink { fromId: string; link: ContentLink; target?: ContentEntry }
export interface RelationResolution {
  links: ResolvedContentLink[];
  missingRequired: ResolvedContentLink[];
  conflicts: Array<{ key: string; winner: ContentEntry; alternatives: ContentEntry[]; resolution: ContentEntry["conflict"]["resolution"] }>;
  coexistingGroups: Array<{ key: string; entries: ContentEntry[] }>;
  unresolvedConflicts: Array<{ key: string; entryIds: string[]; reason: "explicit-selection-required" | "policy-mismatch" | "selection-invalid" }>;
}

/** Pure, deterministic resolution; imported text is never copied into diagnostics. */
export function resolveContentRelations(entries: readonly ContentEntry[], explicitSelections: Readonly<Record<string, string>> = {}): RelationResolution {
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
  const conflicts: RelationResolution["conflicts"] = [], coexistingGroups: RelationResolution["coexistingGroups"] = [], unresolvedConflicts: RelationResolution["unresolvedConflicts"] = [];
  for (const [key, group] of [...groups].filter(([, items]) => items.length > 1).sort(([left], [right]) => left.localeCompare(right))) {
    const policies = new Set(group.map(entry => entry.conflict.resolution));
    if (policies.size !== 1) {
      unresolvedConflicts.push({ key, entryIds: group.map(entry => entry.id).sort(), reason: "policy-mismatch" });
      continue;
    }
    const resolution = group[0]?.conflict.resolution;
    if (!resolution) continue;
    let ranked: ContentEntry[];
    if (resolution === "newest-revision") ranked = [...group].sort((left, right) => right.revision - left.revision || right.conflict.sourcePriority - left.conflict.sourcePriority || left.id.localeCompare(right.id));
    else ranked = [...group].sort((left, right) => right.conflict.sourcePriority - left.conflict.sourcePriority || right.revision - left.revision || left.id.localeCompare(right.id));
    if (resolution === "explicit-selection") {
      const selectedId = explicitSelections[key];
      if (!selectedId) {
        unresolvedConflicts.push({ key, entryIds: ranked.map(entry => entry.id), reason: "explicit-selection-required" });
        continue;
      }
      const selected = group.find(entry => entry.id === selectedId);
      if (!selected) {
        unresolvedConflicts.push({ key, entryIds: ranked.map(entry => entry.id), reason: "selection-invalid" });
        continue;
      }
      conflicts.push({ key, winner: selected, alternatives: ranked.filter(entry => entry.id !== selected.id), resolution });
      continue;
    }
    if (resolution === "coexist") {
      coexistingGroups.push({ key, entries: ranked });
      continue;
    }
    const winner = ranked[0];
    if (winner) conflicts.push({ key, winner, alternatives: ranked.slice(1), resolution });
  }
  return { links, missingRequired, conflicts, coexistingGroups, unresolvedConflicts };
}
