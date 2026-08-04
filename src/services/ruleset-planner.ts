/**
 * Turning an installed pack into a usable local ruleset profile.
 *
 * Importing content used to leave it unreachable: entries were written, no
 * ruleset profile existed to activate their source, and every builder read is
 * scoped to a ruleset. This module decides, from the content alone, whether a
 * pack can stand as a ruleset and what profile would express it. It names no
 * pack, source or entry: the profile's active sources and allowed categories are
 * read off the entries the pack actually ships.
 */
import type { Category, ContentEntry, ContentPack, ID, RulesetProfile } from "@/src/domain/model";
import { maxSupportedLevel } from "@/src/services/choice-planner";

/** Categories a pack must supply before it can drive creation on its own. */
export const CREATION_CATEGORIES: readonly Category[] = ["class", "species", "background"];
/** Any one of these satisfies the origin requirement. */
const ORIGIN_CATEGORIES: readonly Category[] = ["species", "race", "lineage"];

export interface RulesetProposal {
  rulesetId: ID;
  name: string;
  packId: ID;
  activeSourceIds: readonly ID[];
  allowedCategories: readonly Category[];
  /** Categories the pack actually ships, deterministic order. */
  presentCategories: readonly Category[];
  /** Creation-critical categories the pack does not ship. */
  missingCategories: readonly Category[];
  /** True when the pack supplies a class, an origin and a background. */
  usable: boolean;
  /** Highest starting level the pack's class progressions honestly cover. */
  maxSupportedLevel: number;
  entryCount: number;
}

/**
 * The profile ID a pack maps to.
 *
 * Deterministic, so re-previewing the same pack proposes the same profile and a
 * second import cannot quietly create a duplicate under a new ID.
 */
export function rulesetIdForPack(packId: ID): ID {
  const stem = packId.startsWith("pack:") ? packId.slice("pack:".length) : packId;
  return `ruleset:${stem}`;
}

export function proposeRulesetForPack(
  pack: Pick<ContentPack, "id" | "name" | "sourceIds">,
  packEntries: readonly ContentEntry[],
): RulesetProposal {
  const presentCategories = [...new Set(packEntries.map(entry => entry.category))].sort();
  const present = new Set(presentCategories);
  const missingCategories = CREATION_CATEGORIES.filter(category =>
    category === "species" ? !ORIGIN_CATEGORIES.some(origin => present.has(origin)) : !present.has(category),
  );
  // Sources come from the entries themselves as well as the pack's declaration,
  // so a pack whose entries sit on a shared source still activates that source.
  const activeSourceIds = [...new Set([...pack.sourceIds, ...packEntries.map(entry => entry.sourceId)])].sort();
  return {
    rulesetId: rulesetIdForPack(pack.id),
    name: pack.name,
    packId: pack.id,
    activeSourceIds,
    // Exactly the categories present: scoping stays tight without inventing one.
    allowedCategories: presentCategories,
    presentCategories,
    missingCategories,
    usable: missingCategories.length === 0,
    maxSupportedLevel: maxSupportedLevel(packEntries),
    entryCount: packEntries.length,
  };
}

/** The profile a proposal would write. Pure; the service performs the write. */
export function rulesetProfileFrom(proposal: RulesetProposal, now: string): RulesetProfile {
  return {
    id: proposal.rulesetId,
    name: proposal.name,
    activeSourceIds: [...proposal.activeSourceIds],
    editionPriority: [],
    allowedCategories: [...proposal.allowedCategories],
    allowLegacy: false,
    allowDuplicateVersions: false,
    conflictResolution: "source-priority",
    allowCustomOverrides: true,
    requirementEnforcement: "soft",
    createdAt: now,
    updatedAt: now,
  };
}

export interface InstalledRulesetView {
  id: ID;
  name: string;
  activeSourceIds: readonly ID[];
  /** Entries this profile actually activates. Zero means it can build nothing. */
  entryCount: number;
  /** Highest starting level the activated class progressions cover. */
  maxSupportedLevel: number;
  usable: boolean;
  missingCategories: readonly Category[];
}

/**
 * Installed profiles with the content each one reaches.
 *
 * Sorted by name then ID purely so the list renders stably. The order is
 * presentation only: nothing selects a ruleset from it, because picking the
 * first row would make an arbitrary alphabetical accident decide which content a
 * character is built against.
 */
export function describeInstalledRulesets(
  profiles: readonly RulesetProfile[],
  entries: readonly ContentEntry[],
): InstalledRulesetView[] {
  return profiles
    .map(profile => {
      const sources = new Set(profile.activeSourceIds);
      const allowed = profile.allowedCategories.length ? new Set(profile.allowedCategories) : undefined;
      const scoped = entries.filter(
        entry => sources.has(entry.sourceId) && (!allowed || allowed.has(entry.category)),
      );
      const present = new Set(scoped.map(entry => entry.category));
      const missingCategories = CREATION_CATEGORIES.filter(category =>
        category === "species" ? !ORIGIN_CATEGORIES.some(origin => present.has(origin)) : !present.has(category),
      );
      return {
        id: profile.id,
        name: profile.name,
        activeSourceIds: [...profile.activeSourceIds],
        entryCount: scoped.length,
        maxSupportedLevel: maxSupportedLevel(scoped),
        usable: missingCategories.length === 0,
        missingCategories,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
