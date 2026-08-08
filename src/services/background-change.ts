/**
 * Changing the background, and clearing what the old one owned.
 *
 * A background owns more than its own identity: the decisions it declares, the
 * decisions its origin feat declares, the equipment choices inside the kits it
 * grants, and the ability increases its declared pattern authorises. Replacing
 * the background used to leave all of that in the draft. The planner stopped
 * *reporting* it, because an unreachable choice is not walked — but the values
 * were still written, still committed, and still there if the user changed back
 * through a third background that happened to reuse an ID.
 *
 * Hiding is not removing. This module removes.
 *
 * Two properties are load-bearing and both are tested directly:
 *
 * - **Deterministic.** Ownership is computed by walking typed structure in
 *   declaration order. The same draft and the same content always produce the
 *   same patch, with no dependence on object key order or on which screen the
 *   change was made from.
 * - **Idempotent.** Applying the result twice changes nothing the second time.
 *   What the outgoing background owned is gone after one pass, so a repeated
 *   change — or a re-render that reissues the same patch — cannot cascade into
 *   deleting something a later background legitimately owns.
 *
 * What it deliberately does not touch: species, class and subclass identity,
 * base ability scores, identity fields, and any selection the incoming
 * background also owns. A shared ID is shared on purpose, and clearing it would
 * discard a decision that is still valid.
 *
 * Grants are not pruned because grants are not stored. Proficiencies, features
 * and equipment granted by a background are derived from the activation plan on
 * every read, so replacing the background stops granting them with no state to
 * clean up. Only the user's own answers persist, and those are what this clears.
 */
import { backgroundMechanicsSchema } from "@/src/domain/content-pack";
import { ABILITIES, type CharacterDraftBuild } from "@/src/domain/character-record";
import type { Ability, ChoiceDefinition, ContentEntry, EquipmentBundleNode, ID } from "@/src/domain/model";
import { originIncreasePatternFor } from "@/src/services/ability-allocation";

/** What a background change removed, for a caller that has to explain itself. */
export interface BackgroundPruneNote {
  kind: "choice" | "equipment-choice" | "ability-increase";
  /** A stable ID, or an ability name. Never a stored value or private text. */
  recordId: string;
}

export interface BackgroundChangeResult {
  build: CharacterDraftBuild;
  removed: readonly BackgroundPruneNote[];
}

/** Every choice ID in one choice tree, including nested and per-option children. */
function collectChoiceIds(choice: ChoiceDefinition, into: Set<ID>): void {
  into.add(choice.id);
  for (const child of choice.childChoices ?? []) collectChoiceIds(child, into);
  for (const option of choice.options) for (const child of option.childChoices ?? []) collectChoiceIds(child, into);
}

/** Every equipment-choice ID in one bundle tree. */
function collectEquipmentChoiceIds(node: EquipmentBundleNode, into: Set<ID>): void {
  if (node.type === "choice") {
    into.add(node.id);
    for (const option of node.options) for (const child of option.entries) collectEquipmentChoiceIds(child, into);
    return;
  }
  if (node.type === "bundle") for (const child of node.entries) collectEquipmentChoiceIds(child, into);
}

/**
 * Everything one background owns the answers to.
 *
 * The walk follows the same typed routes the activation planner follows — the
 * background's own choices, the feat it declares, and the entries its options
 * activate — so a decision belongs to a background for exactly the reason the
 * planner says it does. Nothing is matched by name, and the visited set makes
 * the walk terminate on content that refers back to itself.
 */
export function backgroundOwnedIds(
  backgroundId: ID | undefined,
  entries: readonly ContentEntry[],
): { choiceIds: ReadonlySet<ID>; equipmentChoiceIds: ReadonlySet<ID> } {
  const choiceIds = new Set<ID>();
  const equipmentChoiceIds = new Set<ID>();
  if (!backgroundId) return { choiceIds, equipmentChoiceIds };

  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const background = byId.get(backgroundId);
  if (background?.category !== "background") return { choiceIds, equipmentChoiceIds };

  const visited = new Set<ID>();
  const queue: ID[] = [backgroundId];

  const mechanics = backgroundMechanicsSchema.safeParse(background.mechanics);
  if (mechanics.success) {
    queue.push(mechanics.data.featId);
    // Kits the background grants by reference rather than by declaring inline.
    for (const bundleId of mechanics.data.equipmentBundleIds)
      for (const entry of entries)
        for (const bundle of entry.equipmentBundles ?? [])
          if (bundle.id === bundleId) for (const node of bundle.entries) collectEquipmentChoiceIds(node, equipmentChoiceIds);
    for (const choiceId of mechanics.data.equipmentChoiceIds) equipmentChoiceIds.add(choiceId);
  }

  while (queue.length) {
    const id = queue.shift() as ID;
    if (visited.has(id)) continue;
    visited.add(id);
    const entry = byId.get(id);
    if (!entry) continue;

    for (const choice of entry.choices) {
      collectChoiceIds(choice, choiceIds);
      // An option that activates another entry brings that entry's own
      // decisions under this background too.
      for (const option of choice.options) if (option.entryId) queue.push(option.entryId);
    }
    for (const bundle of entry.equipmentBundles ?? [])
      for (const node of bundle.entries) collectEquipmentChoiceIds(node, equipmentChoiceIds);
  }

  return { choiceIds, equipmentChoiceIds };
}

/**
 * The draft patch for changing the background.
 *
 * An ID owned by both the outgoing and the incoming background is left alone:
 * the answer is still authorised, and clearing it would throw away work for no
 * reason. Ability increases are re-judged against the incoming background's own
 * declared distributions, so an allocation the new background still allows
 * survives the change intact and only the unauthorised part is dropped.
 */
export function changeBackground(
  build: CharacterDraftBuild,
  nextBackgroundId: ID | undefined,
  entries: readonly ContentEntry[],
): BackgroundChangeResult {
  const removed: BackgroundPruneNote[] = [];
  const outgoing = backgroundOwnedIds(build.backgroundId, entries);
  const incoming = backgroundOwnedIds(nextBackgroundId, entries);

  const choiceSelections: Record<ID, readonly ID[]> = {};
  for (const key of Object.keys(build.choiceSelections).sort()) {
    if (outgoing.choiceIds.has(key) && !incoming.choiceIds.has(key)) {
      removed.push({ kind: "choice", recordId: key });
      continue;
    }
    choiceSelections[key] = build.choiceSelections[key];
  }

  const equipmentSelections: Record<ID, readonly ID[]> = {};
  for (const key of Object.keys(build.equipmentSelections).sort()) {
    if (outgoing.equipmentChoiceIds.has(key) && !incoming.equipmentChoiceIds.has(key)) {
      removed.push({ kind: "equipment-choice", recordId: key });
      continue;
    }
    equipmentSelections[key] = build.equipmentSelections[key];
  }

  /*
   * Ability increases are re-judged against the incoming background alone.
   * `originIncreasePatternFor` reads the background the build is moving to, so
   * the surviving set is exactly what that background authorises — and the base
   * scores, which no background owns, are untouched either way.
   */
  const next = { ...build, backgroundId: nextBackgroundId };
  const pattern = originIncreasePatternFor(next, entries);
  const abilityIncreases: Partial<Record<Ability, number>> = {};
  if (pattern) {
    const offered = new Set(pattern.abilities);
    // The most permissive distribution the incoming background offers decides
    // what may survive; which one the user ends up in is settled on Abilities.
    const allowance = new Map<number, number>();
    for (const amounts of pattern.patterns) {
      const counts = new Map<number, number>();
      for (const amount of amounts) counts.set(amount, (counts.get(amount) ?? 0) + 1);
      for (const [amount, count] of counts) allowance.set(amount, Math.max(allowance.get(amount) ?? 0, count));
    }
    const used = new Map<number, number>();
    for (const ability of ABILITIES) {
      const amount = build.abilityIncreases[ability];
      if (typeof amount !== "number") continue;
      const spent = used.get(amount) ?? 0;
      if (!offered.has(ability) || spent >= (allowance.get(amount) ?? 0)) {
        removed.push({ kind: "ability-increase", recordId: ability });
        continue;
      }
      used.set(amount, spent + 1);
      abilityIncreases[ability] = amount;
    }
  } else
    for (const ability of ABILITIES)
      if (typeof build.abilityIncreases[ability] === "number")
        removed.push({ kind: "ability-increase", recordId: ability });

  // Finals are always base plus what survived, so a dropped increase stops
  // contributing to a score rather than staying baked into a committed total.
  const abilityScores: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) {
    const base = build.abilityBaseScores[ability];
    if (typeof base === "number") abilityScores[ability] = base + (abilityIncreases[ability] ?? 0);
  }

  return {
    build: {
      ...build,
      backgroundId: nextBackgroundId,
      choiceSelections,
      equipmentSelections,
      abilityIncreases,
      // Untouched, and stated explicitly because it is the thing this must
      // never disturb: what the user rolled or assigned is not the background's.
      abilityBaseScores: { ...build.abilityBaseScores },
      abilityScores,
    },
    removed,
  };
}
