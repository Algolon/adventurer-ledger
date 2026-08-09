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
  spellStateBadge,
} from "@/src/ui/sheet-scope";
import {
  CASTER_IDS,
  CASTER_RULESET_ID,
  CASTER_SELECTION_IDS,
  CASTER_SPELL_IDS,
  casterStoredEntries,
} from "@/tests/fixtures/caster-selection-pack";
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

/**
 * The projection the two merged branches produce together.
 *
 * Neither branch could test this in isolation. The caster spell-selection slice
 * owns what a player may choose and proves it at the planner; the Sheet IA pass
 * owns what the workspace renders and proved it against a grant-only caster. The
 * fact that only exists after the merge is the *committed* projection where both
 * routes meet: a spell that was granted and separately chosen has to arrive as
 * one row carrying both facts, and a spell that is merely reachable has to
 * arrive as nothing at all.
 *
 * The Warden fixture is built for exactly this shape — one outright grant that
 * also sits on its own list, one always-prepared grant, one prepared-model
 * allowance, and a list neither class reaches.
 */
describe("the merged spell projection", () => {
  const entries = casterStoredEntries();

  const warden = (spellSelections: Record<string, readonly string[]>, level = 1): CharacterRecord => ({
    ...brammel(level),
    id: "character:warden",
    name: "Vigil Warden",
    level,
    classLevels: [{ classId: CASTER_IDS.warden, level }],
    rulesetProfileId: CASTER_RULESET_ID,
    speciesId: CASTER_IDS.species,
    backgroundId: CASTER_IDS.background,
    abilityScores: { strength: 10, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 15, charisma: 8 },
    choiceSelections: {},
    equipmentSelections: {},
    spellSelections,
  });

  const project = (character: CharacterRecord) =>
    resolveDerivedCharacter({
      character,
      runtime: { ...brammelRuntime(1), characterId: character.id, resourceUses: {}, resourceMaximaAtLastSync: {} },
      entries,
    });

  const spellsOf = (character: CharacterRecord) => project(character).spellcasting?.spells ?? [];
  const find = (character: CharacterRecord, id: string) => spellsOf(character).find(spell => spell.id === id);

  it("keeps a granted spell distinct, and an always-prepared one distinct again", () => {
    const sheet = warden({});
    const granted = find(sheet, CASTER_SPELL_IDS.holdTheLine);
    expect(granted, "the outright grant is missing").toBeDefined();
    expect(granted).toMatchObject({ granted: true, known: true, prepared: false, alwaysPrepared: false });
    expect(granted?.viaSelectionId, "a grant is not a spent choice").toBeUndefined();

    const always = find(sheet, CASTER_SPELL_IDS.wardensEye);
    expect(always).toMatchObject({ granted: true, known: true, prepared: true, alwaysPrepared: true });
    expect(always?.viaSelectionId).toBeUndefined();
  });

  it("keeps a selected prepared spell prepared", () => {
    const sheet = warden({ [CASTER_SELECTION_IDS.wardenPrepared]: [CASTER_SPELL_IDS.whisperOfSalt] });
    const chosen = find(sheet, CASTER_SPELL_IDS.whisperOfSalt);
    expect(chosen, "the chosen spell did not reach the sheet").toBeDefined();
    expect(chosen).toMatchObject({ prepared: true, granted: false, alwaysPrepared: false });
    expect(chosen?.viaSelectionId).toBe(CASTER_SELECTION_IDS.wardenPrepared);
    // A prepared-model choice is not a claim that the spell is also "known".
    expect(chosen?.known).toBe(false);
  });

  it("keeps a selected known spell known", () => {
    const scribe: CharacterRecord = {
      ...warden({}),
      id: "character:scribe",
      classLevels: [{ classId: CASTER_IDS.runescribe, level: 1 }],
      spellSelections: {
        [CASTER_SELECTION_IDS.runescribeCantrips]: [CASTER_SPELL_IDS.emberSpark],
        [CASTER_SELECTION_IDS.runescribeKnown]: [CASTER_SPELL_IDS.bindingScript],
      },
    };
    const cantrip = find(scribe, CASTER_SPELL_IDS.emberSpark);
    const spell = find(scribe, CASTER_SPELL_IDS.bindingScript);
    expect(cantrip).toMatchObject({ known: true, prepared: false, granted: false });
    expect(spell).toMatchObject({ known: true, prepared: false, granted: false });
    expect(spell?.viaSelectionId).toBe(CASTER_SELECTION_IDS.runescribeKnown);
  });

  /**
   * The identity property the merge could most easily have broken: `hold-the-line`
   * is granted by the Warden *and* sits on the Warden's own list, so it can be
   * reached twice. It must still be one row carrying both facts.
   */
  it("produces one row for a spell reached by more than one route", () => {
    const sheet = warden({ [CASTER_SELECTION_IDS.wardenPrepared]: [CASTER_SPELL_IDS.holdTheLine] });
    const spells = spellsOf(sheet);
    const matches = spells.filter(spell => spell.id === CASTER_SPELL_IDS.holdTheLine);
    expect(matches, "a spell reachable twice produced two rows").toHaveLength(1);
    // And it carries both truths rather than the last one written.
    expect(matches[0]).toMatchObject({ granted: true, known: true, prepared: true });
    expect(matches[0]?.viaSelectionId).toBe(CASTER_SELECTION_IDS.wardenPrepared);

    // No spell identity is duplicated anywhere in the projection.
    const ids = spells.map(spell => spell.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still refuses to turn mere availability into possession", () => {
    const sheet = warden({});
    const ids = spellsOf(sheet).map(spell => spell.id);
    // On the Warden's own list, neither granted nor chosen.
    expect(ids, "list membership made a spell known").not.toContain(CASTER_SPELL_IDS.unbrokenVigil);
    // On a list this character's classes never reach.
    expect(ids).not.toContain(CASTER_SPELL_IDS.sealedVerse);
    // Exactly the two grants, and nothing else.
    expect(ids.sort()).toEqual([CASTER_SPELL_IDS.holdTheLine, CASTER_SPELL_IDS.wardensEye].sort());
  });

  /**
   * What the Spells workspace consumes. The badge is the sheet's one-line
   * summary of the state, so it is asserted against the projection rather than
   * left to a screenshot.
   */
  it("gives the Spells workspace a truthful single-state badge for each row", () => {
    const sheet = warden({ [CASTER_SELECTION_IDS.wardenPrepared]: [CASTER_SPELL_IDS.whisperOfSalt] });
    const spells = spellsOf(sheet);
    const distinguishGranted = spells.some(spell => spell.viaSelectionId !== undefined);
    expect(distinguishGranted, "this character both chose and was granted spells").toBe(true);

    const badgeFor = (id: string) => {
      const spell = spells.find(item => item.id === id);
      expect(spell, `${id} is not on the sheet`).toBeDefined();
      return spellStateBadge(spell!, distinguishGranted);
    };
    expect(badgeFor(CASTER_SPELL_IDS.wardensEye)).toBe("Always prepared");
    expect(badgeFor(CASTER_SPELL_IDS.whisperOfSalt)).toBe("Prepared");
    expect(badgeFor(CASTER_SPELL_IDS.holdTheLine)).toBe("Granted");
  });

  /**
   * A class that grants its whole repertoire and offers no choice: "granted" is
   * then true of every row and distinguishes nothing, so the sheet says nothing.
   */
  it("suppresses the granted marker when it would be on every row", () => {
    const sheet = warden({});
    const spells = spellsOf(sheet);
    const distinguishGranted = spells.some(spell => spell.viaSelectionId !== undefined);
    expect(distinguishGranted).toBe(false);
    expect(spellStateBadge(spells.find(item => item.id === CASTER_SPELL_IDS.holdTheLine)!, distinguishGranted)).toBeNull();
    // The always-prepared one still says what it is, because that is not a
    // property every row shares.
    expect(spellStateBadge(spells.find(item => item.id === CASTER_SPELL_IDS.wardensEye)!, distinguishGranted)).toBe(
      "Always prepared",
    );
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
