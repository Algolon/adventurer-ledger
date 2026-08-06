/**
 * The one armour-context resolver.
 *
 * Planning, Review, commit and the final derivation all read the armour context
 * from here, so an armour-dependent effect cannot activate on one surface and
 * stay dormant on another. The engine previously hard-coded `{ worn: false }` in
 * both the derivation and the planning paths, which meant every `wearingArmor`
 * condition evaluated false however the build was equipped.
 *
 * ## What decides the answer
 *
 * Only typed mechanics. An item contributes to the armour context when it is a
 * content entry in the `armor` category whose mechanics parse, and when the
 * build's own equipment resolution marks it `equipped` — the explicit typed worn
 * marker the equipment model already carries. Names, labels, slugs and IDs are
 * never inspected.
 *
 * ## Shields are not body armour
 *
 * `worn` answers "is body armour being worn", and `type` is that body armour's
 * declared category. A shield sets `shield` and nothing else, so a shield alone
 * cannot satisfy a body-armour condition. Weapons, tools and ordinary gear
 * contribute nothing at all, however they are carried.
 *
 * ## Ambiguity is reported, not resolved
 *
 * The public equipment model has one worn marker per item and no notion of an
 * armour slot, so two body armours marked `equipped` is a state it cannot
 * decide between. Picking one by array order or by ID would be a silent guess.
 * Instead `ambiguous` is set, `type` is withheld, and the caller reports the
 * case. `worn` stays true because armour is certainly being worn — only *which*
 * is unanswerable.
 */
import { z } from "zod";
import type { Condition, ContentEntry, EquipmentBundleDefinition, ID } from "@/src/domain/model";
import { resolveEquipmentBundles, type EquipmentChoiceSelections, type ResolvedEquipmentItem } from "@/src/rules/equipment";

export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

/** The armour facts the rules engine evaluates conditions against. */
export interface ArmorContext {
  /** True when body armour is worn. A shield alone never sets this. */
  worn: boolean;
  /** The worn body armour's declared category, when exactly one is determined. */
  type?: ArmorCategory;
  /** True when a shield is worn. Independent of `worn`. */
  shield: boolean;
  /** True when more than one body armour is marked worn and none can be chosen. */
  ambiguous: boolean;
}

export interface ResolvedArmorPiece {
  itemId: ID;
  label: string;
  sourceId?: ID;
  category: ArmorCategory;
  baseArmorClass: number;
  dexterity: "none" | "full" | "max-2";
}

export interface ArmorResolution {
  context: ArmorContext;
  /** Worn body armour, in stable ID order. More than one entry is ambiguous. */
  body: readonly ResolvedArmorPiece[];
  /** Worn shields, in stable ID order. */
  shields: readonly ResolvedArmorPiece[];
}

/** No armour worn. The honest starting point, and the answer for an empty build. */
export const NO_ARMOR_CONTEXT: ArmorContext = Object.freeze({ worn: false, shield: false, ambiguous: false });

export const NO_ARMOR_RESOLUTION: ArmorResolution = Object.freeze({
  context: NO_ARMOR_CONTEXT,
  body: Object.freeze([]) as readonly ResolvedArmorPiece[],
  shields: Object.freeze([]) as readonly ResolvedArmorPiece[],
});

const armorMechanicsSchema = z.object({
  category: z.enum(["light", "medium", "heavy", "shield"]),
  baseArmorClass: z.number().int(),
  dexterity: z.enum(["none", "full", "max-2"]),
});

/** Categories the equipment resolver may draw a concrete item from. */
const ITEM_CATEGORIES: ReadonlySet<ContentEntry["category"]> = new Set<ContentEntry["category"]>([
  "item",
  "weapon",
  "armor",
  "tool",
]);

/** True when two contexts describe the same armour state. */
export function sameArmorContext(left: ArmorContext, right: ArmorContext): boolean {
  return left.worn === right.worn && left.type === right.type && left.shield === right.shield && left.ambiguous === right.ambiguous;
}

/** True when a declarative condition reads the armour context at any depth. */
export function conditionReadsArmor(condition: Condition | undefined): boolean {
  if (!condition) return false;
  if ("all" in condition) return condition.all.some(conditionReadsArmor);
  if ("any" in condition) return condition.any.some(conditionReadsArmor);
  if ("not" in condition) return conditionReadsArmor(condition.not);
  return condition.type === "wearingArmor";
}

/**
 * True when any entry gates its own activation on armour.
 *
 * Planning only needs to repeat its walk with a resolved armour context when
 * some prerequisite would actually read it. Content that never mentions armour
 * pays nothing for the correction.
 */
export function entriesGateOnArmor(entries: readonly ContentEntry[]): boolean {
  return entries.some(entry => entry.prerequisites.some(prerequisite => conditionReadsArmor(prerequisite.condition)));
}

/**
 * The authoritative resolution: typed equipped items to an armour context.
 *
 * `items` is a build's own resolved equipment, so the caller has already applied
 * whatever bundle choices the user made. Anything not marked `equipped` is
 * carried rather than worn and contributes nothing.
 */
export function armorContextFor(
  items: readonly ResolvedEquipmentItem[],
  byId: ReadonlyMap<ID, ContentEntry>,
): ArmorResolution {
  const worn: ResolvedArmorPiece[] = [];
  const seen = new Set<ID>();
  for (const item of items) {
    if (item.status !== "equipped" || seen.has(item.itemId)) continue;
    const definition = byId.get(item.itemId);
    if (!definition || definition.category !== "armor") continue;
    const parsed = armorMechanicsSchema.safeParse(definition.mechanics);
    if (!parsed.success) continue;
    seen.add(item.itemId);
    worn.push({
      itemId: item.itemId,
      label: definition.name,
      ...(definition.sourceId ? { sourceId: definition.sourceId } : {}),
      category: parsed.data.category,
      baseArmorClass: parsed.data.baseArmorClass,
      dexterity: parsed.data.dexterity,
    });
  }
  worn.sort((left, right) => left.itemId.localeCompare(right.itemId));
  const body = worn.filter(piece => piece.category !== "shield");
  const shields = worn.filter(piece => piece.category === "shield");
  const categories = new Set(body.map(piece => piece.category));
  const ambiguous = body.length > 1;
  return {
    context: {
      worn: body.length > 0,
      // Withheld when two worn body armours disagree about the category; kept
      // when they agree, because then the category itself is not in doubt.
      ...(categories.size === 1 ? { type: [...categories][0] } : {}),
      shield: shields.length > 0,
      ambiguous,
    },
    body,
    shields,
  };
}

/**
 * The planning-side adapter.
 *
 * Creation planning has no effect run to collect granted bundles from, so it
 * reads the same two declarative sources the derivation does — a
 * `grantEquipmentBundle` effect, and a category's own `equipmentBundleIds` —
 * off the entries the activation walk found. The resolution itself is the same
 * function, so planning and derivation cannot drift into different answers.
 *
 * The one place the two can differ is a bundle granted by a *conditional*
 * effect: planning reads the declaration, the derivation reads whether the
 * effect applied. That is the same approximation the existing equipment-grant
 * views already make, and no public content declares such a grant.
 */
export function armorContextForEntries(
  activeEntries: readonly ContentEntry[],
  allEntries: readonly ContentEntry[],
  equipmentSelections: EquipmentChoiceSelections,
): ArmorResolution {
  const requested = new Set<ID>();
  for (const entry of activeEntries) {
    for (const effect of entry.effects) if (effect.type === "grantEquipmentBundle") requested.add(effect.bundleId);
    const declared = (entry.mechanics as { equipmentBundleIds?: unknown }).equipmentBundleIds;
    if (Array.isArray(declared)) for (const id of declared) if (typeof id === "string") requested.add(id);
  }
  if (!requested.size) return NO_ARMOR_RESOLUTION;
  const definitions: EquipmentBundleDefinition[] = allEntries.flatMap(entry => entry.equipmentBundles ?? []);
  const availableItemIds = new Set(allEntries.filter(entry => ITEM_CATEGORIES.has(entry.category)).map(entry => entry.id));
  const resolution = resolveEquipmentBundles([...requested].sort(), definitions, equipmentSelections, availableItemIds);
  return armorContextFor(resolution.items, new Map(allEntries.map(entry => [entry.id, entry])));
}
