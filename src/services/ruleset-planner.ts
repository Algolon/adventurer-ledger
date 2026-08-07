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
import { rulesetPrivacyFor, scopeEntriesToRuleset, type RulesetPrivacy } from "@/src/services/content-scope";

/** Categories a pack must supply before it can drive creation on its own. */
export const CREATION_CATEGORIES: readonly Category[] = ["class", "species", "background"];
/** Any one of these satisfies the origin requirement. */
const ORIGIN_CATEGORIES: readonly Category[] = ["species", "race", "lineage"];

export interface RulesetProposal {
  rulesetId: ID;
  /** Profile IDs an earlier derivation would have used, for compatibility. */
  compatibilityRulesetIds: readonly ID[];
  name: string;
  packId: ID;
  activeSourceIds: readonly ID[];
  /**
   * The bounded, explicit set of entries this profile activates.
   *
   * Taken from the pack itself rather than inferred from its sources, so
   * importing a pack cannot activate an unrelated entry that happens to share a
   * source ID. Dependencies join the set only through the typed mechanism
   * below, never by widening the source filter.
   */
  activeEntryIds: readonly ID[];
  /** Dependency pack IDs whose entries were included, if any. */
  includedDependencyPackIds: readonly ID[];
  /** Declared dependencies that were not available to include. */
  missingDependencyPackIds: readonly ID[];
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
 *
 * It keeps the pack's *complete* identity. An earlier version stripped a leading
 * `pack:`, which made `pack:x` and `x` collide on one profile ID — two different
 * packs mapping to one profile, where the second import would either be refused
 * as a duplicate of a pack it has nothing to do with, or overwrite the profile
 * an existing character is resolved against. Prefixing without stripping is
 * injective: distinct pack IDs always produce distinct profile IDs, including
 * for prefix-related and visually similar IDs.
 */
export function rulesetIdForPack(packId: ID): ID {
  return `ruleset:${packId}`;
}

/**
 * Profile IDs an earlier derivation would have produced for this pack.
 *
 * Existing profiles are **not** migrated. Rewriting a profile ID would break
 * every committed character that references it, which is a strictly larger
 * compatibility risk than the collision itself. Instead the install boundary
 * checks these as well, so a pack whose profile was created under the old
 * derivation is recognised as already installed rather than silently duplicated
 * under the new one. `docs/product/M2.1A_DEFERRED_DESIGN_NOTES.md` records the
 * decision.
 */
export function legacyRulesetIdsForPack(packId: ID): ID[] {
  if (!packId.startsWith("pack:")) return [];
  const stripped = `ruleset:${packId.slice("pack:".length)}`;
  return stripped === rulesetIdForPack(packId) ? [] : [stripped];
}

/** Every profile ID this pack may already be installed under, newest first. */
export function rulesetIdCandidatesForPack(packId: ID): ID[] {
  return [...new Set([rulesetIdForPack(packId), ...legacyRulesetIdsForPack(packId)])];
}

/**
 * One declared dependency, resolved to the entries it would contribute.
 *
 * The only route by which content outside the imported pack joins its profile.
 * It is typed and explicit: the caller has to supply the dependency's entries,
 * so nothing is pulled in because it merely shares a source ID.
 */
export interface ResolvedDependency {
  packId: ID;
  entries: readonly ContentEntry[];
}

export function proposeRulesetForPack(
  pack: Pick<ContentPack, "id" | "name" | "sourceIds"> & { dependencies?: readonly ID[] },
  packEntries: readonly ContentEntry[],
  dependencies: readonly ResolvedDependency[] = [],
): RulesetProposal {
  const declared = pack.dependencies ?? [];
  const supplied = new Map(dependencies.map(item => [item.packId, item]));
  const includedDependencyPackIds = declared.filter(packId => supplied.has(packId));
  const missingDependencyPackIds = declared.filter(packId => !supplied.has(packId));
  const dependencyEntries = includedDependencyPackIds.flatMap(packId => supplied.get(packId)?.entries ?? []);

  const members = [...packEntries, ...dependencyEntries];
  const presentCategories = [...new Set(members.map(entry => entry.category))].sort();
  const present = new Set(presentCategories);
  const missingCategories = CREATION_CATEGORIES.filter(category =>
    category === "species" ? !ORIGIN_CATEGORIES.some(origin => present.has(origin)) : !present.has(category),
  );
  // Sources are still recorded, because a profile is readable without the entry
  // set and because export and diagnostics reason about sources. They no longer
  // decide membership: `activeEntryIds` does.
  const activeSourceIds = [...new Set([...pack.sourceIds, ...members.map(entry => entry.sourceId)])].sort();
  const activeEntryIds = [...new Set(members.map(entry => entry.id))].sort();
  return {
    rulesetId: rulesetIdForPack(pack.id),
    compatibilityRulesetIds: legacyRulesetIdsForPack(pack.id),
    name: pack.name,
    packId: pack.id,
    activeSourceIds,
    activeEntryIds,
    includedDependencyPackIds,
    missingDependencyPackIds,
    // Exactly the categories present: scoping stays tight without inventing one.
    allowedCategories: presentCategories,
    presentCategories,
    missingCategories,
    usable: missingCategories.length === 0,
    maxSupportedLevel: maxSupportedLevel(members),
    entryCount: activeEntryIds.length,
  };
}

/** The profile a proposal would write. Pure; the service performs the write. */
export function rulesetProfileFrom(proposal: RulesetProposal, now: string): RulesetProfile {
  return {
    id: proposal.rulesetId,
    name: proposal.name,
    activeSourceIds: [...proposal.activeSourceIds],
    // The explicit membership set. Written here so the profile the preview
    // described and the profile that is stored cannot describe different content.
    allowedEntryIds: [...proposal.activeEntryIds],
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

/**
 * What an installed pack's existing profile should hold today.
 *
 * A profile's membership is written once, at install. An update to the same pack
 * used to leave it exactly as it was, so a pack that grew from 3 entries to 5
 * kept a profile scoped to the original 3: the new entries were installed and
 * unreachable, and every character resolved against that profile still saw the
 * old content. This expresses the correction as a value, so the same rule
 * applies whether it runs inside an import transaction or as a later repair.
 *
 * `undefined` means the profile is not one this derivation owns the membership
 * of: a profile with no explicit `allowedEntryIds` is scoped by source and
 * already sees a pack's new entries, and rewriting it to an explicit set would
 * *narrow* it rather than repair it.
 */
export interface RulesetMembershipUpdate {
  /** The profile as it should now read. Identical to the input when unchanged. */
  profile: RulesetProfile;
  changed: boolean;
  addedEntryIds: readonly ID[];
  removedEntryIds: readonly ID[];
}

/** Order-insensitive comparison of two already-sorted ID lists. */
const sameIds = (left: readonly ID[], right: readonly ID[]) =>
  left.length === right.length && left.every((id, index) => id === right[index]);

/**
 * Advances an existing profile's pack-owned membership to the proposal.
 *
 * Everything that makes the profile *that* profile is kept: its ID, its name,
 * `createdAt`, every policy field, and any `disallowedEntryIds` a user chose.
 * Only the three derived fields the pack owns — its entry membership, the
 * sources that membership spans and the categories it covers — are replaced,
 * and `updatedAt` moves only when one of them genuinely differs. Membership is
 * taken from the proposal alone, so nothing joins by sharing a source ID and
 * nothing is matched by name.
 */
export function reconcileRulesetMembership(
  existing: RulesetProfile,
  proposal: RulesetProposal,
  now: string,
): RulesetMembershipUpdate | undefined {
  if (!existing.allowedEntryIds?.length) return undefined;
  const entryIds = [...proposal.activeEntryIds];
  const sourceIds = [...proposal.activeSourceIds];
  const categories = [...proposal.allowedCategories];
  const currentEntryIds = [...existing.allowedEntryIds].sort();
  const next = new Set(entryIds);
  const current = new Set(currentEntryIds);
  const addedEntryIds = entryIds.filter(id => !current.has(id));
  const removedEntryIds = currentEntryIds.filter(id => !next.has(id));
  const changed =
    addedEntryIds.length > 0 ||
    removedEntryIds.length > 0 ||
    !sameIds([...existing.activeSourceIds].sort(), sourceIds) ||
    !sameIds([...existing.allowedCategories].sort(), categories);
  return {
    profile: changed
      ? {
          ...existing,
          activeSourceIds: sourceIds,
          allowedEntryIds: entryIds,
          allowedCategories: categories,
          updatedAt: now,
        }
      : existing,
    changed,
    addedEntryIds,
    removedEntryIds,
  };
}

/**
 * The profile IDs each installed pack unambiguously owns.
 *
 * A pack maps to its current profile ID and, for compatibility, to the ID an
 * earlier derivation produced. That earlier derivation was not injective: it
 * stripped a `pack:` prefix, so `pack:x` and `x` collapsed onto one profile ID.
 * A profile claimed by two installed packs therefore cannot be attributed to
 * either, and repairing its membership from one of them could rewrite the
 * profile a character built from the other resolves against. Those are left
 * alone; only a profile ID exactly one installed pack can claim is owned.
 */
export function rulesetProfileOwnership(packIds: readonly ID[]): Map<ID, ID> {
  const claims = new Map<ID, Set<ID>>();
  for (const packId of packIds)
    for (const profileId of rulesetIdCandidatesForPack(packId)) {
      const owners = claims.get(profileId) ?? new Set<ID>();
      owners.add(packId);
      claims.set(profileId, owners);
    }
  const owned = new Map<ID, ID>();
  for (const [profileId, owners] of claims) {
    if (owners.size !== 1) continue;
    for (const packId of owners) owned.set(profileId, packId);
  }
  return owned;
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
  /**
   * Whether the content this profile reaches is public, restricted or mixed.
   * A classification derived from record metadata; it quotes nothing.
   */
  privacy: RulesetPrivacy;
}

/**
 * Installed profiles with the content each one reaches.
 *
 * Sorted by name then ID purely so the list renders stably. The order is
 * presentation only: nothing selects a ruleset from it, because picking the
 * first row would make an arbitrary alphabetical accident decide which content a
 * character is built against. Privacy is reported and never ranked on, so no
 * ordering here can quietly prefer a profile that reaches private content.
 */
export function describeInstalledRulesets(
  profiles: readonly RulesetProfile[],
  entries: readonly ContentEntry[],
): InstalledRulesetView[] {
  return profiles
    .map(profile => {
      // The same scoping the builder and the resolver use, so the count a user
      // reads is the content they would actually get.
      const scoped = scopeEntriesToRuleset(entries, profile);
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
        privacy: rulesetPrivacyFor(scoped),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}
