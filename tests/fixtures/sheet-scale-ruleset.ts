/**
 * A ruleset built to make the character sheet *large*.
 *
 * Every other fixture in this repository answers a question about correctness.
 * This one answers a question about scale: what the sheet looks like when a
 * character has twelve levels of features behind it, four different limited-use
 * resources, a two-page inventory, or thirty-odd spells spread over six spell
 * levels and five separate slot pools.
 *
 * The content this app ships cannot produce that. The seeded synthetic slice
 * stops at level 2 with four spells and one resource; the acceptance slice
 * reaches level 5 and does not cast at all. So the shapes are built here:
 *
 * - **Bastionward**, a martial class covering levels 1–12. Twelve levels of
 *   automatic features, a subclass at level 3, four resources that recharge four
 *   different ways, attacks in every action category, and a starting kit dense
 *   enough that Inventory has to group rather than list.
 * - **Runespeaker**, a full caster covering levels 1–9. Five slot pools, one per
 *   spell level, and a repertoire of thirty spells across levels 0–5 — enough
 *   that the Spells workspace has to be navigable rather than merely complete.
 *
 * Both are original material written for these tests. No name, number, feature,
 * spell or item here is transcribed from, derived from, or named after any
 * published rulebook, and nothing in it is a rendering of private content.
 *
 * The pack is installed through the ordinary import pipeline in the specs that
 * use it, so what the sheet renders has been through the same validation,
 * scoping and ruleset activation as any pack a user would import.
 */
import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import type { ContentEntry, Effect } from "@/src/domain/model";

const AT = "2026-08-09T09:00:00.000Z";
const VERSION = "1.0.0";

export const SCALE_SOURCE_ID = "source:wardenreach-scale";
export const SCALE_PACK_ID = "pack:wardenreach-scale";
export const SCALE_PACK_NAME = "Wardenreach scale slice";
/** The profile ID `rulesetIdForPack` derives for this pack. */
export const SCALE_RULESET_ID = `ruleset:${SCALE_PACK_ID}`;

export const SCALE_IDS = {
  martial: "class:ws-bastionward",
  martialSubclass: "subclass:ws-shieldwall",
  caster: "class:ws-runespeaker",
  casterSubclass: "subclass:ws-deepscript",
  species: "species:ws-holdborn",
  background: "background:ws-toll-warden",
  backgroundFeat: "feat:ws-long-watch",
  spellcastingRule: "rule:ws-runespeaking",
  spellList: "spell-list:ws-deep-script",
} as const;

export const SCALE_CHOICES = {
  martialSkills: "choice:ws-bastionward-skills",
  casterSkills: "choice:ws-runespeaker-skills",
} as const;

/** The four Bastionward resources, one per recharge behaviour the engine knows. */
export const SCALE_RESOURCES = {
  /** Short rest: the bread-and-butter pool a player spends constantly. */
  bracing: "resource:ws-bracing",
  /** Long rest: the once-a-day pool. */
  bulwark: "resource:ws-bulwark",
  /** Dawn: recovers on neither rest, so a long rest must not silently fill it. */
  tollLight: "resource:ws-toll-light",
  /** Manual: the engine recharges it on nothing, so only the player can. */
  wardenSeal: "resource:ws-warden-seal",
} as const;

/** One slot pool per spell level the Runespeaker reaches. */
export const SCALE_SLOTS = {
  1: "resource:ws-script-slots-1",
  2: "resource:ws-script-slots-2",
  3: "resource:ws-script-slots-3",
  4: "resource:ws-script-slots-4",
  5: "resource:ws-script-slots-5",
} as const;

export const SCALE_ARRAY: readonly number[] = [15, 14, 13, 12, 10, 8];

/** Levels each class covers. The martial is the deliberate long one. */
export const MARTIAL_MAX_LEVEL = 12;
export const CASTER_MAX_LEVEL = 9;

/** Per-level class hit-point base, level-keyed as everywhere else in the app. */
const MARTIAL_HIT_POINT_BASE: Readonly<Record<number, number>> = {
  1: 10, 2: 16, 3: 22, 4: 28, 5: 34, 6: 40, 7: 46, 8: 52, 9: 58, 10: 64, 11: 70, 12: 76,
};
const CASTER_HIT_POINT_BASE: Readonly<Record<number, number>> = {
  1: 6, 2: 10, 3: 14, 4: 18, 5: 22, 6: 26, 7: 30, 8: 34, 9: 38,
};

/** Per-level maxima for each Bastionward resource. */
const BRACING: Readonly<Record<number, number>> = { 1: 2, 3: 3, 5: 4, 8: 5, 11: 6 };
const BULWARK: Readonly<Record<number, number>> = { 2: 1, 6: 2, 10: 3 };
const TOLL_LIGHT: Readonly<Record<number, number>> = { 4: 2, 9: 3 };
const WARDEN_SEAL: Readonly<Record<number, number>> = { 7: 1, 12: 2 };

/**
 * Slots per spell level, by class level. Only the pools a level has reached
 * appear, so a level 9 Runespeaker carries five pools and a level 1 carries one.
 */
const SLOT_TABLE: Readonly<Record<1 | 2 | 3 | 4 | 5, Readonly<Record<number, number>>>> = {
  1: { 1: 2, 2: 3, 3: 4 },
  2: { 3: 2, 4: 3 },
  3: { 5: 2, 6: 3 },
  4: { 7: 1, 8: 2 },
  5: { 9: 1 },
};

const entry = (
  partial: Pick<ContentEntry, "id" | "slug" | "name" | "category" | "mechanics"> & Partial<ContentEntry>,
): ContentEntry => ({
  aliases: [],
  rulesEdition: "homebrew",
  sourceId: SCALE_SOURCE_ID,
  sourceLocator: { sourceId: SCALE_SOURCE_ID, page: "1", section: "Scale slice" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 40, conflictKey: partial.id, resolution: "source-priority" },
  tags: ["synthetic", "wardenreach-scale"],
  version: VERSION,
  revision: 1,
  editionRelations: [],
  legacy: false,
  optional: false,
  private: false,
  exportRestricted: false,
  createdAt: AT,
  updatedAt: AT,
  ...partial,
});

/** `ability:<name>` is the tag convention the resolver reads for saves and skills. */
const proficiency = (id: string, slug: string, name: string, type: string, key: string, ability?: string) =>
  entry({
    id,
    slug,
    name,
    category: "proficiency",
    mechanics: { type, key },
    ...(ability ? { tags: ["synthetic", "wardenreach-scale", `ability:${ability}`] } : {}),
  });

export const SCALE_PROFICIENCIES = {
  saveStrength: "proficiency:ws-save-strength",
  saveDexterity: "proficiency:ws-save-dexterity",
  saveConstitution: "proficiency:ws-save-constitution",
  saveIntelligence: "proficiency:ws-save-intelligence",
  saveWisdom: "proficiency:ws-save-wisdom",
  saveCharisma: "proficiency:ws-save-charisma",
  armorLight: "proficiency:ws-armor-light",
  armorMedium: "proficiency:ws-armor-medium",
  armorHeavy: "proficiency:ws-armor-heavy",
  armorShield: "proficiency:ws-armor-shield",
  weaponSimple: "proficiency:ws-weapon-simple",
  weaponMartial: "proficiency:ws-weapon-martial",
  toolMason: "proficiency:ws-tool-mason",
  toolScribe: "proficiency:ws-tool-scribe",
  toolCartwright: "proficiency:ws-tool-cartwright",
  languageHoldspeech: "proficiency:ws-language-holdspeech",
  languageTollCant: "proficiency:ws-language-toll-cant",
  languageDeepMarks: "proficiency:ws-language-deep-marks",
} as const;

/** Twelve skills, so the Overview list is a real list rather than a stub. */
export const SCALE_SKILLS: readonly { id: string; label: string; ability: string }[] = [
  { id: "proficiency:ws-skill-gatecraft", label: "Gatecraft", ability: "strength" },
  { id: "proficiency:ws-skill-haulage", label: "Haulage", ability: "strength" },
  { id: "proficiency:ws-skill-footwork", label: "Footwork", ability: "dexterity" },
  { id: "proficiency:ws-skill-quiet-step", label: "Quiet Step", ability: "dexterity" },
  { id: "proficiency:ws-skill-endurance", label: "Endurance", ability: "constitution" },
  { id: "proficiency:ws-skill-holdlore", label: "Holdlore", ability: "intelligence" },
  { id: "proficiency:ws-skill-stonecraft", label: "Stonecraft", ability: "intelligence" },
  { id: "proficiency:ws-skill-deep-script", label: "Deep Script", ability: "intelligence" },
  { id: "proficiency:ws-skill-watchcraft", label: "Watchcraft", ability: "wisdom" },
  { id: "proficiency:ws-skill-beastlore", label: "Beastlore", ability: "wisdom" },
  { id: "proficiency:ws-skill-parley", label: "Parley", ability: "charisma" },
  { id: "proficiency:ws-skill-command", label: "Command", ability: "charisma" },
];

const slugOf = (label: string) => `ws-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const proficiencyEntries: ContentEntry[] = [
  proficiency(SCALE_PROFICIENCIES.saveStrength, "ws-save-strength", "Strength save", "save", "strength", "strength"),
  proficiency(SCALE_PROFICIENCIES.saveDexterity, "ws-save-dexterity", "Dexterity save", "save", "dexterity", "dexterity"),
  proficiency(SCALE_PROFICIENCIES.saveConstitution, "ws-save-constitution", "Constitution save", "save", "constitution", "constitution"),
  proficiency(SCALE_PROFICIENCIES.saveIntelligence, "ws-save-intelligence", "Intelligence save", "save", "intelligence", "intelligence"),
  proficiency(SCALE_PROFICIENCIES.saveWisdom, "ws-save-wisdom", "Wisdom save", "save", "wisdom", "wisdom"),
  proficiency(SCALE_PROFICIENCIES.saveCharisma, "ws-save-charisma", "Charisma save", "save", "charisma", "charisma"),
  ...SCALE_SKILLS.map(skill => proficiency(skill.id, slugOf(skill.label), skill.label, "skill", slugOf(skill.label), skill.ability)),
  proficiency(SCALE_PROFICIENCIES.armorLight, "ws-armor-light", "Light armour", "armor", "light"),
  proficiency(SCALE_PROFICIENCIES.armorMedium, "ws-armor-medium", "Medium armour", "armor", "medium"),
  proficiency(SCALE_PROFICIENCIES.armorHeavy, "ws-armor-heavy", "Heavy armour", "armor", "heavy"),
  proficiency(SCALE_PROFICIENCIES.armorShield, "ws-armor-shield", "Shields", "armor", "shield"),
  proficiency(SCALE_PROFICIENCIES.weaponSimple, "ws-weapon-simple", "Simple weapons", "weapon", "simple"),
  proficiency(SCALE_PROFICIENCIES.weaponMartial, "ws-weapon-martial", "Martial weapons", "weapon", "martial"),
  proficiency(SCALE_PROFICIENCIES.toolMason, "ws-tool-mason", "Mason's tools", "tool", "mason"),
  proficiency(SCALE_PROFICIENCIES.toolScribe, "ws-tool-scribe", "Scribe's tools", "tool", "scribe"),
  proficiency(SCALE_PROFICIENCIES.toolCartwright, "ws-tool-cartwright", "Cartwright's tools", "tool", "cartwright"),
  proficiency(SCALE_PROFICIENCIES.languageHoldspeech, "ws-language-holdspeech", "Holdspeech", "language", "holdspeech"),
  proficiency(SCALE_PROFICIENCIES.languageTollCant, "ws-language-toll-cant", "Toll Cant", "language", "toll-cant"),
  proficiency(SCALE_PROFICIENCIES.languageDeepMarks, "ws-language-deep-marks", "Deep Marks", "language", "deep-marks"),
];

const grant = (proficiencyId: string): Effect => ({
  id: `effect:ws-grant-${proficiencyId.split(":").pop()}`,
  type: "grantProficiency",
  proficiencyId,
});

/** A level-keyed scaling effect, the app's own idiom for "this grows". */
const scaled = (id: string, target: string, label: string, table: Readonly<Record<number, number>>): Effect => ({
  id,
  type: "scaleAtLevel",
  scope: "class",
  target,
  levels: Object.fromEntries(Object.entries(table).map(([level, value]) => [level, { kind: "literal", value }])),
  label,
});

// ---- items ------------------------------------------------------------------

/**
 * A deliberately dense kit. Inventory's job is to stay operable when a player
 * has been adventuring for a while, and eleven lines is where a flat list of
 * bordered cards stops being one.
 */
export const SCALE_ITEMS = {
  greatShield: "armor:ws-toll-shield",
  plate: "armor:ws-hold-plate",
  scriptVest: "armor:ws-script-vest",
  poleaxe: "weapon:ws-warden-poleaxe",
  handaxe: "weapon:ws-belt-axe",
  scriptRod: "weapon:ws-script-rod",
} as const;

/** Carried gear, in the order a kit lists it. */
const CARRIED_GEAR: readonly { id: string; name: string; summary: string; quantity: number }[] = [
  { id: "item:ws-toll-ledger", name: "Toll ledger", summary: "The crossing's book, kept in a waxed case.", quantity: 1 },
  { id: "item:ws-lamp-oil", name: "Lamp oil", summary: "Sealed flasks for a long watch.", quantity: 4 },
  { id: "item:ws-chalk-sticks", name: "Chalk sticks", summary: "For marking a wall that will be rained on.", quantity: 8 },
  { id: "item:ws-rope-coil", name: "Rope coil", summary: "Fifty feet of hemp, whipped at both ends.", quantity: 1 },
  { id: "item:ws-iron-spikes", name: "Iron spikes", summary: "Driven to hold a door that will not hold itself.", quantity: 6 },
  { id: "item:ws-ration-bundle", name: "Ration bundle", summary: "A day of hard bread, salt fish and dried fruit.", quantity: 5 },
  { id: "item:ws-bandage-roll", name: "Bandage roll", summary: "Boiled linen, rolled tight.", quantity: 3 },
  { id: "item:ws-signal-horn", name: "Signal horn", summary: "One long note carries the length of the reach.", quantity: 1 },
  { id: "item:ws-whetstone", name: "Whetstone", summary: "A fine grey stone in an oiled cloth.", quantity: 1 },
  { id: "item:ws-tinder-tin", name: "Tinder tin", summary: "Char cloth, flint and a steel striker.", quantity: 1 },
  { id: "item:ws-warden-cloak", name: "Warden cloak", summary: "Oiled wool, cut to clear a shield arm.", quantity: 1 },
];

const itemEntries: ContentEntry[] = [
  entry({
    id: SCALE_ITEMS.plate,
    slug: "ws-hold-plate",
    name: "Hold Plate",
    category: "armor",
    summary: "Riveted plate made in the hold's own forge, fitted over a padded coat.",
    mechanics: { category: "heavy", baseArmorClass: 17, dexterity: "none", stealthDisadvantage: true, weight: 65, costGp: 750 },
  }),
  entry({
    id: SCALE_ITEMS.greatShield,
    slug: "ws-toll-shield",
    name: "Toll Shield",
    category: "armor",
    summary: "A tall shield bearing the crossing's mark, braced for a bridge fight.",
    mechanics: { category: "shield", baseArmorClass: 2, dexterity: "none", stealthDisadvantage: false, weight: 8, costGp: 12 },
  }),
  entry({
    id: SCALE_ITEMS.scriptVest,
    slug: "ws-script-vest",
    name: "Script Vest",
    category: "armor",
    summary: "A quilted vest with worked marks stitched through the lining.",
    mechanics: { category: "light", baseArmorClass: 12, dexterity: "full", stealthDisadvantage: false, weight: 9, costGp: 45 },
  }),
  entry({
    id: SCALE_ITEMS.poleaxe,
    slug: "ws-warden-poleaxe",
    name: "Warden Poleaxe",
    category: "weapon",
    summary: "A long haft with an axe head and a spike, made for holding a line.",
    mechanics: { category: "martial", usage: "melee", damage: { dice: "1d10", type: "slashing" }, properties: ["heavy", "reach"], weight: 12, costGp: 20 },
  }),
  entry({
    id: SCALE_ITEMS.handaxe,
    slug: "ws-belt-axe",
    name: "Belt Axe",
    category: "weapon",
    summary: "A short axe carried on the belt and thrown as readily as swung.",
    mechanics: { category: "simple", usage: "melee", damage: { dice: "1d6", type: "slashing" }, properties: ["light", "thrown"], weight: 2, costGp: 5 },
  }),
  entry({
    id: SCALE_ITEMS.scriptRod,
    slug: "ws-script-rod",
    name: "Script Rod",
    category: "weapon",
    summary: "A hand rod of dark stone, cut with the channels a Runespeaker writes along.",
    mechanics: { category: "simple", usage: "melee", damage: { dice: "1d6", type: "bludgeoning" }, properties: ["light"], weight: 3, costGp: 15 },
  }),
  ...CARRIED_GEAR.map(item =>
    entry({
      id: item.id,
      slug: item.id.split(":")[1] ?? item.id,
      name: item.name,
      category: "item",
      summary: item.summary,
      mechanics: { itemType: "gear", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] },
    }),
  ),
  /*
   * One attuned item, because attunement is a fact the item schema already
   * carries and the sheet had no way to show. It is deliberately the only one:
   * a marker that appears on every row explains nothing.
   */
  entry({
    id: "item:ws-keeper-signet",
    slug: "ws-keeper-signet",
    name: "Keeper's Signet",
    category: "item",
    summary: "A ring of grey metal that warms when the crossing is crossed.",
    mechanics: {
      itemType: "wondrous",
      rarity: "uncommon",
      attunement: { required: true, prerequisite: "Sworn to a crossing" },
      weight: 0,
      attackIds: [],
      resourceIds: [],
    },
  }),
];

// ---- resources --------------------------------------------------------------

const resourceEntries: ContentEntry[] = [
  entry({
    id: SCALE_RESOURCES.bracing,
    slug: "ws-bracing",
    name: "Bracing",
    category: "resource",
    summary: "A set of the feet you can spend to hold ground. Returns on a short rest.",
    mechanics: { kind: "resource", data: { recharge: "short-rest" } },
  }),
  entry({
    id: SCALE_RESOURCES.bulwark,
    slug: "ws-bulwark",
    name: "Bulwark",
    category: "resource",
    summary: "The stand you can only make once in a day. Returns on a long rest.",
    mechanics: { kind: "resource", data: { recharge: "long-rest" } },
  }),
  entry({
    id: SCALE_RESOURCES.tollLight,
    slug: "ws-toll-light",
    name: "Toll Light",
    category: "resource",
    summary: "Light held in the crossing's lamp. It comes back at dawn, not with rest.",
    mechanics: { kind: "resource", data: { recharge: "dawn" } },
  }),
  entry({
    id: SCALE_RESOURCES.wardenSeal,
    slug: "ws-warden-seal",
    name: "Warden's Seal",
    category: "resource",
    summary: "A seal spent to close a gate for good. Nothing but the table restores it.",
    mechanics: { kind: "resource", data: { recharge: "manual" } },
  }),
  ...([1, 2, 3, 4, 5] as const).map(level =>
    entry({
      id: SCALE_SLOTS[level],
      slug: `ws-script-slots-${level}`,
      name: `Level ${level} script slots`,
      category: "resource",
      summary: `Marks held ready for level ${level} scripts. They return after a long rest.`,
      mechanics: { kind: "resource", data: { recharge: "long-rest" } },
    }),
  ),
];

// ---- actions ----------------------------------------------------------------

const action = (partial: {
  id: string;
  slug: string;
  name: string;
  summary: string;
  data: Record<string, unknown>;
}): ContentEntry =>
  entry({
    id: partial.id,
    slug: partial.slug,
    name: partial.name,
    category: "rule",
    summary: partial.summary,
    mechanics: { kind: "action-definition", data: partial.data },
  });

export const SCALE_ACTIONS = {
  poleaxeStrike: "rule:ws-poleaxe-strike",
  beltAxeThrow: "rule:ws-belt-axe-throw",
  shieldShove: "rule:ws-shield-shove",
  holdTheGate: "rule:ws-hold-the-gate",
  markTheCrossing: "rule:ws-mark-the-crossing",
  tollBreak: "rule:ws-toll-break",
  rodStrike: "rule:ws-rod-strike",
  scriptSurge: "rule:ws-script-surge",
  answerTheMark: "rule:ws-answer-the-mark",
} as const;

const actionEntries: ContentEntry[] = [
  action({
    id: SCALE_ACTIONS.poleaxeStrike,
    slug: "ws-poleaxe-strike",
    name: "Poleaxe Strike",
    summary: "A long swing that keeps a line at the length of the haft.",
    data: { actionKind: "attack", usage: "melee", ability: "strength", proficient: true, weaponId: SCALE_ITEMS.poleaxe, damageDice: "1d10", damageType: "slashing", range: "10 ft." },
  }),
  action({
    id: SCALE_ACTIONS.beltAxeThrow,
    slug: "ws-belt-axe-throw",
    name: "Belt Axe Throw",
    summary: "The axe off the belt, thrown flat.",
    data: { actionKind: "attack", usage: "thrown", ability: "strength", proficient: true, weaponId: SCALE_ITEMS.handaxe, damageDice: "1d6", damageType: "slashing", range: "20/60 ft." },
  }),
  action({
    id: SCALE_ACTIONS.shieldShove,
    slug: "ws-shield-shove",
    name: "Shield Shove",
    summary: "The shield's edge, driven forward to move someone off a step.",
    data: { actionKind: "bonus-action", usage: "melee", ability: "strength", proficient: true, damageDice: "1d4", damageType: "bludgeoning", range: "5 ft." },
  }),
  action({
    id: SCALE_ACTIONS.holdTheGate,
    slug: "ws-hold-the-gate",
    name: "Hold the Gate",
    summary: "You plant yourself in a doorway and refuse it to anyone else.",
    data: { actionKind: "action", usage: "brace" },
  }),
  action({
    id: SCALE_ACTIONS.markTheCrossing,
    slug: "ws-mark-the-crossing",
    name: "Mark the Crossing",
    summary: "A chalked mark that says who has already come this way.",
    data: { actionKind: "action", usage: "utility" },
  }),
  action({
    id: SCALE_ACTIONS.tollBreak,
    slug: "ws-toll-break",
    name: "Toll Break",
    summary: "When someone tries to pass you, the haft comes down.",
    data: { actionKind: "reaction", usage: "opportunity", ability: "strength", proficient: true, weaponId: SCALE_ITEMS.poleaxe, damageDice: "1d10", damageType: "slashing", range: "10 ft." },
  }),
  action({
    id: SCALE_ACTIONS.rodStrike,
    slug: "ws-rod-strike",
    name: "Rod Strike",
    summary: "The rod, swung as the blunt thing it also is.",
    data: { actionKind: "attack", usage: "melee", ability: "intelligence", proficient: true, weaponId: SCALE_ITEMS.scriptRod, damageDice: "1d6", damageType: "force", range: "5 ft." },
  }),
  action({
    id: SCALE_ACTIONS.scriptSurge,
    slug: "ws-script-surge",
    name: "Script Surge",
    summary: "You finish a half-written mark in one stroke.",
    data: { actionKind: "bonus-action", usage: "utility" },
  }),
  action({
    id: SCALE_ACTIONS.answerTheMark,
    slug: "ws-answer-the-mark",
    name: "Answer the Mark",
    summary: "A mark you left answers on your behalf when it is disturbed.",
    data: { actionKind: "reaction", usage: "trigger" },
  }),
];

// ---- Bastionward ------------------------------------------------------------

/**
 * Twelve levels of automatic features.
 *
 * The names are the point: a level 12 Character workspace has to hold twelve of
 * these plus a subclass's own three, and a flat list of fifteen open rows is the
 * shape this pass exists to replace.
 */
const MARTIAL_FEATURES: readonly { level: number; name: string; summary: string }[] = [
  { level: 1, name: "Set Footing", summary: "You choose where a fight happens by refusing to move from it." },
  { level: 2, name: "Second Breath", summary: "One hard-won breath puts you back on your feet mid-fight." },
  { level: 3, name: "Warden's Road", summary: "The road you walked before the hold hired you shows in how you fight." },
  { level: 4, name: "Measured Reach", summary: "You judge the length of a haft against the length of a stride." },
  { level: 5, name: "Doubled Guard", summary: "Two answers where you used to have one." },
  { level: 6, name: "Gatewise", summary: "Doorways, bridges and stairs stop being terrain and start being yours." },
  { level: 7, name: "Unhurried", summary: "You have been in worse. It stops showing on your face." },
  { level: 8, name: "Iron Habit", summary: "The guard goes up before you have decided to raise it." },
  { level: 9, name: "Long Watch", summary: "A night of standing costs you less than it costs anyone with you." },
  { level: 10, name: "Weight of the Hold", summary: "What you plant yourself in front of does not get moved." },
  { level: 11, name: "Two Gates", summary: "You hold one line and still reach the other." },
  { level: 12, name: "Named Warden", summary: "The crossing is known by your name, and that is worth a blow or two." },
];

const MARTIAL_SUBCLASS_FEATURES: readonly { level: number; name: string; summary: string }[] = [
  { level: 3, name: "Shieldwall Drill", summary: "You were trained to stand in a row, and it never left you." },
  { level: 7, name: "Locked Shields", summary: "Anyone beside you is behind your shield as well as their own." },
  { level: 11, name: "The Wall Holds", summary: "The line does not break while you are still in it." },
];

const featureId = (prefix: string, name: string) => `feature:${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const martialFeatureEntries: ContentEntry[] = [
  ...MARTIAL_FEATURES.map(feature =>
    entry({
      id: featureId("ws", feature.name),
      slug: `ws-${feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: feature.name,
      category: "class-feature",
      summary: feature.summary,
      mechanics: { classId: SCALE_IDS.martial, level: feature.level, featureType: "core" },
      // Level 1 is where the class's playable actions come from.
      effects:
        feature.level === 1
          ? [
              { id: "effect:ws-poleaxe", type: "addAttack", definitionId: SCALE_ACTIONS.poleaxeStrike },
              { id: "effect:ws-belt-axe", type: "addAttack", definitionId: SCALE_ACTIONS.beltAxeThrow },
              { id: "effect:ws-hold-gate", type: "addAction", definitionId: SCALE_ACTIONS.holdTheGate },
              {
                id: "effect:ws-bracing-resource",
                type: "addResource",
                resource: { id: SCALE_RESOURCES.bracing, name: "Bracing", maximum: { kind: "path", path: `resource.${SCALE_RESOURCES.bracing}` }, recharge: "short-rest" },
              },
              { id: "effect:ws-bracing-recharge", type: "rechargeOnShortRest", resourceId: SCALE_RESOURCES.bracing },
            ]
          : feature.level === 2
            ? [
                { id: "effect:ws-shield-shove", type: "addBonusAction", definitionId: SCALE_ACTIONS.shieldShove },
                {
                  id: "effect:ws-bulwark-resource",
                  type: "addResource",
                  resource: { id: SCALE_RESOURCES.bulwark, name: "Bulwark", maximum: { kind: "path", path: `resource.${SCALE_RESOURCES.bulwark}` }, recharge: "long-rest" },
                },
                { id: "effect:ws-bulwark-recharge", type: "rechargeOnLongRest", resourceId: SCALE_RESOURCES.bulwark },
              ]
            : feature.level === 4
              ? [
                  { id: "effect:ws-mark-crossing", type: "addAction", definitionId: SCALE_ACTIONS.markTheCrossing },
                  {
                    id: "effect:ws-toll-light-resource",
                    type: "addResource",
                    resource: { id: SCALE_RESOURCES.tollLight, name: "Toll Light", maximum: { kind: "path", path: `resource.${SCALE_RESOURCES.tollLight}` }, recharge: "dawn" },
                  },
                ]
              : feature.level === 5
                ? [{ id: "effect:ws-toll-break", type: "addReaction", definitionId: SCALE_ACTIONS.tollBreak }]
                : feature.level === 7
                  ? [
                      {
                        id: "effect:ws-warden-seal-resource",
                        type: "addResource",
                        resource: { id: SCALE_RESOURCES.wardenSeal, name: "Warden's Seal", maximum: { kind: "path", path: `resource.${SCALE_RESOURCES.wardenSeal}` }, recharge: "manual" },
                      },
                    ]
                  : [],
    }),
  ),
  ...MARTIAL_SUBCLASS_FEATURES.map(feature =>
    entry({
      id: featureId("ws-sw", feature.name),
      slug: `ws-sw-${feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: feature.name,
      category: "class-feature",
      summary: feature.summary,
      mechanics: { classId: SCALE_IDS.martial, level: feature.level, featureType: "subclass" },
    }),
  ),
];

const martialSubclass = entry({
  id: SCALE_IDS.martialSubclass,
  slug: "ws-shieldwall",
  name: "Shieldwall",
  category: "subclass",
  summary: "The hold's front rank, drilled to stand in a row and hold it.",
  mechanics: {
    classId: SCALE_IDS.martial,
    progression: MARTIAL_SUBCLASS_FEATURES.map(feature => ({
      level: feature.level,
      featureIds: [featureId("ws-sw", feature.name)],
      choiceIds: [],
    })),
  },
});

const martialKit = "bundle:ws-warden-kit";

const bastionward = entry({
  id: SCALE_IDS.martial,
  slug: "ws-bastionward",
  name: "Bastionward",
  category: "class",
  summary: "You are what a crossing has instead of a wall.",
  effects: [
    scaled("effect:ws-martial-hit-points", "hitPoints.classBase", "Bastionward hit points", MARTIAL_HIT_POINT_BASE),
    scaled("effect:ws-bracing-scale", `resource.${SCALE_RESOURCES.bracing}`, "Bracing uses", BRACING),
    scaled("effect:ws-bulwark-scale", `resource.${SCALE_RESOURCES.bulwark}`, "Bulwark uses", BULWARK),
    scaled("effect:ws-toll-light-scale", `resource.${SCALE_RESOURCES.tollLight}`, "Toll Light", TOLL_LIGHT),
    scaled("effect:ws-warden-seal-scale", `resource.${SCALE_RESOURCES.wardenSeal}`, "Warden's Seal", WARDEN_SEAL),
    { id: "effect:ws-warden-kit", type: "grantEquipmentBundle", bundleId: martialKit, label: "Warden kit" },
  ],
  equipmentBundles: [
    {
      id: martialKit,
      label: "Warden kit",
      entries: [
        { type: "item", itemId: SCALE_ITEMS.poleaxe, quantity: 1, status: "equipped" },
        { type: "item", itemId: SCALE_ITEMS.plate, quantity: 1, status: "equipped" },
        { type: "item", itemId: SCALE_ITEMS.greatShield, quantity: 1, status: "equipped" },
        { type: "item", itemId: SCALE_ITEMS.handaxe, quantity: 2, status: "carried" },
        { type: "item", itemId: "item:ws-keeper-signet", quantity: 1, status: "carried" },
        ...CARRIED_GEAR.map(item => ({ type: "item" as const, itemId: item.id, quantity: item.quantity, status: "carried" as const })),
      ],
    },
  ],
  choices: [
    {
      id: SCALE_CHOICES.martialSkills,
      label: "Bastionward training",
      min: 2,
      max: 2,
      repeatable: false,
      options: SCALE_SKILLS.slice(0, 6).map(skill => ({
        id: `option:${skill.id}`,
        label: skill.label,
        effects: [grant(skill.id)],
      })),
    },
  ],
  mechanics: {
    hitDie: 10,
    primaryAbilities: ["strength"],
    savingThrows: [SCALE_PROFICIENCIES.saveStrength, SCALE_PROFICIENCIES.saveConstitution],
    startingProficiencyIds: [
      SCALE_PROFICIENCIES.armorLight,
      SCALE_PROFICIENCIES.armorMedium,
      SCALE_PROFICIENCIES.armorHeavy,
      SCALE_PROFICIENCIES.armorShield,
      SCALE_PROFICIENCIES.weaponSimple,
      SCALE_PROFICIENCIES.weaponMartial,
      SCALE_PROFICIENCIES.toolMason,
    ],
    progression: MARTIAL_FEATURES.map(feature => ({
      level: feature.level,
      proficiencyBonus: 2 + Math.floor((feature.level - 1) / 4),
      // Subclass features are granted by the subclass's own progression, not
      // restated here: listing them twice grants them twice.
      featureIds: [featureId("ws", feature.name)],
      choiceIds: feature.level === 1 ? [SCALE_CHOICES.martialSkills] : [],
      resourceChanges: {
        ...(BRACING[feature.level] === undefined ? {} : { [SCALE_RESOURCES.bracing]: BRACING[feature.level] }),
        ...(BULWARK[feature.level] === undefined ? {} : { [SCALE_RESOURCES.bulwark]: BULWARK[feature.level] }),
        ...(TOLL_LIGHT[feature.level] === undefined ? {} : { [SCALE_RESOURCES.tollLight]: TOLL_LIGHT[feature.level] }),
        ...(WARDEN_SEAL[feature.level] === undefined ? {} : { [SCALE_RESOURCES.wardenSeal]: WARDEN_SEAL[feature.level] }),
      },
    })),
    subclassLevel: 3,
    subclassIds: [SCALE_IDS.martialSubclass],
  },
});

// ---- Runespeaker ------------------------------------------------------------

const CASTER_FEATURES: readonly { level: number; name: string; summary: string }[] = [
  { level: 1, name: "First Script", summary: "You learn to hold a mark in your head long enough to write it." },
  { level: 2, name: "Held Marks", summary: "A half-written mark waits for you rather than fading." },
  { level: 3, name: "Chosen Hand", summary: "The way you were taught to write starts deciding what you can write." },
  { level: 4, name: "Steady Stroke", summary: "Your hand stops shaking under a mark's weight." },
  { level: 5, name: "Deep Draught", summary: "You reach further down the script than the page should allow." },
  { level: 6, name: "Second Reading", summary: "A mark read twice says something it did not say once." },
  { level: 7, name: "Long Script", summary: "A mark you set holds through a night." },
  { level: 8, name: "Quiet Ink", summary: "You write without anybody watching noticing that you did." },
  { level: 9, name: "Whole Page", summary: "You hold the shape of a full page of script at once." },
];

const CASTER_SUBCLASS_FEATURES: readonly { level: number; name: string; summary: string }[] = [
  { level: 3, name: "Deepscript Study", summary: "You were taught from the older, harder marks first." },
  { level: 7, name: "Unbroken Line", summary: "A deep mark does not break when it is interrupted." },
];

const casterFeatureEntries: ContentEntry[] = [
  ...CASTER_FEATURES.map(feature =>
    entry({
      id: featureId("ws-rs", feature.name),
      slug: `ws-rs-${feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: feature.name,
      category: "class-feature",
      summary: feature.summary,
      mechanics: { classId: SCALE_IDS.caster, level: feature.level, featureType: "core" },
      effects:
        feature.level === 1
          ? [
              { id: "effect:ws-rod-strike", type: "addAttack", definitionId: SCALE_ACTIONS.rodStrike },
              { id: "effect:ws-script-surge", type: "addBonusAction", definitionId: SCALE_ACTIONS.scriptSurge },
              { id: "effect:ws-answer-mark", type: "addReaction", definitionId: SCALE_ACTIONS.answerTheMark },
            ]
          : [],
    }),
  ),
  ...CASTER_SUBCLASS_FEATURES.map(feature =>
    entry({
      id: featureId("ws-ds", feature.name),
      slug: `ws-ds-${feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: feature.name,
      category: "class-feature",
      summary: feature.summary,
      mechanics: { classId: SCALE_IDS.caster, level: feature.level, featureType: "subclass" },
    }),
  ),
];

const casterSubclass = entry({
  id: SCALE_IDS.casterSubclass,
  slug: "ws-deepscript",
  name: "Deepscript",
  category: "subclass",
  summary: "The older marks, learned before the easy ones.",
  mechanics: {
    classId: SCALE_IDS.caster,
    progression: CASTER_SUBCLASS_FEATURES.map(feature => ({
      level: feature.level,
      featureIds: [featureId("ws-ds", feature.name)],
      choiceIds: [],
    })),
  },
});

/**
 * Thirty spells over six spell levels.
 *
 * Four are granted outright by the class, one of those always prepared; the rest
 * are reachable through the class's list. The mix of ritual, concentration and
 * casting time is deliberate — a Spells workspace that groups by level and says
 * nothing else is no more usable at thirty spells than at four.
 */
const SPELL_TABLE: readonly {
  name: string;
  level: number;
  school: string;
  summary: string;
  ritual?: boolean;
  concentration?: boolean;
  castingTime?: { amount: number; unit: string };
  range?: Record<string, unknown>;
}[] = [
  { name: "Chalkmark", level: 0, school: "divination", summary: "A mark only you can see stays where you put it." },
  { name: "Emberpoint", level: 0, school: "evocation", summary: "A point of hot light snaps to something you can see.", range: { type: "distance", distance: 60, unit: "feet" } },
  { name: "Steady Hand", level: 0, school: "transmutation", summary: "Your grip stops slipping for as long as you hold it.", concentration: true },
  { name: "Cold Reading", level: 0, school: "divination", summary: "You know whether a written thing was written in haste." },
  { name: "Nightlamp", level: 0, school: "evocation", summary: "A cupped light that does not gutter." },
  { name: "Threadpull", level: 0, school: "transmutation", summary: "Something small and loose comes to your hand." },
  { name: "Salt Line", level: 1, school: "abjuration", summary: "A drawn line one thing may not cross.", ritual: true },
  { name: "Held Door", level: 1, school: "abjuration", summary: "A door you have marked refuses to open.", concentration: true },
  { name: "Lend Strength", level: 1, school: "transmutation", summary: "You give away some of what is holding you up.", range: { type: "touch" } },
  { name: "Mend the Hour", level: 1, school: "abjuration", summary: "The last hour's hurts close over.", range: { type: "touch" } },
  { name: "Reed Whisper", level: 1, school: "divination", summary: "You hear what was said where you left the mark.", ritual: true },
  { name: "Underfoot", level: 1, school: "conjuration", summary: "The ground under a creature stops cooperating.", concentration: true },
  { name: "Signal Fire", level: 2, school: "evocation", summary: "A flame that can be seen from the next crossing.", castingTime: { amount: 1, unit: "minute" } },
  { name: "Bound Ledger", level: 2, school: "abjuration", summary: "What is written in it cannot be written over.", ritual: true },
  { name: "Second Wall", level: 2, school: "abjuration", summary: "A wall stands where there was only a mark of one.", concentration: true },
  { name: "Read the Road", level: 2, school: "divination", summary: "You learn who has come this way, and roughly when.", ritual: true },
  { name: "Slack Water", level: 2, school: "transmutation", summary: "Moving water forgets, briefly, that it was moving.", concentration: true },
  { name: "Stonefast", level: 3, school: "transmutation", summary: "Worked stone stops behaving like separate pieces.", castingTime: { amount: 1, unit: "minute" } },
  { name: "Long Sight", level: 3, school: "divination", summary: "You look through a mark you set somewhere else.", concentration: true },
  { name: "Break the Seal", level: 3, school: "abjuration", summary: "A closure someone else made comes undone." },
  { name: "Warden's Call", level: 3, school: "conjuration", summary: "The crossing answers, in whatever way it can." },
  { name: "Ash Wind", level: 3, school: "evocation", summary: "Hot grit off a fire that is not there.", range: { type: "self" } },
  { name: "Held Night", level: 4, school: "abjuration", summary: "A night's worth of watch, kept for you.", concentration: true },
  { name: "Deep Channel", level: 4, school: "conjuration", summary: "A way opens under the way that was there." },
  { name: "Unwritten", level: 4, school: "transmutation", summary: "Something written stops having been written.", castingTime: { amount: 10, unit: "minute" }, ritual: true },
  { name: "Iron Answer", level: 4, school: "evocation", summary: "Whatever struck the mark is struck back." },
  { name: "The Whole Reach", level: 5, school: "divination", summary: "Every mark you have set reports at once.", concentration: true },
  { name: "Gate Unmade", level: 5, school: "transmutation", summary: "A crossing stops being a crossing." },
  { name: "Standing Script", level: 5, school: "abjuration", summary: "A page of marks that holds itself upright.", castingTime: { amount: 1, unit: "minute" }, concentration: true },
  { name: "Last Ledger", level: 5, school: "divination", summary: "The book says what it will say when it is closed.", ritual: true },
];

const spellId = (name: string) => `spell:ws-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * The class level at which each spell level becomes known.
 *
 * Spells reach a sheet by being *granted*: `addSpellList` says what a character
 * may learn and never that it has learned it, and this repository has no
 * selection or preparation mechanic behind that distinction yet. So a
 * Runespeaker's repertoire is declared rather than chosen, and it arrives with
 * level exactly as the slots do — which is also what makes a level 9 caster's
 * Spells workspace six times the size of a level 1 caster's.
 */
const SPELL_LEVEL_UNLOCK: Readonly<Record<number, number>> = { 0: 1, 1: 1, 2: 3, 3: 5, 4: 7, 5: 9 };

/** Always prepared is a property of the grant, so exactly one grant carries it. */
export const SCALE_ALWAYS_PREPARED_SPELL = "Chalkmark";
export const SCALE_SPELL_COUNT = SPELL_TABLE.length;
/** How many spells a Runespeaker of a given level knows. */
export const scaleSpellsKnownAt = (level: number) =>
  SPELL_TABLE.filter(item => (SPELL_LEVEL_UNLOCK[item.level] ?? 20) <= level).length;

const spellEntries: ContentEntry[] = SPELL_TABLE.map(item =>
  entry({
    id: spellId(item.name),
    slug: `ws-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: item.name,
    category: "spell",
    summary: item.summary,
    mechanics: {
      level: item.level,
      school: item.school,
      components: { verbal: true, somatic: true, consumed: false },
      castingTime: item.castingTime ?? { amount: 1, unit: "action" },
      duration: item.concentration
        ? { type: "timed", amount: 10, unit: "minute", concentration: true }
        : { type: "instantaneous", concentration: false },
      range: item.range ?? { type: "distance", distance: 30, unit: "feet" },
      scaling: [],
      spellListIds: [SCALE_IDS.spellList],
      ...(item.ritual === undefined ? {} : { ritual: item.ritual }),
    },
  }),
);

const spellListEntry = entry({
  id: SCALE_IDS.spellList,
  slug: "ws-deep-script",
  name: "Deep script",
  category: "spell-list",
  summary: "Every mark a Runespeaker may learn to write.",
  mechanics: { spellIds: SPELL_TABLE.map(item => spellId(item.name)), ownerIds: [SCALE_IDS.caster] },
});

const spellcastingRule = entry({
  id: SCALE_IDS.spellcastingRule,
  slug: "ws-runespeaking",
  name: "Runespeaking",
  category: "rule",
  summary: "Runespeaking is written with Intelligence and paid for in script slots.",
  mechanics: {
    kind: "spellcasting",
    data: {
      classId: SCALE_IDS.caster,
      ability: "intelligence",
      attackProficient: true,
      saveDcBase: 8,
      slotResourceIds: [SCALE_SLOTS[1], SCALE_SLOTS[2], SCALE_SLOTS[3], SCALE_SLOTS[4], SCALE_SLOTS[5]],
    },
  },
});

const casterKit = "bundle:ws-script-satchel";

const runespeaker = entry({
  id: SCALE_IDS.caster,
  slug: "ws-runespeaker",
  name: "Runespeaker",
  category: "class",
  summary: "You write things down and they answer.",
  effects: [
    scaled("effect:ws-caster-hit-points", "hitPoints.classBase", "Runespeaker hit points", CASTER_HIT_POINT_BASE),
    ...([1, 2, 3, 4, 5] as const).map(level =>
      scaled(`effect:ws-slot-scale-${level}`, `resource.${SCALE_SLOTS[level]}`, `Level ${level} script slots`, SLOT_TABLE[level]),
    ),
    { id: "effect:ws-script-satchel", type: "grantEquipmentBundle", bundleId: casterKit, label: "Script satchel" },
    { id: "effect:ws-deep-script-list", type: "addSpellList", spellListId: SCALE_IDS.spellList },
    ...SPELL_TABLE.map(item => {
      const slugged = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const grant: Effect = {
        id: `effect:ws-grant-${slugged}`,
        type: "addSpell",
        spellId: spellId(item.name),
        ...(item.name === SCALE_ALWAYS_PREPARED_SPELL ? { alwaysPrepared: true } : {}),
      };
      const unlock = SPELL_LEVEL_UNLOCK[item.level] ?? 20;
      return unlock <= 1
        ? grant
        : ({ id: `effect:ws-unlock-${slugged}`, type: "unlockAtLevel", level: unlock, scope: "class", classId: SCALE_IDS.caster, effect: grant } satisfies Effect);
    }),
  ],
  equipmentBundles: [
    {
      id: casterKit,
      label: "Script satchel",
      entries: [
        { type: "item", itemId: SCALE_ITEMS.scriptRod, quantity: 1, status: "equipped" },
        { type: "item", itemId: SCALE_ITEMS.scriptVest, quantity: 1, status: "equipped" },
        { type: "item", itemId: "item:ws-chalk-sticks", quantity: 8, status: "carried" },
        { type: "item", itemId: "item:ws-toll-ledger", quantity: 1, status: "carried" },
        { type: "item", itemId: "item:ws-ration-bundle", quantity: 3, status: "carried" },
      ],
    },
  ],
  choices: [
    {
      id: SCALE_CHOICES.casterSkills,
      label: "Runespeaker study",
      min: 2,
      max: 2,
      repeatable: false,
      options: SCALE_SKILLS.slice(5, 11).map(skill => ({
        id: `option:${skill.id}`,
        label: skill.label,
        effects: [grant(skill.id)],
      })),
    },
  ],
  mechanics: {
    hitDie: 6,
    primaryAbilities: ["intelligence"],
    savingThrows: [SCALE_PROFICIENCIES.saveIntelligence, SCALE_PROFICIENCIES.saveWisdom],
    startingProficiencyIds: [SCALE_PROFICIENCIES.armorLight, SCALE_PROFICIENCIES.weaponSimple, SCALE_PROFICIENCIES.toolScribe],
    progression: CASTER_FEATURES.map(feature => ({
      level: feature.level,
      proficiencyBonus: 2 + Math.floor((feature.level - 1) / 4),
      // The slot pools are declared by their own feature, granted at level 1.
      featureIds:
        feature.level === 1
          ? [featureId("ws-rs", feature.name), "feature:ws-script-slots"]
          : [featureId("ws-rs", feature.name)],
      choiceIds: feature.level === 1 ? [SCALE_CHOICES.casterSkills] : [],
      resourceChanges: Object.fromEntries(
        ([1, 2, 3, 4, 5] as const)
          .filter(slot => SLOT_TABLE[slot][feature.level] !== undefined)
          .map(slot => [SCALE_SLOTS[slot], SLOT_TABLE[slot][feature.level]]),
      ),
    })),
    subclassLevel: 3,
    subclassIds: [SCALE_IDS.casterSubclass],
  },
});

/** The slot resources a level actually declares, which is what the sheet shows. */
const slotResourceEffects: Effect[] = ([1, 2, 3, 4, 5] as const).map(level => ({
  id: `effect:ws-slot-resource-${level}`,
  type: "addResource",
  resource: {
    id: SCALE_SLOTS[level],
    name: `Level ${level} script slots`,
    maximum: { kind: "path", path: `resource.${SCALE_SLOTS[level]}` },
    recharge: "long-rest",
  },
}));

/**
 * The slot pools are declared by one feature rather than by the class, so a
 * character that has not reached a level does not carry an empty pool for it:
 * `scaleAtLevel` leaves the path unset below its first row, and a resource with
 * no maximum is exactly what the sheet reports as uncalculable.
 */
const casterSlotFeature = entry({
  id: "feature:ws-script-slots",
  slug: "ws-script-slots",
  name: "Script Slots",
  category: "class-feature",
  summary: "The marks you can hold ready at once, by the depth you can write them.",
  mechanics: { classId: SCALE_IDS.caster, level: 1, featureType: "resource" },
  effects: [
    ...slotResourceEffects,
    ...([1, 2, 3, 4, 5] as const).map(level => ({
      id: `effect:ws-slot-recharge-${level}`,
      type: "rechargeOnLongRest" as const,
      resourceId: SCALE_SLOTS[level],
    })),
  ],
});

// ---- origin, background and the rest ----------------------------------------

const speciesEntry = entry({
  id: SCALE_IDS.species,
  slug: "ws-holdborn",
  name: "Holdborn",
  category: "species",
  summary: "Born inside the walls, and shaped by never having been outside them until late.",
  // Speed comes from the species' own `speed`, so no effect restates it: a
  // `modifySpeed` beside it would be added to it rather than replacing it.
  effects: [grant(SCALE_PROFICIENCIES.languageHoldspeech)],
  mechanics: { creatureType: "humanoid", sizeChoices: ["medium"], speed: 30, traitIds: [], lineageIds: [] },
});

const backgroundFeat = entry({
  id: SCALE_IDS.backgroundFeat,
  slug: "ws-long-watch",
  name: "Long Watch",
  category: "feat",
  summary: "You have stood a great many nights, and it stopped being remarkable.",
  mechanics: { category: "origin", repeatable: false },
});

const backgroundEntry = entry({
  id: SCALE_IDS.background,
  slug: "ws-toll-warden",
  name: "Toll Warden",
  category: "background",
  summary: "You counted everyone who crossed, and remembered the ones who did not come back.",
  effects: [grant(SCALE_PROFICIENCIES.languageTollCant), grant(SCALE_PROFICIENCIES.toolCartwright)],
  mechanics: {
    abilityScoreChoices: { abilities: ["strength", "constitution", "intelligence"], increasePattern: [2, 1] },
    featId: SCALE_IDS.backgroundFeat,
    proficiencyIds: [SCALE_PROFICIENCIES.languageTollCant, SCALE_PROFICIENCIES.toolCartwright],
    equipmentChoiceIds: [],
    equipmentBundleIds: [],
  },
});

const abilityGenerationEntries: ContentEntry[] = [
  entry({
    id: "rule:ws-ability-standard-array",
    slug: "ws-ability-standard-array",
    name: "Standard array",
    category: "rule",
    summary: "Assign one fixed set of six scores, then apply your origin's increases.",
    mechanics: { kind: "ability-generation", data: { method: "standard-array", scores: [...SCALE_ARRAY], label: "Standard array" } },
  }),
  entry({
    id: "rule:ws-ability-manual",
    slug: "ws-ability-manual",
    name: "Enter scores manually",
    category: "rule",
    summary: "Record scores your table generated another way.",
    mechanics: { kind: "ability-generation", data: { method: "manual", label: "Enter scores manually" } },
  }),
];

const conditionEntries: ContentEntry[] = [
  entry({
    id: "condition:ws-winded",
    slug: "ws-winded",
    name: "Winded",
    category: "condition",
    summary: "You are short of breath after a hard push.",
    mechanics: { kind: "condition", data: { track: true } },
  }),
  entry({
    id: "condition:ws-marked",
    slug: "ws-marked",
    name: "Marked",
    category: "condition",
    summary: "Someone has written you into something, and it knows where you are.",
    mechanics: { kind: "condition", data: { track: true } },
  }),
];

export const SCALE_ENTRIES: readonly ContentEntry[] = [
  bastionward,
  martialSubclass,
  ...martialFeatureEntries,
  runespeaker,
  casterSubclass,
  casterSlotFeature,
  ...casterFeatureEntries,
  spellcastingRule,
  spellListEntry,
  ...spellEntries,
  speciesEntry,
  backgroundEntry,
  backgroundFeat,
  ...actionEntries,
  ...resourceEntries,
  ...itemEntries,
  ...proficiencyEntries,
  ...abilityGenerationEntries,
  ...conditionEntries,
];

export function scalePack(): ContentPackDocument {
  return contentPackSchema.parse({
    schemaVersion: 2,
    pack: {
      id: SCALE_PACK_ID,
      name: SCALE_PACK_NAME,
      description: "Original synthetic content sized to exercise a full character sheet.",
      version: VERSION,
      coverage: "partial",
      rulesEditions: ["homebrew"],
      visibility: "public",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: false,
      dependencies: [],
      optionalDependencies: [],
    },
    sources: [
      {
        id: SCALE_SOURCE_ID,
        name: "Wardenreach scale reference",
        abbreviation: "WSR",
        edition: "homebrew",
        type: "homebrew",
        licenseType: "original",
        visibility: "public",
        priority: 40,
        enabledByDefault: true,
        campaignIds: [],
        version: VERSION,
      },
    ],
    entries: SCALE_ENTRIES,
  });
}

export const scalePackJson = () => JSON.stringify(scalePack());
