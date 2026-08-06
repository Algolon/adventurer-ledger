/**
 * The spellcasting projection, audited as a declaration reader.
 *
 * The claim under test is that casting is *read* rather than known: no class
 * name, spell name or fixture ID appears in the resolver, the attack and save DC
 * exist only when the declaration supplies their inputs, and a declaration that
 * does not parse produces no casting rather than a partially-guessed one.
 *
 * Every case is driven by editing the declaration entry itself, which is what
 * makes the result evidence: if the resolver had a special case for the fixture
 * class, moving the declaration to a different class would not move the casting.
 */
import { describe, expect, it } from "vitest";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import {
  RUNECALLER_IDS,
  RUNECALLER_CHOICES,
  SYNTHETIC_CHOICES,
  SYNTHETIC_ENTRIES,
  SYNTHETIC_IDS,
  SYNTHETIC_RULESET,
  SYNTHETIC_RULESET_ID,
} from "@/src/content/runefolio-synthetic";
import { brammel, brammelRuntime } from "@/tests/fixtures/brammel";
import type { CharacterRecord } from "@/src/domain/character-record";
import type { ContentEntry } from "@/src/domain/model";

const AT = "2026-08-03T08:00:00.000Z";

/** The caster, as the builder commits one. Wisdom 15 is a +2 modifier. */
function caster(overrides: Partial<CharacterRecord> = {}): CharacterRecord {
  return {
    id: "character:sereth",
    revision: 1,
    rulesetProfileId: SYNTHETIC_RULESET_ID,
    presentation: "guided",
    name: "Sereth Marsh",
    level: 1,
    classLevels: [{ classId: RUNECALLER_IDS.class, level: 1 }],
    speciesId: SYNTHETIC_IDS.species,
    backgroundId: SYNTHETIC_IDS.background,
    abilityMethod: "standard-array",
    abilityScores: { strength: 10, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 15, charisma: 8 },
    choiceSelections: {
      [RUNECALLER_CHOICES.classSkills]: ["option:runecaller-proficiency:skill-riverlore"],
      [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
    },
    equipmentSelections: { "equipment-choice:runecaller-kit": ["equipment-option:runecaller-warden-pack"] },
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
    contentFingerprint: "fingerprint:test",
    status: "active",
    kind: "player-character",
    tags: [],
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

/** Replaces the `data` of the one spellcasting declaration in the content. */
function withDeclaration(data: unknown): ContentEntry[] {
  return SYNTHETIC_ENTRIES.map(entry =>
    entry.id === RUNECALLER_IDS.spellcastingRule
      ? ({ ...entry, mechanics: { kind: "spellcasting", data } } as ContentEntry)
      : entry,
  );
}

const declaration = () => {
  const entry = SYNTHETIC_ENTRIES.find(item => item.id === RUNECALLER_IDS.spellcastingRule)!;
  return { ...((entry.mechanics as { data: Record<string, unknown> }).data) };
};

const resolve = (character: CharacterRecord, entries: readonly ContentEntry[] = SYNTHETIC_ENTRIES) =>
  resolveDerivedCharacter({ character, entries, ruleset: SYNTHETIC_RULESET });

describe("spellcasting appears only for a class the character actually owns", () => {
  it("projects casting for the caster", () => {
    const sheet = resolve(caster());
    expect(sheet.spellcasting).toBeDefined();
    expect(sheet.spellcasting?.abilityLabel).toBe("Wisdom");
  });

  it("gives a martial character no casting at all, so there is no empty Spells tab", () => {
    const sheet = resolveDerivedCharacter({
      character: brammel(),
      runtime: brammelRuntime(),
      entries: SYNTHETIC_ENTRIES,
      ruleset: SYNTHETIC_RULESET,
    });
    expect(sheet.spellcasting).toBeUndefined();
  });

  it("follows the declaration when it is moved to a different class", () => {
    // The declaration now names the martial class. The martial character gains
    // casting and the caster loses it — which only holds if nothing is keyed to
    // a class by name.
    const entries = withDeclaration({ ...declaration(), classId: SYNTHETIC_IDS.class });

    expect(
      resolveDerivedCharacter({
        character: brammel(),
        runtime: brammelRuntime(),
        entries,
        ruleset: SYNTHETIC_RULESET,
      }).spellcasting,
    ).toBeDefined();
    expect(resolve(caster(), entries).spellcasting).toBeUndefined();
  });

  it("gives no casting when the declaration names a class nobody has", () => {
    const entries = withDeclaration({ ...declaration(), classId: "class:nobody-has-this" });
    expect(resolve(caster(), entries).spellcasting).toBeUndefined();
  });
});

describe("the attack and the save DC exist only when their inputs are declared", () => {
  it("computes both from the declared ability, proficiency flag and DC base", () => {
    const sheet = resolve(caster());
    // Wisdom 15 is +2, proficiency at level 1 is +2.
    expect(sheet.spellcasting?.spellAttack?.value).toBe(4);
    expect(sheet.spellcasting?.saveDc?.value).toBe(12);
  });

  it("omits the attack entirely when the declaration is not proficient", () => {
    const entries = withDeclaration({ ...declaration(), attackProficient: false });
    const sheet = resolve(caster(), entries);
    expect(sheet.spellcasting).toBeDefined();
    expect(sheet.spellcasting?.spellAttack).toBeNull();
    expect(sheet.spellcasting?.saveDc?.value).toBe(12);
  });

  it("omits the save DC entirely when no base is declared", () => {
    const { saveDcBase: _omitted, ...withoutBase } = declaration();
    const sheet = resolve(caster(), withDeclaration(withoutBase));
    expect(sheet.spellcasting?.saveDc).toBeNull();
    expect(sheet.spellcasting?.spellAttack?.value).toBe(4);
  });

  /**
   * With an ability score unset, the rules evaluation the projection reads does
   * not run at all, so there is no casting summary rather than a summary with
   * guessed numbers in it. The build is reported as incomplete by its own
   * issues, which is where that gap belongs.
   */
  it("shows no casting summary at all when an ability score is not set", () => {
    const sheet = resolve(caster({ abilityScores: { strength: 10 } }));
    expect(sheet.spellcasting).toBeUndefined();
    expect(sheet.completeness).toBe("incomplete");
    expect(sheet.issues.map(issue => issue.code)).toContain("ABILITY_SCORE_MISSING");
  });

  it("explains the numbers as named inputs with signed amounts, not as an expression", () => {
    const attack = resolve(caster()).spellcasting!.spellAttack!;
    expect(attack.contributors.map(item => item.label)).toEqual(["Wisdom modifier", "Proficiency bonus"]);
    expect(attack.contributors.map(item => item.amount)).toEqual([2, 2]);
    const dc = resolve(caster()).spellcasting!.saveDc!;
    expect(dc.contributors.map(item => item.label)).toEqual(["Base", "Wisdom modifier", "Proficiency bonus"]);
    expect(dc.contributors.reduce((sum, item) => sum + (item.amount ?? 0), 0)).toBe(12);
  });

  it("reads whichever ability the declaration names", () => {
    const sheet = resolve(caster(), withDeclaration({ ...declaration(), ability: "charisma" }));
    expect(sheet.spellcasting?.abilityLabel).toBe("Charisma");
    // Charisma 8 is −1; the attack follows the declaration, not the class.
    expect(sheet.spellcasting?.spellAttack?.value).toBe(1);
  });
});

describe("a malformed declaration fails safely", () => {
  const malformed: readonly [string, unknown][] = [
    ["an unknown ability", { classId: RUNECALLER_IDS.class, ability: "luck" }],
    ["a missing class", { ability: "wisdom" }],
    ["a non-object payload", "wisdom"],
    ["an out-of-range DC base", { classId: RUNECALLER_IDS.class, ability: "wisdom", saveDcBase: 400 }],
    ["a slot list that is not a list", { classId: RUNECALLER_IDS.class, ability: "wisdom", slotResourceIds: 3 }],
  ];

  for (const [label, data] of malformed)
    it(`produces no casting for ${label}, rather than a partial one`, () => {
      const sheet = resolve(caster(), withDeclaration(data));
      expect(sheet.spellcasting).toBeUndefined();
      // The rest of the sheet still resolves; one bad declaration is not fatal.
      expect(sheet.hitPoints.maximum.value).not.toBeNull();
    });
});

describe("slots and spells", () => {
  it("names only slot resources the sheet actually has", () => {
    const sheet = resolve(caster());
    expect(sheet.spellcasting?.slotResourceIds).toEqual([RUNECALLER_IDS.slots]);
    for (const id of sheet.spellcasting!.slotResourceIds)
      expect(sheet.resources.some(resource => resource.id === id)).toBe(true);
  });

  it("drops a declared slot ID the character has no such resource for", () => {
    const entries = withDeclaration({
      ...declaration(),
      slotResourceIds: [RUNECALLER_IDS.slots, "resource:not-granted"],
    });
    expect(resolve(caster(), entries).spellcasting?.slotResourceIds).toEqual([RUNECALLER_IDS.slots]);
  });

  it("lists the granted spells in level then name order", () => {
    const spells = resolve(caster()).spellcasting!.spells;
    expect(spells.length).toBeGreaterThan(0);
    const keys = spells.map(spell => `${spell.level}|${spell.label}`);
    expect(keys).toEqual([...keys].sort());
  });

  /**
   * A spell the content no longer defines becomes a missing dependency, which
   * is what makes the sheet report uncertainty rather than quietly shortening
   * the list — and what stops an invented row appearing in its place.
   */
  it("turns a spell with no entry into a missing dependency, not an invented row", () => {
    const entries = SYNTHETIC_ENTRIES.filter(entry => entry.id !== RUNECALLER_IDS.spells.emberline);
    const sheet = resolve(caster(), entries);
    expect(sheet.spellcasting?.spells.some(spell => spell.id === RUNECALLER_IDS.spells.emberline)).toBe(false);
    expect(sheet.missingDependencyIds).toContain(RUNECALLER_IDS.spells.emberline);
    expect(sheet.confidence).toBe("uncertain");
  });

  /**
   * The projection carries content IDs a player's own selections produced — a
   * spell ID, a resource ID — and nothing about where that content came from.
   *
   * Both the field names and the ID prefixes are checked structurally rather
   * than by scanning the serialized form: `slotResourceIds` contains the letters
   * of `sourceId`, and `resource:` contains the letters of `source:`, so a
   * substring sweep reports provenance that is not there.
   */
  it("carries no ruleset, pack, source or fingerprint identifier", () => {
    const casting = resolve(caster()).spellcasting!;

    const fields = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(fields)
        : value && typeof value === "object"
          ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...fields(child)])
          : [];
    for (const field of fields(casting))
      expect(["sourceId", "packId", "rulesetProfileId", "contentFingerprint"]).not.toContain(field);

    const ids = [...casting.slotResourceIds, ...casting.spells.map(spell => spell.id)];
    for (const id of ids)
      for (const prefix of ["pack:", "source:", "ruleset:", "fp1:"]) expect(id.startsWith(prefix)).toBe(false);
  });
});

/**
 * Multiclassing is out of scope for this iteration, and the behaviour is
 * recorded rather than asserted as correct: with two classes each declaring
 * casting, the projection takes the first declaration it finds and offers no
 * combined slot progression. That is a known limitation, written down here so
 * the next change to it is deliberate.
 */
describe("multiclass casting is unresolved, and documented as such", () => {
  it("projects exactly one declaration when a character holds two casting classes", () => {
    const second = SYNTHETIC_ENTRIES.find(entry => entry.id === RUNECALLER_IDS.spellcastingRule)!;
    const entries: ContentEntry[] = [
      ...SYNTHETIC_ENTRIES,
      {
        ...second,
        id: "rule:second-spellcasting",
        slug: "second-spellcasting",
        name: "Second spellcasting",
        mechanics: { kind: "spellcasting", data: { ...declaration(), classId: SYNTHETIC_IDS.class, ability: "charisma" } },
      } as ContentEntry,
    ];
    const sheet = resolve(
      caster({
        level: 2,
        classLevels: [
          { classId: RUNECALLER_IDS.class, level: 1 },
          { classId: SYNTHETIC_IDS.class, level: 1 },
        ],
      }),
      entries,
    );

    // One projection, not two, and not a merge of the two.
    expect(sheet.spellcasting).toBeDefined();
    expect(["Wisdom", "Charisma"]).toContain(sheet.spellcasting?.abilityLabel);
  });
});
