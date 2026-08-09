/**
 * What spells a build *owes*, as distinct from what it can reach.
 *
 * `spell-availability` answers "what is reachable" and deliberately refuses to
 * answer "what does this character have": reaching a list is permission, never
 * possession. This module adds the one fact that sat between them and did not
 * exist anywhere — how many spells the content says the player must choose — and
 * it does so without inventing a new place for content to live.
 *
 * The declaration is the `spellcasting` rule the derived sheet already reads. It
 * is a `rule` entry whose mechanics are `{ kind, data }` with `data` untyped at
 * the schema boundary, so the counts fit inside content that already validates
 * and no content-pack schema change is required. What was missing was a *typed*
 * reading of that data, which is what this module is: the planner and the derived
 * resolver both parse through `spellcastingDeclarationSchema` here, so a
 * declaration cannot mean one thing before commit and another after.
 *
 * Three properties are load-bearing:
 *
 * 1. **Nothing is named.** No class, no source, no selection ID is branched on.
 *    A pack drives the entire behaviour through its own declaration, which is
 *    what lets private content work without an engine change.
 * 2. **Counts are cumulative, read at the character's level.** A level 5 start is
 *    a character who already owes its whole accumulated obligation, not four
 *    level-ups to walk through, and a level decrease reduces the obligation by
 *    the same single rule rather than a second one.
 * 3. **Granted is not chosen.** A spell an effect grants is shown, distinguished
 *    and not selectable, and it does not consume the player's allowance unless
 *    the declaration explicitly says it does.
 */
import { z } from "zod";
import type { CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry, ID } from "@/src/domain/model";
import type { BuilderStepId } from "@/src/services/builder-steps";
import type { AvailableSpell, SpellAvailability } from "@/src/services/spell-availability";

/** The step that owns every spell selection. */
export const SPELL_SELECTION_STEP: BuilderStepId = "spells-resources";

/**
 * The two generic player-selection models this slice implements.
 *
 * `known` puts the chosen spell in the character's known set; `prepared` puts it
 * in the currently-prepared set. A learned-collection layer that feeds a prepared
 * subset is a third model and is deliberately absent — see the design note.
 */
export type SpellSelectionModel = "known" | "prepared";

/**
 * One cumulative progression row.
 *
 * `count` is the total owed at this level, not a delta, because a total is the
 * only form that reads correctly for a character created at that level. A delta
 * would require replaying every level below it to answer a question the builder
 * asks once.
 */
const progressionRowSchema = z
  .object({
    level: z.number().int().min(1).max(30),
    count: z.number().int().min(0).max(100),
    /** Highest spell level this row makes reachable. Absent means unrestricted. */
    maxSpellLevel: z.number().int().min(0).max(9).optional(),
  })
  .strict();

const selectionDeclarationSchema = z
  .object({
    id: z.string().min(1).max(160),
    model: z.enum(["known", "prepared"]),
    label: z.string().min(1).max(240),
    /**
     * Restricts the selection to a subset of the lists the build reaches. Absent
     * means every reachable list, which is the common case and the one a pack
     * should not have to restate.
     */
    spellListIds: z.array(z.string().max(160)).max(50).optional(),
    spellLevels: z
      .object({ min: z.number().int().min(0).max(9).optional(), max: z.number().int().min(0).max(9).optional() })
      .strict()
      .optional(),
    progression: z.array(progressionRowSchema).min(1).max(30),
    /**
     * Whether an automatically granted spell spends one of these choices.
     * Defaults to false: a grant is a gift, and the opposite reading would
     * quietly cost the player a decision the rules gave them.
     */
    grantedConsumesAllowance: z.boolean().default(false),
  })
  .strict();

/**
 * The declarative spellcasting rule, typed once for every reader.
 *
 * `.passthrough()` on the outer object, because packs written before `selections`
 * existed carry exactly the fields the derived sheet already read and must keep
 * parsing unchanged. An absent `selections` is an empty one: content that
 * declares casting but owes no player decision is a legitimate shape, not a
 * defect.
 */
export const spellcastingDeclarationSchema = z
  .object({
    classId: z.string().max(160),
    ability: z.enum(["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]),
    attackProficient: z.boolean().default(false),
    saveDcBase: z.number().int().min(0).max(30).optional(),
    slotResourceIds: z.array(z.string().max(160)).default([]),
    selections: z.array(selectionDeclarationSchema).max(20).default([]),
  })
  .passthrough();

export type SpellcastingDeclaration = z.infer<typeof spellcastingDeclarationSchema>;
export type SpellSelectionDeclaration = z.infer<typeof selectionDeclarationSchema>;

/** One spell a selection can offer, with every fact the picker needs to render it. */
export interface SelectableSpell {
  id: ID;
  label: string;
  level: number;
  ritual: boolean;
  school?: string;
  summary?: string;
  /** An effect granted this spell outright. */
  granted: boolean;
  /** A grant marked it always prepared. It can never be deselected. */
  alwaysPrepared: boolean;
  /** The player has chosen it. */
  selected: boolean;
  /**
   * Whether the player may toggle it. False for anything already granted: the
   * character has it, and offering it again would sell them something they own.
   */
  selectable: boolean;
}

/** One obligation the activated content places on the player. */
export interface RequiredSpellSelection {
  selectionId: ID;
  label: string;
  model: SpellSelectionModel;
  stepId: BuilderStepId;
  /** The class whose declaration owns this selection. Ownership for pruning. */
  classId: ID;
  /** How many the player must choose, after any granted allowance is applied. */
  required: number;
  /** Granted spells that spent part of the content's stated count, if any. */
  grantedConsumed: number;
  /** Chosen spell IDs that are still legal, sorted as the options are. */
  selected: readonly ID[];
  /**
   * Stored IDs the build can no longer justify — a spell whose list it stopped
   * reaching, or one above the level its progression now allows. Reported rather
   * than deleted, so a level restored is a selection restored.
   */
  ineligibleSelected: readonly ID[];
  /** Every spell this selection can show, granted rows included, in display order. */
  options: readonly SelectableSpell[];
  /** Highest spell level this selection currently reaches. */
  maxSpellLevel: number;
  /** Lowest spell level this selection accepts. Zero for a cantrip selection. */
  minSpellLevel: number;
  /** The level at which the content first owes this selection. */
  unlockLevel: number;
  /** Exactly the required number chosen, with nothing illegal stored. */
  resolved: boolean;
  sourceEntryId: ID;
  sourceLabel: string;
}

/** A parsed declaration together with the entry that carried it. */
interface DeclarationSource {
  declaration: SpellcastingDeclaration;
  entryId: ID;
  entryLabel: string;
}

/**
 * Every spellcasting declaration the installed content carries.
 *
 * A scan of `rule` entries, matching how the derived resolver already finds them.
 * Entries whose data does not parse are skipped rather than guessed at: a
 * malformed declaration owes nothing, which is safer than owing something
 * invented.
 */
export function spellcastingDeclarationsIn(entries: readonly ContentEntry[]): DeclarationSource[] {
  const found: DeclarationSource[] = [];
  for (const entry of entries) {
    if (entry.category !== "rule") continue;
    if ((entry.mechanics as { kind?: unknown }).kind !== "spellcasting") continue;
    const parsed = spellcastingDeclarationSchema.safeParse((entry.mechanics as { data?: unknown }).data);
    if (!parsed.success) continue;
    found.push({ declaration: parsed.data, entryId: entry.id, entryLabel: entry.name });
  }
  return found;
}

/** The declaration governing one class, when the content declares one. */
export function spellcastingDeclarationFor(
  classId: ID | undefined,
  entries: readonly ContentEntry[],
): DeclarationSource | undefined {
  if (!classId) return undefined;
  return spellcastingDeclarationsIn(entries).find(source => source.declaration.classId === classId);
}

/**
 * The selection IDs one class owns.
 *
 * The ownership rule a source change prunes by, and the same shape
 * `backgroundOwnedIds` produces for the background: a selection belongs to a
 * class because that class's declaration defines it, never because of anything
 * read from a name.
 */
export function spellSelectionsOwnedBy(
  classId: ID | undefined,
  entries: readonly ContentEntry[],
): ReadonlySet<ID> {
  const source = spellcastingDeclarationFor(classId, entries);
  return new Set(source?.declaration.selections.map(selection => selection.id) ?? []);
}

/** The cumulative row in force at a level, or undefined below the first one. */
function rowAtLevel(
  declaration: SpellSelectionDeclaration,
  level: number,
): z.infer<typeof progressionRowSchema> | undefined {
  let current: z.infer<typeof progressionRowSchema> | undefined;
  for (const row of [...declaration.progression].sort((left, right) => left.level - right.level)) {
    if (row.level > level) break;
    current = row;
  }
  return current;
}

/**
 * Whether one available spell is eligible for one selection.
 *
 * Three independent gates, all read from content: the spell must sit inside the
 * declared level band, at or below the level the progression currently reaches,
 * and — when the declaration narrows the lists — on one of those lists. A spell
 * granted outright bypasses the list gate only, because the grant is itself the
 * route: it is on the character regardless of which list names it.
 */
function isEligible(
  spell: AvailableSpell,
  declaration: SpellSelectionDeclaration,
  bounds: { min: number; max: number },
): boolean {
  if (spell.level < bounds.min || spell.level > bounds.max) return false;
  if (!declaration.spellListIds?.length) return true;
  if (spell.known) return true;
  const allowed = new Set(declaration.spellListIds);
  return spell.viaListIds.some(listId => allowed.has(listId));
}

/**
 * The obligations one build owes, planned from availability the caller already has.
 *
 * `availability` is passed in rather than recomputed: the build planner expands it
 * once per pass, and expanding it again here would double the only genuinely
 * catalogue-sized work the planner does. Everything below is set membership over
 * that projection, so a hundred-spell list and a four-spell list cost the same
 * per selection.
 */
export function planSpellSelections(
  build: CharacterDraftBuild,
  entries: readonly ContentEntry[],
  availability: SpellAvailability,
): RequiredSpellSelection[] {
  const source = spellcastingDeclarationFor(build.classId, entries);
  if (!source || !build.classId) return [];

  const stored = build.spellSelections ?? {};
  const planned: RequiredSpellSelection[] = [];

  for (const declaration of source.declaration.selections) {
    const row = rowAtLevel(declaration, build.level);
    // Below the first progression row the selection does not exist yet. It is
    // omitted rather than shown as zero, so an unreached obligation cannot read
    // as a satisfied one.
    if (!row) continue;

    const minSpellLevel = declaration.spellLevels?.min ?? 0;
    const maxSpellLevel = row.maxSpellLevel ?? declaration.spellLevels?.max ?? 9;
    const bounds = { min: minSpellLevel, max: maxSpellLevel };

    const eligible = availability.spells.filter(spell => isEligible(spell, declaration, bounds));
    const eligibleIds = new Set(eligible.map(spell => spell.id));

    // A granted spell is the character's already. It is never selectable, and it
    // spends the allowance only when the declaration says it does.
    const grantedIds = new Set(eligible.filter(spell => spell.known || spell.alwaysPrepared).map(spell => spell.id));
    const grantedConsumed = declaration.grantedConsumesAllowance ? grantedIds.size : 0;
    const required = Math.max(0, row.count - grantedConsumed);

    const storedIds = stored[declaration.id] ?? [];
    const selectedIds = storedIds.filter(id => eligibleIds.has(id) && !grantedIds.has(id));
    const ineligible = storedIds.filter(id => !eligibleIds.has(id) || grantedIds.has(id));
    const selectedSet = new Set(selectedIds);

    const options: SelectableSpell[] = eligible.map(spell => {
      const granted = spell.known;
      const alwaysPrepared = spell.alwaysPrepared;
      return {
        id: spell.id,
        label: spell.label,
        level: spell.level,
        ritual: spell.ritual,
        ...(spell.school ? { school: spell.school } : {}),
        ...(spell.summary ? { summary: spell.summary } : {}),
        granted,
        alwaysPrepared,
        selected: selectedSet.has(spell.id),
        selectable: !granted && !alwaysPrepared,
      };
    });

    planned.push({
      selectionId: declaration.id,
      label: declaration.label,
      model: declaration.model,
      stepId: SPELL_SELECTION_STEP,
      classId: build.classId,
      required,
      grantedConsumed,
      selected: selectedIds,
      ineligibleSelected: [...ineligible].sort(),
      options,
      maxSpellLevel,
      minSpellLevel,
      unlockLevel: Math.min(...declaration.progression.map(item => item.level)),
      /*
       * Exactly the required count, and nothing stored that the build cannot
       * justify. Under-selection and over-selection are both unresolved, which is
       * what stops "more than N" from quietly reading as finished, and a stored
       * spell that stopped being legal keeps the obligation open rather than
       * disappearing from the user's view along with the reason it was raised.
       */
      resolved: selectedIds.length === required && ineligible.length === 0,
      sourceEntryId: source.entryId,
      sourceLabel: source.entryLabel,
    });
  }

  return planned;
}

/**
 * The spells a resolved build ends up holding, classified.
 *
 * The single projection both the commit path and the derived sheet read, so a
 * spell cannot be *known* during creation and something else afterwards. Granted
 * and selected spells are merged on spell ID, which is what keeps one canonical
 * identity when a spell is reached by more than one route.
 *
 * Availability alone contributes nothing. A spell the character may learn is not
 * a spell the character has, and this function is the boundary where that stops
 * being true only for the rows that earned it.
 */
export interface CharacterSpellState {
  spellId: ID;
  known: boolean;
  prepared: boolean;
  alwaysPrepared: boolean;
  granted: boolean;
  /** The selection the player chose it through, when they chose it. */
  viaSelectionId?: ID;
}

/** One answered selection, reduced to what classification actually needs. */
export interface AnsweredSelection {
  selectionId: ID;
  model: SpellSelectionModel;
  spellIds: readonly ID[];
}

/**
 * The answers a committed record holds, paired with the model that governs each.
 *
 * The record stores spell IDs under a selection ID and nothing else, so the model
 * has to be read back from the declaration. A stored selection the declaration no
 * longer defines contributes nothing rather than defaulting to a model: guessing
 * `known` for something the content may have meant as `prepared` would put a
 * spell in the wrong half of the sheet.
 */
export function answeredSelectionsFor(
  spellSelections: Readonly<Record<ID, readonly ID[]>> | undefined,
  declaration: SpellcastingDeclaration | undefined,
): AnsweredSelection[] {
  if (!spellSelections || !declaration) return [];
  const models = new Map(declaration.selections.map(selection => [selection.id, selection.model]));
  const answered: AnsweredSelection[] = [];
  for (const selectionId of Object.keys(spellSelections).sort()) {
    const model = models.get(selectionId);
    if (!model) continue;
    const spellIds = spellSelections[selectionId] ?? [];
    if (spellIds.length) answered.push({ selectionId, model, spellIds });
  }
  return answered;
}

export function characterSpellStates(
  answered: readonly AnsweredSelection[],
  granted: { spells: ReadonlySet<ID>; alwaysPrepared: ReadonlySet<ID> },
): CharacterSpellState[] {
  const states = new Map<ID, CharacterSpellState>();
  const ensure = (spellId: ID): CharacterSpellState => {
    const existing = states.get(spellId);
    if (existing) return existing;
    const created: CharacterSpellState = {
      spellId,
      known: false,
      prepared: false,
      alwaysPrepared: false,
      granted: false,
    };
    states.set(spellId, created);
    return created;
  };

  // Grants first, so a spell that is both granted and selected keeps both facts
  // on one row rather than producing two.
  for (const spellId of [...granted.spells, ...granted.alwaysPrepared]) {
    const state = ensure(spellId);
    state.granted = true;
    state.known = true;
    if (granted.alwaysPrepared.has(spellId)) {
      state.alwaysPrepared = true;
      state.prepared = true;
    }
  }

  for (const selection of answered)
    for (const spellId of selection.spellIds) {
      const state = ensure(spellId);
      state.viaSelectionId = selection.selectionId;
      if (selection.model === "known") state.known = true;
      else state.prepared = true;
    }

  return [...states.values()].sort((left, right) => left.spellId.localeCompare(right.spellId));
}
