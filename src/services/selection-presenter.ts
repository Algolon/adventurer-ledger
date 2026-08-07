/**
 * What a selectable piece of content says about itself.
 *
 * The creation steps for Class, Species and Background all ask the same shape of
 * question — pick one of these, then answer whatever it turns out to require —
 * so they share one presentation model. This module turns a `ContentEntry` plus
 * its typed mechanics into that model, and nothing else: no React, no Dexie, no
 * plan traversal, no draft mutation.
 *
 * Two rules govern everything here, and both exist because the alternative
 * produces confident nonsense:
 *
 * 1. **Read, never infer.** Every value comes from typed mechanics, a typed
 *    effect, a declared trait or an entry's own `summary`. Nothing is derived
 *    from a display name, a slug or a tag, so content that has never been seen
 *    before presents correctly and content from a different ruleset does not
 *    present a claim borrowed from this one.
 * 2. **Omit rather than invent.** A fact whose mechanics do not parse, or whose
 *    referenced entry is not installed, produces no row. An empty section is
 *    dropped by the caller. Saying nothing is always available; saying something
 *    untrue is not.
 *
 * Nothing here emits a raw ID, an effect expression, an issue code or any pack
 * metadata. Those are internal vocabulary, and a creation screen is not where a
 * player learns it.
 */
import {
  backgroundMechanicsSchema,
  classMechanicsSchema,
  lineageMechanicsSchema,
  raceMechanicsSchema,
  speciesMechanicsSchema,
} from "@/src/domain/content-pack";
import type { ContentEntry, EffectDisposition, ID } from "@/src/domain/model";
import { EFFECT_CAPABILITIES } from "@/src/rules/effect-capabilities";

/** One at-a-glance fact. Present only when the content actually states it. */
export interface SelectionFact {
  label: string;
  value: string;
}

/**
 * One thing the selected content gives you.
 *
 * `disposition` is read from the entry's own effects, not guessed: it is what
 * separates "the app has already applied this" from "this one needs a ruling at
 * the table". An entry that declares no effects carries no disposition at all,
 * because there is nothing to make a claim about.
 */
export interface SelectionGrant {
  id: ID;
  label: string;
  detail?: string;
  disposition?: EffectDisposition;
  /** The level this arrives at, when a progression states one. */
  level?: number;
}

export interface SelectionDetailRow {
  label: string;
  value: string;
}

/** The compact row before selection, and the expanded panel after it. */
export interface SelectionOptionView {
  id: ID;
  label: string;
  /** The entry's own concise summary, when it has one. */
  tagline?: string;
  /** At most four, so the collapsed row stays scannable on a phone. */
  facts: readonly SelectionFact[];
  /** "What you get": grants and traits that apply from the start. */
  grants: readonly SelectionGrant[];
  /** "At your starting level": only what the chosen level actually reaches. */
  atLevel: readonly SelectionGrant[];
  /** "More details": useful, but not needed to make this decision. */
  details: readonly SelectionDetailRow[];
}

const MAX_FACTS = 4;

/** Sentence case for a single typed token such as `humanoid` or `medium`. */
const titleCase = (value: string): string =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(" ");

const listOf = (values: readonly string[]): string => values.join(", ");

/**
 * How much of an entry the app applies on its own.
 *
 * `manual-adjudication` wins over everything: a trait that is automatic in three
 * respects and needs a ruling in a fourth is not an automatic trait, and
 * presenting it as one is how a player discovers at the table that the sheet was
 * never tracking it. An entry with no effects returns `undefined` — it describes
 * something without asking the engine to do anything, and inventing a
 * disposition for it would be a claim the content never made.
 */
export function dispositionOf(entry: ContentEntry): EffectDisposition | undefined {
  const dispositions = entry.effects.map(effect => EFFECT_CAPABILITIES[effect.type]?.disposition).filter(Boolean);
  if (!dispositions.length) return undefined;
  if (dispositions.includes("manual-adjudication")) return "manual-adjudication";
  if (dispositions.includes("choice-driven")) return "choice-driven";
  return "automatic";
}

/** A grant row for one referenced entry, or nothing when it is not installed. */
const grantFor = (id: ID, index: ReadonlyMap<ID, ContentEntry>, level?: number): SelectionGrant | undefined => {
  const entry = index.get(id);
  if (!entry) return undefined;
  const disposition = dispositionOf(entry);
  return {
    id: entry.id,
    label: entry.name,
    ...(entry.summary ? { detail: entry.summary } : {}),
    ...(disposition ? { disposition } : {}),
    ...(level === undefined ? {} : { level }),
  };
};

const grantsFor = (ids: readonly ID[], index: ReadonlyMap<ID, ContentEntry>): SelectionGrant[] =>
  ids.map(id => grantFor(id, index)).filter((grant): grant is SelectionGrant => Boolean(grant));

/** Proficiency entries grouped by their typed kind, for readable summaries. */
function proficienciesByType(
  ids: readonly ID[],
  index: ReadonlyMap<ID, ContentEntry>,
): Map<string, { id: ID; name: string }[]> {
  const grouped = new Map<string, { id: ID; name: string }[]>();
  for (const id of ids) {
    const entry = index.get(id);
    if (entry?.category !== "proficiency") continue;
    const type = (entry.mechanics as { type?: unknown }).type;
    if (typeof type !== "string") continue;
    const bucket = grouped.get(type) ?? [];
    bucket.push({ id: entry.id, name: entry.name });
    grouped.set(type, bucket);
  }
  return grouped;
}

/**
 * The Species step's options.
 *
 * `race` is presented identically to `species`. It is the older spelling of the
 * same decision and still in the public schema, so a ruleset built on it must
 * read as a first-class species rather than as a degraded one.
 */
export function presentSpecies(entry: ContentEntry, entries: readonly ContentEntry[]): SelectionOptionView {
  const index = new Map(entries.map(item => [item.id, item]));
  const parsed =
    entry.category === "race" ? raceMechanicsSchema.safeParse(entry.mechanics) : speciesMechanicsSchema.safeParse(entry.mechanics);

  const base: SelectionOptionView = {
    id: entry.id,
    label: entry.name,
    ...(entry.summary ? { tagline: entry.summary } : {}),
    facts: [],
    grants: [],
    atLevel: [],
    details: [],
  };
  // Unreadable mechanics still produce a selectable option. The species exists
  // and the user may pick it; it simply describes itself with less.
  if (!parsed.success) return base;

  const mechanics = parsed.data;
  const traits = grantsFor(mechanics.traitIds, index);
  // A lineage is reached through the species' own declared choice, so the count
  // of declared lineages is what tells the user a further decision is coming.
  const lineageCount = "lineageIds" in mechanics ? mechanics.lineageIds.length : 0;

  const facts: SelectionFact[] = [
    { label: "Speed", value: `${mechanics.speed} ft.` },
    { label: "Size", value: listOf(mechanics.sizeChoices.map(titleCase)) },
  ];
  if (traits.length) facts.push({ label: "Traits", value: String(traits.length) });
  if (lineageCount) facts.push({ label: "Lineages", value: String(lineageCount) });

  const details: SelectionDetailRow[] = [{ label: "Creature type", value: titleCase(mechanics.creatureType) }];
  if ("legacyAbilityScores" in mechanics) {
    // The older spelling carries fixed increases the newer one moved to the
    // background. Stated only when the content actually declares them.
    const scores = Object.entries(mechanics.legacyAbilityScores);
    if (scores.length)
      details.push({
        label: "Ability increases",
        value: listOf(scores.map(([ability, amount]) => `${titleCase(ability)} +${amount}`)),
      });
  }

  return { ...base, facts: facts.slice(0, MAX_FACTS), grants: traits, atLevel: [], details };
}

/**
 * A lineage's own contribution, shown once one is selected.
 *
 * `replacesTraitIds` is the typed replacement relationship. It is reported so
 * the user can see that a trait was swapped rather than silently lost, and it is
 * read from the declaration — never from comparing trait names.
 */
export function presentLineage(
  entry: ContentEntry,
  entries: readonly ContentEntry[],
): { grants: readonly SelectionGrant[]; replaces: readonly SelectionGrant[] } {
  const index = new Map(entries.map(item => [item.id, item]));
  const parsed = lineageMechanicsSchema.safeParse(entry.mechanics);
  if (!parsed.success) return { grants: [], replaces: [] };
  return {
    grants: grantsFor(parsed.data.traitIds, index),
    replaces: grantsFor(parsed.data.replacesTraitIds, index),
  };
}

/** The Background step's options. */
export function presentBackground(entry: ContentEntry, entries: readonly ContentEntry[]): SelectionOptionView {
  const index = new Map(entries.map(item => [item.id, item]));
  const parsed = backgroundMechanicsSchema.safeParse(entry.mechanics);

  const base: SelectionOptionView = {
    id: entry.id,
    label: entry.name,
    ...(entry.summary ? { tagline: entry.summary } : {}),
    facts: [],
    grants: [],
    atLevel: [],
    details: [],
  };
  if (!parsed.success) return base;

  const mechanics = parsed.data;
  /*
   * Every distribution the background allows, not just its default. A
   * background that offers a genuine alternative must say so here, on the step
   * where it is chosen, rather than let the alternative appear for the first
   * time two steps later on Abilities.
   */
  const shapes = (mechanics.abilityScoreChoices.increasePatterns?.length
    ? [mechanics.abilityScoreChoices.increasePattern, ...mechanics.abilityScoreChoices.increasePatterns]
    : [mechanics.abilityScoreChoices.increasePattern]
  ).map(amounts => amounts.map(step => `+${step}`).join(" / "));
  const distinctShapes = [...new Set(shapes)];
  const increases = distinctShapes.join(" or ");
  const grouped = proficienciesByType(mechanics.proficiencyIds, index);
  const skills = grouped.get("skill") ?? [];
  const tools = grouped.get("tool") ?? [];
  const languages = grouped.get("language") ?? [];
  const feat = index.get(mechanics.featId);

  const facts: SelectionFact[] = [{ label: "Ability increases", value: increases }];
  if (feat) facts.push({ label: "Origin feat", value: feat.name });
  if (skills.length) facts.push({ label: "Skills", value: String(skills.length) });
  if (tools.length) facts.push({ label: "Tool", value: tools.length === 1 ? tools[0].name : String(tools.length) });

  /*
   * "What you get" reads as one list of concrete benefits rather than as a
   * schema dump. The ability increase is first because it is the grant that
   * changes the most downstream numbers, and it names the abilities the
   * background actually offers instead of the ones the fixture happens to use.
   */
  const grants: SelectionGrant[] = [
    {
      id: `${entry.id}:ability-increases`,
      label: `Ability increases ${increases}`,
      detail:
        `Spread across ${listOf(mechanics.abilityScoreChoices.abilities.map(titleCase))}. ` +
        (distinctShapes.length > 1
          ? "You pick which of these ways to spend it, and which ability takes which increase, on Abilities."
          : "You choose which ability takes which increase on Abilities."),
      disposition: "choice-driven",
    },
  ];
  const featGrant = grantFor(mechanics.featId, index);
  if (featGrant) grants.push(featGrant);
  for (const [type, label] of [
    ["skill", "Skill proficiency"],
    ["tool", "Tool proficiency"],
    ["language", "Language"],
    ["armor", "Armour proficiency"],
    ["weapon", "Weapon proficiency"],
    ["save", "Saving throw"],
  ] as const)
    for (const proficiency of grouped.get(type) ?? [])
      grants.push({ id: proficiency.id, label: proficiency.name, detail: label, disposition: "automatic" });

  const equipment = grantsFor(mechanics.equipmentBundleIds, index);
  const details: SelectionDetailRow[] = [];
  if (languages.length) details.push({ label: "Languages", value: listOf(languages.map(item => item.name)) });

  return {
    ...base,
    facts: facts.slice(0, MAX_FACTS),
    grants: [...grants, ...equipment],
    atLevel: [],
    details,
  };
}

/**
 * The Class step's options.
 *
 * This screen explains the class and establishes class plus level. It states
 * what the class *is* and how many decisions it will ask for, and deliberately
 * does not present those decisions: they belong on Class choices, next to each
 * other, where they can be compared.
 */
export function presentClass(
  entry: ContentEntry,
  entries: readonly ContentEntry[],
  level: number,
): SelectionOptionView {
  const index = new Map(entries.map(item => [item.id, item]));
  const parsed = classMechanicsSchema.safeParse(entry.mechanics);

  const base: SelectionOptionView = {
    id: entry.id,
    label: entry.name,
    ...(entry.summary ? { tagline: entry.summary } : {}),
    facts: [],
    grants: [],
    atLevel: [],
    details: [],
  };
  if (!parsed.success) return base;

  const mechanics = parsed.data;
  const saves = mechanics.savingThrows
    .map(id => index.get(id))
    .filter((item): item is ContentEntry => item?.category === "proficiency")
    .map(item => item.name);

  const facts: SelectionFact[] = [{ label: "Hit die", value: `d${mechanics.hitDie}` }];
  if (saves.length) facts.push({ label: "Saves", value: listOf(saves) });
  facts.push({ label: "Primary", value: listOf(mechanics.primaryAbilities.map(titleCase)) });
  /*
   * Subclass timing, stated relative to the level being created rather than in
   * the abstract. "Chosen at level 3" and "not until level 3" answer different
   * questions, and the second is the one a level 1 character is asking.
   */
  facts.push({
    label: "Subclass",
    value:
      level >= mechanics.subclassLevel
        ? `Chosen at level ${mechanics.subclassLevel}`
        : `From level ${mechanics.subclassLevel}`,
  });

  const grants = grantsFor(mechanics.startingProficiencyIds, index);

  /*
   * Only what this starting level actually reaches. A level 5 build sees the
   * features of levels 1 to 5; a level 1 build must not be shown level 5's, or
   * the screen is describing a character that does not exist yet.
   */
  const atLevel: SelectionGrant[] = [];
  for (const row of mechanics.progression.filter(item => item.level <= level).sort((a, b) => a.level - b.level))
    for (const featureId of row.featureIds) {
      const grant = grantFor(featureId, index, row.level);
      if (grant) atLevel.push(grant);
    }

  const details: SelectionDetailRow[] = [];
  const maxLevel = mechanics.progression.reduce((highest, row) => Math.max(highest, row.level), 0);
  if (maxLevel) details.push({ label: "Levels described", value: `1–${maxLevel}` });
  if (mechanics.subclassIds.length)
    details.push({ label: "Subclass options", value: String(mechanics.subclassIds.length) });

  return { ...base, facts: facts.slice(0, MAX_FACTS), grants, atLevel, details };
}
