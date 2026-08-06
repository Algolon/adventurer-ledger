import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  SECOND_ARRAY,
  SECOND_HIT_DIE,
  SECOND_IDS,
  SECOND_PROFICIENCIES,
  SECOND_RULESET,
  SECOND_RULESET_ID,
  secondSyntheticPack,
} from "@/tests/fixtures/second-ruleset";
import { SYNTHETIC_IDS, SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import { planBuild, standardArrayConsistent } from "@/src/services/build-planner";
import { proficiencyCatalog, scopeEntriesToRuleset, standardArrayFor } from "@/src/services/content-scope";
import { EMPTY_DRAFT_BUILD, type CharacterRecord } from "@/src/domain/character-record";
import type { ContentEntry } from "@/src/domain/model";

let harness: Harness;
beforeEach(async () => {
  harness = await createHarness();
});
afterEach(closeHarnesses);

/** Installs the second ruleset alongside the first. */
async function installSecondRuleset() {
  const document = secondSyntheticPack();
  const now = "2026-08-03T09:00:00.000Z";
  await harness.database.sources.put({ ...document.sources[0], createdAt: now, updatedAt: now } as never);
  await harness.database.contentEntries.bulkPut(document.entries as unknown as ContentEntry[]);
  await harness.database.contentPacks.put({
    ...document.pack,
    schemaVersion: document.schemaVersion,
    sourceIds: document.sources.map(source => source.id),
    entryIds: document.entries.map(entry => entry.id),
    createdAt: now,
    updatedAt: now,
  } as never);
  await harness.database.rulesetProfiles.put(SECOND_RULESET);
}

const secondCharacter = (): CharacterRecord => ({
  id: "character:tidewatcher",
  revision: 1,
  rulesetProfileId: SECOND_RULESET_ID,
  presentation: "guided",
  name: "Sella Marrow",
  level: 1,
  classLevels: [{ classId: SECOND_IDS.class, level: 1 }],
  speciesId: SECOND_IDS.species,
  backgroundId: SECOND_IDS.background,
  abilityMethod: "standard-array",
  abilityScores: { strength: 10, dexterity: 18, constitution: 13, intelligence: 9, wisdom: 15, charisma: 11 },
  choiceSelections: {
    [SECOND_IDS.skillChoice]: [`option:${SECOND_PROFICIENCIES.skillTidereading}`],
    [SECOND_IDS.masteryChoice]: ["option:tide-pull"],
  },
  equipmentSelections: { [SECOND_IDS.equipmentChoice]: ["equipment-option:tw-line"] },
  manualValues: {},
  manualActions: [],
  acknowledgedIssueCodes: [],
  contentFingerprint: "fingerprint:test",
  status: "active",
  kind: "player-character",
  tags: [],
  createdAt: "2026-08-03T08:00:00.000Z",
  updatedAt: "2026-08-03T08:00:00.000Z",
});

describe("the product layer contains no first-ruleset assumptions", () => {
  it("derives a second ruleset's character from its own content", async () => {
    await installSecondRuleset();
    const all = await harness.database.contentEntries.toArray();
    const entries = scopeEntriesToRuleset(all, SECOND_RULESET);

    const sheet = resolveDerivedCharacter({ character: secondCharacter(), entries, ruleset: SECOND_RULESET });

    // The hit die comes from this class, not from the first slice's d8.
    expect(sheet.hitDice.value).toBe(`1d${SECOND_HIT_DIE}`);
    // Hit points: class base 12 plus Constitution +1.
    expect(sheet.hitPoints.maximum.value).toBe(13);
    // Saves are this ruleset's, not Strength and Constitution.
    expect(sheet.saves.map(save => save.ability)).toEqual(["dexterity", "wisdom"]);
    expect(sheet.saves.every(save => save.proficient)).toBe(true);
    // Skills come from this ruleset's proficiency definitions and their abilities.
    expect(sheet.checks.map(check => check.label).sort()).toEqual(["Ropework", "Tidereading"]);
    expect(sheet.checks.find(check => check.label === "Ropework")?.ability).toBe("dexterity");
    // Armour class: Scale Wrap 12 plus full Dexterity +4.
    expect(sheet.armorClass.value).toBe(16);
    // The attack and its mastery resolve through declarative relations.
    expect(sheet.actions[0].id).toBe(SECOND_IDS.attack);
    expect(sheet.actions[0].masteryId).toBe(SECOND_IDS.mastery);
    expect(sheet.actions[0].attackExpression).toBe("1d20 + 6");
    expect(sheet.resources[0].id).toBe(SECOND_IDS.resource);
    expect(sheet.resources[0].recharge).toBe("long-rest");
    expect(sheet.completeness).toBe("guided-complete");
  });

  it("plans a second ruleset's build with its own array and equipment choice", async () => {
    await installSecondRuleset();
    const all = await harness.database.contentEntries.toArray();
    const entries = scopeEntriesToRuleset(all, SECOND_RULESET);

    expect(standardArrayFor(entries)).toEqual([...SECOND_ARRAY]);
    const catalog = proficiencyCatalog(entries);
    expect(catalog.saves.map(save => save.id)).toEqual([SECOND_PROFICIENCIES.saveDexterity, SECOND_PROFICIENCIES.saveWisdom]);

    const build = {
      ...EMPTY_DRAFT_BUILD,
      name: "Sella",
      classId: SECOND_IDS.class,
      speciesId: SECOND_IDS.species,
      backgroundId: SECOND_IDS.background,
      abilityScores: { strength: 10, dexterity: 18, constitution: 13, intelligence: 9, wisdom: 15, charisma: 11 },
      choiceSelections: { [SECOND_IDS.skillChoice]: [`option:${SECOND_PROFICIENCIES.skillTidereading}`] },
      equipmentSelections: {},
    };
    const plan = planBuild(build, entries);
    // The equipment issue names this ruleset's own choice, not the first one's.
    expect(plan.issues).toContainEqual({
      code: "EQUIPMENT_CHOICE_REQUIRED",
      recordId: SECOND_IDS.equipmentChoice,
      severity: "error",
    });
    expect(plan.issues.some(issue => issue.recordId === "equipment-choice:vanguard-pack")).toBe(false);

    // 18/15/13/11/10/9 is the Tidewatch array with +2 Dexterity and +1 Wisdom.
    expect(standardArrayConsistent(build, entries)).toBe(true);
  });
});

describe("unrelated pack isolation", () => {
  it("leaves an existing character's fingerprint and sheet untouched", async () => {
    // Build a first-ruleset character before the second pack exists.
    const before = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
    const character: CharacterRecord = {
      ...secondCharacter(),
      id: "character:first",
      rulesetProfileId: SYNTHETIC_RULESET_ID,
      classLevels: [{ classId: SYNTHETIC_IDS.class, level: 1 }],
      speciesId: SYNTHETIC_IDS.species,
      backgroundId: SYNTHETIC_IDS.background,
      abilityScores: { strength: 16, dexterity: 15, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
      choiceSelections: {
        "choice:vanguard-stance": ["option:guarded-hand"],
        "choice:vanguard-skills": ["option:proficiency:skill-riverlore", "option:proficiency:skill-haulage"],
        "choice:warden-languages": ["option:proficiency:language-trade-cant"],
      },
      equipmentSelections: { "equipment-choice:vanguard-pack": ["equipment-option:warden-pack"] },
    };
    await harness.database.characters.put(character);
    const sheetBefore = await harness.query.sheet("character:first");

    await installSecondRuleset();

    const after = await harness.query.contentFingerprint(SYNTHETIC_RULESET_ID);
    const sheetAfter = await harness.query.sheet("character:first");

    expect(after).toBe(before);
    expect(sheetAfter?.armorClass.value).toBe(sheetBefore?.armorClass.value);
    expect(sheetAfter?.hitDice.value).toBe(sheetBefore?.hitDice.value);
    // The unrelated source does not appear on this character's sheet.
    expect(sheetAfter?.activeSourceIds).toEqual(["source:runefolio-synthetic"]);
    // Nor do the other ruleset's saves and skills.
    expect(sheetAfter?.checks.map(check => check.label)).not.toContain("Tidereading");
    expect(sheetAfter?.saves.map(save => save.ability)).toEqual([
      "strength",
      "dexterity",
      "constitution",
      "intelligence",
      "wisdom",
      "charisma",
    ]);
  });

  it("does not offer another ruleset's options in the builder", async () => {
    await installSecondRuleset();
    const first = await harness.query.contentForRuleset(SYNTHETIC_RULESET_ID);
    expect(first.some(entry => entry.id === SECOND_IDS.class)).toBe(false);
    expect(first.some(entry => entry.id === SYNTHETIC_IDS.class)).toBe(true);
    expect(standardArrayFor(first)).toEqual([15, 14, 13, 12, 10, 8]);
  });
});

describe("no synthetic stable IDs leak into the generic layer", () => {
  /** Files that may legitimately name first-slice content. */
  const ALLOWED = [join("src", "content")];

  const walk = (directory: string): string[] =>
    readdirSync(directory).flatMap(name => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? walk(path) : path.endsWith(".ts") || path.endsWith(".tsx") ? [path] : [];
    });

  it("keeps Vanguard-specific IDs and constants out of services, storage and UI", () => {
    const forbidden = [
      "class:vanguard",
      "species:riverborn",
      "background:caravan-warden",
      "weapon:longblade",
      "armor:travel-mail",
      "armor:round-guard",
      "action:longblade-strike",
      "resource:rallying-breath",
      "mastery:measured-cut",
      "style:guarded-hand",
      "equipment-choice:vanguard-pack",
      "VANGUARD_",
      "SYNTHETIC_IDS",
      "SAVE_PROFICIENCIES",
      "SKILL_PROFICIENCIES",
      "runefolio-synthetic",
    ];
    const offenders: string[] = [];
    for (const file of [...walk("src"), ...walk("app")]) {
      if (ALLOWED.some(allowed => file.startsWith(allowed))) continue;
      const contents = readFileSync(file, "utf8");
      for (const needle of forbidden) if (contents.includes(needle)) offenders.push(`${file} :: ${needle}`);
    }
    expect(offenders).toEqual([]);
  });
});
