import { describe, expect, it } from "vitest";
import { resolveDerivedCharacter, UNKNOWN_DISPLAY, computeContentFingerprint } from "@/src/services/derived-resolver";
import { SYNTHETIC_ENTRIES, SYNTHETIC_IDS, SYNTHETIC_RULESET } from "@/src/content/runefolio-synthetic";
import { brammel, brammelRuntime } from "@/tests/fixtures/brammel";
import type { CharacterOverrideRecord } from "@/src/domain/character-record";

const resolve = (...args: Parameters<typeof brammel>) =>
  resolveDerivedCharacter({
    character: brammel(...args),
    runtime: brammelRuntime(),
    entries: SYNTHETIC_ENTRIES,
    ruleset: SYNTHETIC_RULESET,
  });

describe("Brammel at level 1", () => {
  const sheet = resolve();

  it("renders identity with the nickname carrying no mechanical weight", () => {
    expect(sheet.name).toBe("Brammel Voss");
    expect(sheet.nickname).toBe("Boss");
    expect(sheet.classLabel).toBe("Vanguard");
    expect(sheet.speciesLabel).toBe("Riverborn");
    expect(sheet.backgroundLabel).toBe("Caravan Warden");
    expect(sheet.mode).toBe("automatic");
    expect(sheet.completeness).toBe("guided-complete");
    expect(sheet.renderable).toBe(true);
    expect(sheet.confidence).toBe("calculated");
  });

  it("derives the six ability modifiers", () => {
    expect(sheet.abilities.strength.score.value).toBe(16);
    expect(sheet.abilities.strength.modifier.value).toBe(3);
    expect(sheet.abilities.dexterity.modifier.value).toBe(2);
    expect(sheet.abilities.constitution.modifier.value).toBe(2);
    expect(sheet.abilities.intelligence.modifier.value).toBe(1);
    expect(sheet.abilities.wisdom.modifier.value).toBe(0);
    expect(sheet.abilities.charisma.modifier.value).toBe(-1);
  });

  it("derives proficiency bonus, hit points, hit dice, armour class, initiative and speed", () => {
    expect(sheet.proficiencyBonus.value).toBe(2);
    // Vanguard class base 8 + Constitution +2.
    expect(sheet.hitPoints.maximum.value).toBe(10);
    expect(sheet.hitDice.value).toBe("1d8");
    // Travel Mail 14 + Dexterity capped at +2 + Round Guard 2.
    expect(sheet.armorClass.value).toBe(18);
    expect(sheet.initiative.value).toBe(2);
    expect(sheet.speed.value).toBe(30);
  });

  it("explains armour class with equipment contributors and source IDs", () => {
    const labels = sheet.armorClass.contributors.map(item => item.label);
    expect(labels).toContain("Travel Mail");
    expect(labels).toContain("Round Guard");
    expect(labels).toContain("Dexterity modifier (capped at +2)");
    const armour = sheet.armorClass.contributors.find(item => item.label === "Travel Mail");
    expect(armour?.amount).toBe(14);
    expect(armour?.entryId).toBe(SYNTHETIC_IDS.armor);
    expect(armour?.sourceId).toBe("source:runefolio-synthetic");
    expect(sheet.armorClass.contributors.reduce((sum, item) => sum + (item.amount ?? 0), 0)).toBe(18);
  });

  it("explains maximum hit points with the class base and the Constitution modifier", () => {
    expect(sheet.hitPoints.maximum.contributors).toEqual([
      expect.objectContaining({ kind: "base", amount: 8, entryId: SYNTHETIC_IDS.class }),
      expect.objectContaining({ kind: "ability", label: "Constitution modifier", amount: 2 }),
    ]);
  });

  it("derives saves and checks with and without proficiency", () => {
    const strengthSave = sheet.saves.find(item => item.ability === "strength");
    expect(strengthSave?.proficient).toBe(true);
    expect(strengthSave?.total.value).toBe(5);
    expect(sheet.saves.find(item => item.ability === "constitution")?.total.value).toBe(4);

    const haulage = sheet.checks.find(item => item.label === "Haulage");
    expect(haulage?.proficient).toBe(true);
    expect(haulage?.total.value).toBe(5);
    const parley = sheet.checks.find(item => item.label === "Parley");
    expect(parley?.proficient).toBe(false);
    expect(parley?.total.value).toBe(-1);
  });

  it("derives the Longblade Strike attack and its accessible expression", () => {
    expect(sheet.actions).toHaveLength(1);
    const [attack] = sheet.actions;
    expect(attack.id).toBe(SYNTHETIC_IDS.attack);
    expect(attack.kind).toBe("attack");
    // Strength +3 and proficiency +2.
    expect(attack.attackBonus.value).toBe(5);
    expect(attack.attackExpression).toBe("1d20 + 5");
    // 1d8 plus Strength +3 and Guarded Hand +1.
    expect(attack.damageExpression).toBe("1d8 + 4");
    expect(attack.damageContributors.map(item => item.label)).toEqual(["Strength modifier", "Guarded Hand"]);
    expect(attack.range).toBe("5 ft.");
  });

  it("derives the limited resource with its maximum and current uses", () => {
    expect(sheet.resources).toHaveLength(1);
    const [resource] = sheet.resources;
    expect(resource.id).toBe(SYNTHETIC_IDS.resource);
    expect(resource.label).toBe("Rallying Breath");
    expect(resource.maximum.value).toBe(3);
    expect(resource.current.value).toBe(3);
    expect(resource.recharge).toBe("short-rest");
  });

  it("lists equipment contributors and the active ruleset and source IDs", () => {
    expect(sheet.equipment.map(item => item.itemId).sort()).toEqual([
      SYNTHETIC_IDS.shield,
      SYNTHETIC_IDS.armor,
      "item:warden-pack",
      SYNTHETIC_IDS.weapon,
    ].sort());
    expect(sheet.equipment.find(item => item.itemId === SYNTHETIC_IDS.armor)?.armorContribution).toBe(14);
    expect(sheet.activeRulesetId).toBe("ruleset:runefolio-2024-synthetic");
    expect(sheet.activeRulesetLabel).toBe("Runefolio 2024 synthetic");
    expect(sheet.activeSourceIds).toEqual(["source:runefolio-synthetic"]);
  });

  it("is deterministic across repeated resolutions", () => {
    expect(JSON.stringify(resolve())).toBe(JSON.stringify(resolve()));
  });
});

describe("Brammel at level 2", () => {
  const sheet = resolve(2);

  it("applies the level-keyed hit point and resource increases", () => {
    expect(sheet.level).toBe(2);
    expect(sheet.hitPoints.maximum.value).toBe(12);
    expect(sheet.hitDice.value).toBe("2d8");
    expect(sheet.resources[0].maximum.value).toBe(4);
    expect(sheet.completeness).toBe("guided-complete");
  });

  it("records the weapon mastery granted by the level 2 choice", () => {
    expect(sheet.actions[0].masteryId).toBe(SYNTHETIC_IDS.mastery);
  });
});

describe("unknown required inputs", () => {
  it("resolves an unset ability to an unknown value with a recovery action, never zero", () => {
    const character = brammel();
    const sheet = resolveDerivedCharacter({
      character: { ...character, abilityScores: { ...character.abilityScores, constitution: undefined } },
      runtime: brammelRuntime(),
      entries: SYNTHETIC_ENTRIES,
    });

    expect(sheet.abilities.constitution.score.value).toBeNull();
    expect(sheet.abilities.constitution.modifier.value).toBeNull();
    expect(sheet.abilities.constitution.modifier.value).not.toBe(0);
    expect(sheet.abilities.constitution.modifier.recovery).toEqual({
      code: "ABILITY_SCORE_MISSING",
      fieldPath: "abilityScore.constitution",
      action: "Set ability score",
    });
    // A dependent value is blocked rather than guessed.
    expect(sheet.hitPoints.maximum.value).toBeNull();
    expect(sheet.completeness).toBe("incomplete");
    expect(sheet.renderable).toBe(false);
    expect(UNKNOWN_DISPLAY).toBe("—");
  });

  it("keeps the record saveable and names the non-sensitive field path in issues", () => {
    const character = brammel();
    const sheet = resolveDerivedCharacter({
      character: { ...character, abilityScores: {} },
      entries: SYNTHETIC_ENTRIES,
    });
    const paths = sheet.issues.filter(issue => issue.code === "ABILITY_SCORE_MISSING").map(issue => issue.fieldPath);
    expect(paths).toContain("abilityScore.strength");
    // The sheet carries the name because the UI renders it, but the sanitized
    // issue list must identify the problem by field path alone.
    expect(JSON.stringify(sheet.issues)).not.toContain(character.name);
    expect(sheet.issues.every(issue => issue.fieldPath !== undefined || issue.recordId !== undefined)).toBe(true);
  });

  it("attributes a blocked engine-derived value to the missing ability, not to a wrong cause", () => {
    const character = brammel();
    const sheet = resolveDerivedCharacter({ character: { ...character, abilityScores: {} }, entries: SYNTHETIC_ENTRIES });
    // Speed does not depend on an ability, but it cannot be resolved while the
    // rules evaluation is blocked; the recovery names the real blocker.
    expect(sheet.speed.recovery?.code).toBe("ABILITY_SCORE_MISSING");
    expect(sheet.speed.recovery?.action).toBe("Complete the ability scores");
  });
});

describe("renderable classifications", () => {
  it("classifies a classless character with the full manual minimum as renderable manual", () => {
    const sheet = resolveDerivedCharacter({
      character: brammel(1, {
        classLevels: [],
        presentation: "flexible",
        manualValues: {
          "hitPoints.maximum": 9,
          "hitPoints.current": 9,
          armorClass: 15,
          initiative: 1,
          speed: 30,
        },
        manualActions: [{ id: "manual-action:club", label: "Improvised swing", expression: "1d6 + 1" }],
      }),
      entries: SYNTHETIC_ENTRIES,
    });

    expect(sheet.mode).toBe("manual");
    expect(sheet.completeness).toBe("renderable-manual");
    expect(sheet.renderable).toBe(true);
    expect(sheet.armorClass.value).toBe(15);
    expect(sheet.armorClass.contributors).toEqual([{ kind: "manual", label: "Manual value" }]);
    // A manual sheet never claims automatic rules justification.
    expect(sheet.saves).toHaveLength(0);
    expect(sheet.checks).toHaveLength(0);
    expect(sheet.hitDice.value).toBeNull();
  });

  it("classifies a classless character missing manual values as incomplete", () => {
    const sheet = resolveDerivedCharacter({
      character: brammel(1, { classLevels: [], presentation: "flexible", manualValues: { armorClass: 15 } }),
      entries: SYNTHETIC_ENTRIES,
    });
    expect(sheet.mode).toBe("manual");
    expect(sheet.completeness).toBe("incomplete");
    expect(sheet.renderable).toBe(false);
    expect(sheet.hitPoints.maximum.recovery?.code).toBe("MANUAL_VALUE_MISSING");
  });

  it("classifies a renderable automatic character with an unresolved later choice", () => {
    const character = brammel(2);
    const sheet = resolveDerivedCharacter({
      character: {
        ...character,
        choiceSelections: Object.fromEntries(
          Object.entries(character.choiceSelections).filter(([id]) => id !== "choice:vanguard-mastery"),
        ),
      },
      runtime: brammelRuntime(),
      entries: SYNTHETIC_ENTRIES,
    });
    // Every automatic minimum still resolves, so the sheet renders, but the
    // outstanding choice keeps it short of guided-complete.
    expect(sheet.renderable).toBe(true);
    expect(sheet.completeness).toBe("renderable-automatic");
  });
});

describe("typed overrides", () => {
  const override = (partial: Partial<CharacterOverrideRecord>): CharacterOverrideRecord => ({
    id: "override:test",
    characterId: "character:brammel",
    targetPath: "armorClass",
    operation: "replace",
    value: 20,
    automaticBaseline: 18,
    scope: "persistent",
    status: "active",
    createdAt: "2026-08-03T08:00:00.000Z",
    updatedAt: "2026-08-03T08:00:00.000Z",
    ...partial,
  });

  const withOverride = (record: CharacterOverrideRecord) =>
    resolveDerivedCharacter({ character: brammel(), runtime: brammelRuntime(), overrides: [record], entries: SYNTHETIC_ENTRIES });

  it("replaces the automatic value and retains the baseline", () => {
    const sheet = withOverride(override({}));
    expect(sheet.armorClass.value).toBe(20);
    expect(sheet.armorClass.override).toEqual({ operation: "replace", value: 20, automaticBaseline: 18, stale: false });
  });

  it("adds a typed numeric modifier to the recalculated automatic baseline", () => {
    const sheet = withOverride(override({ operation: "add", value: 2 }));
    expect(sheet.armorClass.value).toBe(20);
    expect(sheet.armorClass.contributors.at(-1)).toEqual({ kind: "override", label: "Manual override", amount: 2 });
  });

  it("marks an override stale when the recalculated baseline moved, without discarding it", () => {
    const sheet = withOverride(override({ automaticBaseline: 15 }));
    expect(sheet.armorClass.override?.stale).toBe(true);
    expect(sheet.armorClass.value).toBe(20);
  });

  it("never executes an override whose target is no longer calculable", () => {
    const character = brammel();
    const sheet = resolveDerivedCharacter({
      character: { ...character, abilityScores: { ...character.abilityScores, dexterity: undefined } },
      overrides: [override({})],
      entries: SYNTHETIC_ENTRIES,
    });
    expect(sheet.armorClass.value).toBeNull();
    expect(sheet.armorClass.override?.stale).toBe(true);
  });

  it("ignores a stored target path that is not on the allow-list", () => {
    const sheet = withOverride(override({ targetPath: "biography.backstory" }));
    expect(sheet.armorClass.value).toBe(18);
    expect(sheet.armorClass.override).toBeUndefined();
  });
});

describe("missing source", () => {
  const withoutClass = SYNTHETIC_ENTRIES.filter(item => item.id !== SYNTHETIC_IDS.class);

  it("keeps the record readable, marks it uncertain and names the missing dependency", () => {
    const sheet = resolveDerivedCharacter({ character: brammel(), runtime: brammelRuntime(), entries: withoutClass });

    expect(sheet.missingDependencyIds).toContain(SYNTHETIC_IDS.class);
    expect(sheet.confidence).toBe("uncertain");
    expect(sheet.issues.some(issue => issue.code === "CLASS_SOURCE_MISSING")).toBe(true);
    // No nearest-match substitution occurs.
    expect(sheet.classLabel).toBeNull();
    expect(sheet.completeness).toBe("incomplete");
  });

  it("blocks affected calculations rather than recomputing them from a name match", () => {
    const sheet = resolveDerivedCharacter({ character: brammel(), runtime: brammelRuntime(), entries: withoutClass });
    expect(sheet.hitDice.value).toBeNull();
    expect(sheet.actions).toHaveLength(0);
  });
});

describe("explanation privacy", () => {
  it("excludes private full text, notes and biography from the resolved sheet", () => {
    const serialized = JSON.stringify(
      resolveDerivedCharacter({
        character: brammel(1, { manualValues: { armorClass: 3 } }),
        runtime: brammelRuntime(),
        overrides: [
          {
            id: "override:private",
            characterId: "character:brammel",
            targetPath: "armorClass",
            operation: "add",
            value: 1,
            automaticBaseline: 18,
            scope: "persistent",
            status: "active",
            reason: "table ruling recorded privately",
            createdAt: "2026-08-03T08:00:00.000Z",
            updatedAt: "2026-08-03T08:00:00.000Z",
          },
        ],
        entries: SYNTHETIC_ENTRIES,
      }),
    );

    expect(serialized).not.toContain("table ruling recorded privately");
    for (const entry of SYNTHETIC_ENTRIES) if (entry.fullText) expect(serialized).not.toContain(entry.fullText);
  });
});

describe("content fingerprint", () => {
  it("is stable for the same content and changes when a revision changes", () => {
    const baseline = computeContentFingerprint(SYNTHETIC_ENTRIES, "ruleset:runefolio-2024-synthetic");
    expect(computeContentFingerprint([...SYNTHETIC_ENTRIES].reverse(), "ruleset:runefolio-2024-synthetic")).toBe(baseline);
    const bumped = SYNTHETIC_ENTRIES.map((entry, index) => (index === 0 ? { ...entry, revision: 2 } : entry));
    expect(computeContentFingerprint(bumped, "ruleset:runefolio-2024-synthetic")).not.toBe(baseline);
  });
});
