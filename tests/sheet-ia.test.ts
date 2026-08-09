import { describe, expect, it } from "vitest";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import {
  RUNECALLER_CHOICES,
  RUNECALLER_IDS,
  SYNTHETIC_CHOICES,
  SYNTHETIC_ENTRIES,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import { brammel, brammelRuntime } from "@/tests/fixtures/brammel";
import {
  BUILD_BOUNDARY_SENTENCE,
  BUILD_MANAGED_DECISIONS,
  SHEET_MANAGED_OPERATIONS,
  listPhrase,
} from "@/src/ui/sheet-scope";
import type { CharacterRecord } from "@/src/domain/character-record";

/**
 * The projections the Character-management information architecture is built on.
 *
 * The sheet's new structure is only as honest as what it is grouping by, so the
 * classifications it relies on are asserted here rather than trusted: a feat is
 * filed under the origin that actually granted it, an always-prepared spell says
 * so because a grant said so, and an item's facts come from the item's own
 * declared mechanics.
 */
const resolveBrammel = (level = 1) =>
  resolveDerivedCharacter({
    character: brammel(level),
    runtime: brammelRuntime(level),
    entries: SYNTHETIC_ENTRIES,
    ruleset: SYNTHETIC_RULESET,
  });

describe("Character grouping", () => {
  const sheet = resolveBrammel();

  it("files the background's own feat under Background and nothing else", () => {
    const background = sheet.features.filter(feature => feature.group === "background");
    // Caravan Warden declares exactly one feat, and that is the one it owns.
    expect(background.map(feature => feature.label)).toEqual(["Warden's Vigil"]);
  });

  it("keeps species traits with the species", () => {
    const species = sheet.features.filter(feature => feature.group === "species");
    expect(species.map(feature => feature.label).sort()).toEqual(["River Footing", "Steady Lungs"]);
  });

  it("keeps class features, including chosen styles, with the class", () => {
    const classFeatures = sheet.features.filter(feature => feature.group === "class").map(feature => feature.label);
    expect(classFeatures).toContain("Hold the Line");
    expect(classFeatures).toContain("Guarded Hand");
  });

  /**
   * The regression this grouping exists to prevent: a feat that no background
   * granted used to be filed under Background anyway, which put a class-owned
   * choice under an origin heading it had nothing to do with.
   */
  it("puts a feat the background did not declare in its own group", () => {
    const character: CharacterRecord = brammel(1, {
      // The second background declares a different feat, so Caravan Warden's own
      // grant is no longer background-owned for this character.
      backgroundId: SYNTHETIC_IDS.backgroundSecond,
      choiceSelections: {
        [SYNTHETIC_CHOICES.fightingStyle]: ["option:guarded-hand"],
        [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-riverlore", "option:proficiency:skill-haulage"],
        [SYNTHETIC_CHOICES.backgroundFerryCraft]: ["option:ferry-parley"],
      },
    });
    const sheetWithOtherBackground = resolveDerivedCharacter({
      character,
      runtime: brammelRuntime(1),
      entries: SYNTHETIC_ENTRIES,
      ruleset: SYNTHETIC_RULESET,
    });
    const background = sheetWithOtherBackground.features.filter(feature => feature.group === "background");
    expect(background.map(feature => feature.label)).toEqual(["Ferry Sense"]);
    // Nothing has been lost: every granted feature still has exactly one group.
    const groups = new Set(sheetWithOtherBackground.features.map(feature => feature.group));
    for (const group of groups) expect(["class", "species", "background", "feat"]).toContain(group);
  });
});

describe("Inventory projection", () => {
  const sheet = resolveBrammel();

  it("carries each item's own declared facts and invents none", () => {
    const armour = sheet.equipment.find(item => item.itemId === SYNTHETIC_IDS.armor);
    expect(armour).toBeDefined();
    expect(armour?.armorContribution).toBe(14);
    expect(armour?.summary).toBeTruthy();
    // Travel Mail declares a weight and no attunement, so one is present and the
    // other is absent rather than defaulted to false.
    expect(typeof armour?.weight).toBe("number");
    expect(armour?.attunementRequired).toBeUndefined();
  });

  it("omits a rarity of none rather than printing it", () => {
    for (const item of sheet.equipment) expect(item.rarity).not.toBe("none");
  });

  it("separates equipped from carried", () => {
    expect(sheet.equipment.some(item => item.status === "equipped")).toBe(true);
    expect(sheet.equipment.some(item => item.status !== "equipped")).toBe(true);
  });
});

describe("Spell projection", () => {
  const casterId = "character:sereth";
  const sereth: CharacterRecord = {
    ...brammel(1),
    id: casterId,
    name: "Sereth Marsh",
    classLevels: [{ classId: RUNECALLER_IDS.class, level: 1 }],
    rulesetProfileId: SYNTHETIC_RULESET_ID,
    abilityScores: { strength: 10, dexterity: 16, constitution: 14, intelligence: 12, wisdom: 15, charisma: 8 },
    choiceSelections: { [RUNECALLER_CHOICES.classSkills]: ["option:proficiency:skill-riverlore"] },
    equipmentSelections: {},
  };
  const sheet = resolveDerivedCharacter({
    character: sereth,
    runtime: { ...brammelRuntime(1), characterId: casterId, resourceUses: {}, resourceMaximaAtLastSync: {} },
    entries: SYNTHETIC_ENTRIES,
    ruleset: SYNTHETIC_RULESET,
  });

  it("marks a spell always prepared only when its grant said so", () => {
    const spells = sheet.spellcasting?.spells ?? [];
    expect(spells.length).toBeGreaterThan(0);
    const always = spells.filter(spell => spell.alwaysPrepared).map(spell => spell.label);
    // Emberline is the one `addSpell` grant that carries `alwaysPrepared`.
    expect(always).toEqual(["Emberline"]);
    // And being on the reachable list is not a way to acquire the flag.
    expect(spells.filter(spell => !spell.alwaysPrepared).length).toBeGreaterThan(0);
  });
});

describe("the Sheet versus Edit character boundary", () => {
  /**
   * Every runtime operation is classified. The record's type is keyed by the
   * operation union, so this test is really asserting that the union has not
   * grown a member with no decision behind it — but it is worth stating at
   * runtime too, because a `as const` cast somewhere could hide it.
   */
  it("classifies every runtime operation as sheet-managed", () => {
    const kinds = Object.keys(SHEET_MANAGED_OPERATIONS);
    expect(kinds.length).toBeGreaterThan(0);
    for (const [kind, concept] of Object.entries(SHEET_MANAGED_OPERATIONS)) {
      expect(kind.length, "an operation kind is empty").toBeGreaterThan(0);
      expect(concept.length, `${kind} has no play concept`).toBeGreaterThan(0);
    }
    // Rests and hit points are the two that must never move behind the builder.
    expect(SHEET_MANAGED_OPERATIONS["long-rest"]).toBe("rest");
    expect(SHEET_MANAGED_OPERATIONS.damage).toBe("hit-points");
  });

  it("keeps build decisions out of the play-managed set", () => {
    const played = new Set(Object.values(SHEET_MANAGED_OPERATIONS));
    for (const decision of BUILD_MANAGED_DECISIONS) expect(played.has(decision as never)).toBe(false);
  });

  it("states the boundary once, in words a player would use", () => {
    expect(BUILD_BOUNDARY_SENTENCE).toContain("Edit character");
    expect(BUILD_BOUNDARY_SENTENCE).toContain("sheet");
    // Short enough to sit under two buttons on a 360 px phone.
    expect(BUILD_BOUNDARY_SENTENCE.length).toBeLessThan(140);
    // No engine vocabulary reaches the screen.
    expect(BUILD_BOUNDARY_SENTENCE).not.toMatch(/runtime|operation|ruleset|derive/i);
  });

  it("joins a list the way a sentence does", () => {
    expect(listPhrase([])).toBe("");
    expect(listPhrase(["one"])).toBe("one");
    expect(listPhrase(["one", "two"])).toBe("one and two");
    expect(listPhrase(["one", "two", "three"])).toBe("one, two and three");
  });
});
