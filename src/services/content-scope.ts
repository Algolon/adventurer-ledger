/**
 * Generic content and ruleset discovery for the authoritative services.
 *
 * The resolver and the planners must work for any content that satisfies the
 * declarative contracts, not just the synthetic slice shipped for testing.
 * Nothing in this module names a specific class, species, weapon or choice: it
 * reads mechanics, tags and declarative relations out of content entries.
 *
 * It also fixes the scope of "installed content". A character is resolved
 * against its own ruleset's active sources, so installing an unrelated pack
 * cannot change an existing character's derived sheet, its content fingerprint,
 * or the options its builder offers.
 */
import { z } from "zod";
import { classMechanicsSchema } from "@/src/domain/content-pack";
import type { Ability, ContentEntry, ID, RulesetProfile } from "@/src/domain/model";
import { ABILITIES } from "@/src/domain/character-record";
import type { CharacterRepositories } from "@/src/storage/character-repositories";

/** Tag convention that associates a proficiency with the ability it uses. */
const ABILITY_TAG_PREFIX = "ability:";

/**
 * Restricts content to what the ruleset actually activates.
 *
 * Membership is by explicit entry identity when the profile declares one. A
 * source ID is not an identity: two packs may legitimately publish against the
 * same source, and scoping by source alone means importing one pack silently
 * activates every unrelated entry that happens to share its source — widening a
 * character's ruleset without anyone asking for it. `allowedEntryIds` is the
 * bounded set the import wrote from the pack it actually installed.
 *
 * A profile with no explicit set is scoped by source, which is how profiles
 * written before this existed keep resolving exactly as they did.
 *
 * Without a ruleset the caller sees everything, which keeps legacy and
 * ruleset-less reads working.
 */
export function scopeEntriesToRuleset(
  entries: readonly ContentEntry[],
  ruleset: RulesetProfile | undefined,
): ContentEntry[] {
  if (!ruleset) return [...entries];
  const categories = ruleset.allowedCategories.length ? new Set(ruleset.allowedCategories) : undefined;
  const denied = ruleset.disallowedEntryIds?.length ? new Set(ruleset.disallowedEntryIds) : undefined;
  const allowedIds = ruleset.allowedEntryIds?.length ? new Set(ruleset.allowedEntryIds) : undefined;
  const sources = new Set(ruleset.activeSourceIds);
  const belongs = (entry: ContentEntry) =>
    allowedIds ? allowedIds.has(entry.id) : sources.has(entry.sourceId);
  return entries.filter(
    entry => belongs(entry) && !denied?.has(entry.id) && (!categories || categories.has(entry.category)),
  );
}

/**
 * How much of a ruleset's content is private or export-restricted.
 *
 * Derived from record metadata — `private`, `exportRestricted` and the entry's
 * own `visibility` — never from a name, a title or any body text. The result is
 * a classification the UI can show without quoting anything it classified.
 */
export type RulesetPrivacy = "public-only" | "restricted" | "mixed";

/** Visibilities that are not publishable content, whatever the flags say. */
const RESTRICTED_VISIBILITIES: ReadonlySet<ContentEntry["visibility"]> = new Set([
  "private-user-entered",
  "private-full-text",
  "private-summary",
  "local-reference-only",
  "unavailable-reference-only",
]);

/** True when this record may not leave the device by default. */
export function entryIsRestricted(entry: ContentEntry): boolean {
  return entry.private || entry.exportRestricted || RESTRICTED_VISIBILITIES.has(entry.visibility);
}

export function rulesetPrivacyFor(entries: readonly ContentEntry[]): RulesetPrivacy {
  let restricted = 0;
  for (const entry of entries) if (entryIsRestricted(entry)) restricted += 1;
  // An empty profile reaches no private content, so it is not restricted.
  if (restricted === 0) return "public-only";
  return restricted === entries.length ? "restricted" : "mixed";
}

export const RULESET_PRIVACY_LABELS: Readonly<Record<RulesetPrivacy, string>> = {
  "public-only": "Public content only",
  restricted: "Private or export-restricted content",
  mixed: "Mixed public and private content",
};

export interface RulesetScope {
  ruleset: RulesetProfile | undefined;
  /** Only the entries this ruleset activates. */
  entries: ContentEntry[];
}

/** Loads a character's ruleset and the content it activates, in one place. */
export async function loadRulesetScope(
  repositories: CharacterRepositories,
  rulesetProfileId: ID,
): Promise<RulesetScope> {
  const [allEntries, ruleset] = await Promise.all([
    repositories.content.listEntries(),
    repositories.content.getRuleset(rulesetProfileId),
  ]);
  return { ruleset, entries: scopeEntriesToRuleset(allEntries, ruleset) };
}

/** The ability a proficiency is rolled with, from its tag or its own key. */
export function abilityForProficiency(entry: ContentEntry): Ability | undefined {
  const tagged = entry.tags
    .find(tag => tag.startsWith(ABILITY_TAG_PREFIX))
    ?.slice(ABILITY_TAG_PREFIX.length);
  if (tagged && (ABILITIES as readonly string[]).includes(tagged)) return tagged as Ability;
  // A saving throw is conventionally keyed by its own ability.
  const key = (entry.mechanics as { key?: unknown }).key;
  if (typeof key === "string" && (ABILITIES as readonly string[]).includes(key)) return key as Ability;
  return undefined;
}

export interface ProficiencyDefinitionView {
  id: ID;
  label: string;
  ability: Ability;
  type: "skill" | "save";
}

const proficiencyMechanicsSchema = z.object({ type: z.string(), key: z.string() }).passthrough();

/**
 * Every save and skill the ruleset defines, in deterministic order. The sheet
 * lists these and marks which are proficient; it does not carry a fixed list.
 */
export function proficiencyCatalog(entries: readonly ContentEntry[]): {
  saves: ProficiencyDefinitionView[];
  skills: ProficiencyDefinitionView[];
} {
  const saves: ProficiencyDefinitionView[] = [];
  const skills: ProficiencyDefinitionView[] = [];
  for (const entry of entries) {
    if (entry.category !== "proficiency") continue;
    const parsed = proficiencyMechanicsSchema.safeParse(entry.mechanics);
    if (!parsed.success) continue;
    const ability = abilityForProficiency(entry);
    if (!ability) continue;
    if (parsed.data.type === "save") saves.push({ id: entry.id, label: entry.name, ability, type: "save" });
    else if (parsed.data.type === "skill") skills.push({ id: entry.id, label: entry.name, ability, type: "skill" });
  }
  // Saves follow the canonical ability order; skills are alphabetical.
  saves.sort((left, right) => ABILITIES.indexOf(left.ability) - ABILITIES.indexOf(right.ability) || left.id.localeCompare(right.id));
  skills.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  return { saves, skills };
}

/** The hit die declared by a class entry, or undefined when it is unavailable. */
export function hitDieForClass(entry: ContentEntry | undefined): number | undefined {
  if (!entry || entry.category !== "class") return undefined;
  const parsed = classMechanicsSchema.safeParse(entry.mechanics);
  return parsed.success ? parsed.data.hitDie : undefined;
}

const masteryMechanicsSchema = z.object({ data: z.object({ appliesToWeaponId: z.string().optional() }).passthrough() }).passthrough();

/**
 * Which weapon each granted mastery applies to, read from the mastery entry's
 * declarative relation rather than compared against a known ID.
 */
export function masteryWeaponRelations(entries: readonly ContentEntry[]): Map<ID, ID | undefined> {
  const relations = new Map<ID, ID | undefined>();
  for (const entry of entries) {
    if (entry.category !== "weapon-mastery") continue;
    const parsed = masteryMechanicsSchema.safeParse(entry.mechanics);
    relations.set(entry.id, parsed.success ? parsed.data.data.appliesToWeaponId : undefined);
  }
  return relations;
}

const abilityGenerationSchema = z
  .object({
    kind: z.literal("ability-generation"),
    data: z.object({
      method: z.enum(["standard-array", "manual"]),
      scores: z.array(z.number().int().min(1).max(30)).max(12).optional(),
      label: z.string().max(120).optional(),
    }),
  })
  .passthrough();

export interface AbilityGenerationMethod {
  id: ID;
  method: "standard-array" | "manual";
  label: string;
  /** Present for a fixed-array method. */
  scores?: readonly number[];
}

/**
 * Ability-generation methods the ruleset offers, expressed as ordinary rule
 * content. The planner reads these instead of importing a hard-coded array.
 */
export function abilityGenerationMethods(entries: readonly ContentEntry[]): AbilityGenerationMethod[] {
  const methods: AbilityGenerationMethod[] = [];
  for (const entry of entries) {
    if (entry.category !== "rule") continue;
    const parsed = abilityGenerationSchema.safeParse(entry.mechanics);
    if (!parsed.success) continue;
    methods.push({
      id: entry.id,
      method: parsed.data.data.method,
      label: parsed.data.data.label ?? entry.name,
      ...(parsed.data.data.scores ? { scores: parsed.data.data.scores } : {}),
    });
  }
  return methods.sort((left, right) => left.id.localeCompare(right.id));
}

/** The fixed score array a ruleset's standard-array method offers, if any. */
export function standardArrayFor(entries: readonly ContentEntry[]): readonly number[] | undefined {
  return abilityGenerationMethods(entries).find(item => item.method === "standard-array" && item.scores)?.scores;
}

export interface EquipmentChoiceView {
  bundleId: ID;
  choiceId: ID;
  label: string;
  min: number;
  max: number;
  options: readonly { id: ID; label: string }[];
}

/**
 * Equipment choices the character's granted bundles require, discovered by
 * walking bundle definitions rather than naming a known choice.
 */
export function equipmentChoicesFor(
  grantingEntries: readonly ContentEntry[],
  allEntries: readonly ContentEntry[],
): EquipmentChoiceView[] {
  const requested = new Set<ID>();
  for (const entry of grantingEntries) {
    for (const effect of entry.effects) if (effect.type === "grantEquipmentBundle") requested.add(effect.bundleId);
    if (entry.category === "background") {
      const ids = (entry.mechanics as { equipmentBundleIds?: unknown }).equipmentBundleIds;
      if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string") requested.add(id);
    }
  }

  const definitions = new Map(allEntries.flatMap(entry => (entry.equipmentBundles ?? []).map(bundle => [bundle.id, bundle] as const)));
  const choices: EquipmentChoiceView[] = [];
  const walk = (nodes: readonly import("@/src/domain/model").EquipmentBundleNode[], bundleId: ID) => {
    for (const node of nodes) {
      if (node.type === "choice") {
        choices.push({
          bundleId,
          choiceId: node.id,
          label: node.label,
          min: node.min,
          max: node.max,
          options: node.options.map(option => ({ id: option.id, label: option.label })),
        });
        for (const option of node.options) walk(option.entries, bundleId);
      } else if (node.type === "bundle") walk(node.entries, bundleId);
    }
  };
  for (const bundleId of [...requested].sort()) {
    const bundle = definitions.get(bundleId);
    if (bundle) walk(bundle.entries, bundleId);
  }
  return choices;
}

export interface EquipmentItemView {
  itemId: ID;
  label: string;
  quantity: number;
  status: "granted" | "carried" | "equipped";
}

export interface EquipmentOptionView {
  id: ID;
  label: string;
  /** What the package actually contains, so it is legible before selection. */
  contents: readonly EquipmentItemView[];
}

export interface EquipmentChoiceDetailView {
  choiceId: ID;
  label: string;
  min: number;
  max: number;
  options: readonly EquipmentOptionView[];
}

export interface EquipmentGrantSource {
  entryId: ID;
  label: string;
  category: ContentEntry["category"];
}

export interface EquipmentGrantView {
  bundleId: ID;
  bundleLabel: string;
  /**
   * The first entry that grants the bundle, in traversal order. Kept because
   * most bundles have exactly one source and reading `grantedBy[0]` everywhere
   * would be noise; `grantedBy` is authoritative when there is more than one.
   */
  grantedByEntryId: ID;
  grantedByLabel: string;
  grantedByCategory: ContentEntry["category"];
  /**
   * Every entry that grants this same bundle.
   *
   * Two entries granting one bundle is a provenance fact, not a second bundle:
   * the character receives the contents once. Keeping the sources in a list and
   * the bundle as one record is what stops Review listing the items twice while
   * still being able to say where they came from.
   */
  grantedBy: readonly EquipmentGrantSource[];
  /** Items the bundle grants with no decision attached. */
  automatic: readonly EquipmentItemView[];
  choices: readonly EquipmentChoiceDetailView[];
}

/** Bundle IDs one entry requests, whether by effect or by background mechanics. */
function requestedBundleIds(entry: ContentEntry): ID[] {
  const requested: ID[] = [];
  for (const effect of entry.effects) if (effect.type === "grantEquipmentBundle") requested.push(effect.bundleId);
  const declared = (entry.mechanics as { equipmentBundleIds?: unknown }).equipmentBundleIds;
  if (Array.isArray(declared)) for (const id of declared) if (typeof id === "string") requested.push(id);
  return requested;
}

/**
 * Everything the build's granted equipment bundles contain, attributed to the
 * entry that grants each one.
 *
 * The builder needs more than the list of decisions: it has to show what is
 * given automatically and what each selectable package holds, from every
 * granting source rather than the class alone. Walking the bundle tree here
 * keeps that presentation and the resolver reading the same declarations.
 */
export function equipmentGrantsFor(
  grantingEntries: readonly ContentEntry[],
  allEntries: readonly ContentEntry[],
): EquipmentGrantView[] {
  const byId = new Map(allEntries.map(entry => [entry.id, entry]));
  const definitions = new Map(
    allEntries.flatMap(entry => (entry.equipmentBundles ?? []).map(bundle => [bundle.id, bundle] as const)),
  );
  const itemView = (node: { itemId: ID; quantity: number; status: EquipmentItemView["status"] }): EquipmentItemView => ({
    itemId: node.itemId,
    label: byId.get(node.itemId)?.name ?? node.itemId,
    quantity: node.quantity,
    status: node.status,
  });

  const collectItems = (nodes: readonly import("@/src/domain/model").EquipmentBundleNode[]): EquipmentItemView[] => {
    const items: EquipmentItemView[] = [];
    for (const node of nodes) {
      if (node.type === "item") items.push(itemView(node));
      else if (node.type === "bundle") items.push(...collectItems(node.entries));
    }
    return items;
  };

  const views: EquipmentGrantView[] = [];
  /** One view per bundle, keyed by the bundle's own identity. */
  const byBundle = new Map<ID, EquipmentGrantView & { grantedBy: EquipmentGrantSource[] }>();
  for (const entry of grantingEntries) {
    for (const bundleId of requestedBundleIds(entry)) {
      const source: EquipmentGrantSource = { entryId: entry.id, label: entry.name, category: entry.category };
      const existing = byBundle.get(bundleId);
      if (existing) {
        // The same bundle from a second source adds provenance, not contents.
        if (!existing.grantedBy.some(item => item.entryId === entry.id)) existing.grantedBy.push(source);
        continue;
      }
      const bundle = definitions.get(bundleId);
      if (!bundle) continue;
      const choices: EquipmentChoiceDetailView[] = [];
      const walk = (nodes: readonly import("@/src/domain/model").EquipmentBundleNode[]) => {
        for (const node of nodes) {
          if (node.type === "bundle") walk(node.entries);
          else if (node.type === "choice") {
            choices.push({
              choiceId: node.id,
              label: node.label,
              min: node.min,
              max: node.max,
              options: node.options.map(option => ({
                id: option.id,
                label: option.label,
                contents: collectItems(option.entries),
              })),
            });
            // A package may itself contain a further decision.
            for (const option of node.options) walk(option.entries);
          }
        }
      };
      walk(bundle.entries);
      const view = {
        bundleId: bundle.id,
        bundleLabel: bundle.label,
        grantedByEntryId: entry.id,
        grantedByLabel: entry.name,
        grantedByCategory: entry.category,
        grantedBy: [source],
        automatic: collectItems(bundle.entries),
        choices,
      };
      byBundle.set(bundleId, view);
      views.push(view);
    }
  }
  return views;
}

/**
 * The equipment a build would actually end up with: every automatic grant plus
 * the contents of each selected package.
 *
 * Two rules make this the list the character really holds rather than a list of
 * grant events. A bundle contributes its contents once no matter how many
 * entries grant it, because being handed the same kit twice is one kit. Items
 * are then totalled per (item, status), so two *different* bundles that each
 * contain a rope produce one line reading two ropes rather than two lines
 * reading one — a genuine quantity increase, stated as one.
 *
 * Review shows this, so what is committed is what was read.
 */
export function selectedEquipmentFor(
  grants: readonly EquipmentGrantView[],
  selections: Readonly<Record<ID, readonly ID[]>>,
): EquipmentItemView[] {
  const counted = new Map<string, EquipmentItemView>();
  const seenBundles = new Set<ID>();
  const order: string[] = [];
  const add = (item: EquipmentItemView) => {
    const key = `${item.itemId}${item.status}`;
    const existing = counted.get(key);
    if (existing) {
      counted.set(key, { ...existing, quantity: existing.quantity + item.quantity });
      return;
    }
    counted.set(key, { ...item });
    order.push(key);
  };

  for (const grant of grants) {
    if (seenBundles.has(grant.bundleId)) continue;
    seenBundles.add(grant.bundleId);
    // `automatic` already excludes anything an option supplies, because
    // `collectItems` does not descend into choice nodes.
    for (const item of grant.automatic) add(item);
    const chosenIds = new Set(grant.choices.flatMap(choice => selections[choice.choiceId] ?? []));
    for (const choice of grant.choices)
      for (const option of choice.options)
        if (chosenIds.has(option.id)) for (const item of option.contents) add(item);
  }
  return order.flatMap(key => {
    const item = counted.get(key);
    return item ? [item] : [];
  });
}

/** The entries whose effects and bundles a build activates, for planning. */
export function grantingEntriesFor(
  ids: readonly (ID | undefined)[],
  entries: readonly ContentEntry[],
): ContentEntry[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return ids.flatMap(id => {
    const entry = id ? byId.get(id) : undefined;
    return entry ? [entry] : [];
  });
}
