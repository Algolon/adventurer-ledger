/**
 * Ruleset profile selection and creation.
 *
 * Importing a pack installed content but never produced a usable ruleset
 * profile, and the builder took `installed[0]` — whichever profile happened to
 * sort first. That is not a choice, it is an accident: installing a pack whose
 * ID sorted earlier silently changed which rules every new character was built
 * against, and a private import could become the default without the user ever
 * selecting it.
 *
 * This module makes the boundary explicit. Selection is a decision the user
 * makes and the draft records; a profile is only offered when it can actually
 * build a character, and nothing is ever chosen by sort order.
 */
import type { ContentEntry, ID, RulesetProfile, Source } from "@/src/domain/model";
import { scopeEntriesToRuleset } from "@/src/services/content-scope";
import { invalid, ok, type ServiceOutcome } from "@/src/services/contracts";

/** A profile offered in the builder, with what the user needs to tell them apart. */
export interface SelectableRuleset {
  id: ID;
  name: string;
  /** Classes the profile can actually build with. Zero means it cannot. */
  classCount: number;
  /** True when every active source is public-original. */
  publicOnly: boolean;
  /** False when the profile resolves no class, so it cannot start a character. */
  usable: boolean;
}

/**
 * Installed profiles, ordered by usefulness rather than by ID.
 *
 * Usable public profiles come first, then usable profiles that include private
 * sources, then unusable ones. Ties keep their existing relative order, so the
 * result is deterministic without ever being decided by a sort key the user
 * cannot see.
 */
export function selectableRulesets(
  profiles: readonly RulesetProfile[],
  entries: readonly ContentEntry[],
  sources: readonly Source[],
): SelectableRuleset[] {
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const described = profiles.map((profile, index) => {
    const scoped = scopeEntriesToRuleset(entries, profile);
    const classCount = scoped.filter(entry => entry.category === "class").length;
    const publicOnly = profile.activeSourceIds.every(id => {
      const source = sourceById.get(id);
      return !source || source.visibility !== "private";
    });
    return {
      id: profile.id,
      name: profile.name,
      classCount,
      publicOnly,
      usable: classCount > 0,
      index,
    };
  });

  return described
    .slice()
    .sort((left, right) => {
      if (left.usable !== right.usable) return left.usable ? -1 : 1;
      if (left.publicOnly !== right.publicOnly) return left.publicOnly ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ index: _index, ...rest }) => rest);
}

/**
 * The profile a new draft should start on when the user has not chosen one.
 *
 * Returns `undefined` rather than guessing when the decision is genuinely
 * ambiguous — more than one usable profile with nothing to separate them — so
 * the caller asks instead of picking. A newly imported pack therefore never
 * becomes the default simply by existing.
 */
export function defaultRulesetFor(
  selectable: readonly SelectableRuleset[],
  previouslyUsedId?: ID,
): ID | undefined {
  const usable = selectable.filter(item => item.usable);
  if (!usable.length) return undefined;
  // What the user built with last time is a real signal; sort order is not.
  const previous = previouslyUsedId ? usable.find(item => item.id === previouslyUsedId) : undefined;
  if (previous) return previous.id;
  if (usable.length === 1) return usable[0].id;
  const publicUsable = usable.filter(item => item.publicOnly);
  if (publicUsable.length === 1) return publicUsable[0].id;
  // Genuinely ambiguous: the caller must ask.
  return undefined;
}

export interface RulesetProposal {
  /** The profile that would be created, ready to persist unchanged. */
  profile: RulesetProfile;
  /** True when an equivalent profile already covers these sources. */
  alreadyInstalled: boolean;
  /** The existing profile covering the same sources, when there is one. */
  existingId?: ID;
}

/**
 * The profile an imported pack implies, without writing anything.
 *
 * Import and profile creation stay separate operations so a rolled-back import
 * cannot leave a profile behind pointing at content that was never written.
 */
export function proposeRulesetForSources(
  packName: string,
  packId: ID,
  sourceIds: readonly ID[],
  entries: readonly ContentEntry[],
  existing: readonly RulesetProfile[],
  now: string,
): ServiceOutcome<RulesetProposal> {
  if (!sourceIds.length)
    return invalid([{ code: "RULESET_NEEDS_A_SOURCE", recordId: packId, severity: "error" }]);

  const wanted = new Set(sourceIds);
  const covering = existing.find(
    profile =>
      profile.activeSourceIds.length === wanted.size &&
      profile.activeSourceIds.every(id => wanted.has(id)),
  );

  const categories = [...new Set(entries.filter(entry => sourceIds.includes(entry.sourceId)).map(entry => entry.category))];
  const editions = [...new Set(entries.filter(entry => sourceIds.includes(entry.sourceId)).map(entry => entry.rulesEdition))];

  const profile: RulesetProfile = {
    // Derived from the pack ID so the same pack proposes the same profile twice.
    id: `ruleset:${packId.replace(/^pack:/, "")}`,
    name: packName,
    activeSourceIds: [...sourceIds],
    editionPriority: editions.length ? editions : ["homebrew"],
    allowedCategories: categories,
    allowLegacy: false,
    allowDuplicateVersions: false,
    conflictResolution: "source-priority",
    allowCustomOverrides: false,
    requirementEnforcement: "hard",
    createdAt: now,
    updatedAt: now,
  };

  return ok({
    profile,
    alreadyInstalled: Boolean(covering),
    ...(covering ? { existingId: covering.id } : {}),
  });
}
