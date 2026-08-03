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
 * Restricts content to the sources and categories the ruleset activates.
 * Without a ruleset the caller sees everything, which keeps legacy and
 * ruleset-less reads working.
 */
export function scopeEntriesToRuleset(
  entries: readonly ContentEntry[],
  ruleset: RulesetProfile | undefined,
): ContentEntry[] {
  if (!ruleset) return [...entries];
  const sources = new Set(ruleset.activeSourceIds);
  const categories = ruleset.allowedCategories.length ? new Set(ruleset.allowedCategories) : undefined;
  return entries.filter(entry => sources.has(entry.sourceId) && (!categories || categories.has(entry.category)));
}

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
