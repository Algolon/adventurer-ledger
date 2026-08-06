import { describe, expect, it } from "vitest";
import {
  BUILDER_STEPS,
  classHasSpells,
  planBuild,
  recommendationsFor,
  remainingArraySlots,
  requiredChoicesFor,
  resourceIdsFor,
  standardArrayConsistent,
} from "@/src/services/build-planner";
import { SYNTHETIC_CHOICES, SYNTHETIC_EQUIPMENT_CHOICE, SYNTHETIC_ENTRIES, SYNTHETIC_IDS } from "@/src/content/runefolio-synthetic";
import { EMPTY_DRAFT_BUILD, type CharacterDraftBuild } from "@/src/domain/character-record";
import type { ContentEntry } from "@/src/domain/model";

const complete: CharacterDraftBuild = {
  ...EMPTY_DRAFT_BUILD,
  name: "Brammel Voss",
  level: 1,
  classId: SYNTHETIC_IDS.class,
  speciesId: SYNTHETIC_IDS.species,
  backgroundId: SYNTHETIC_IDS.background,
  abilityScores: { strength: 16, dexterity: 15, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
  choiceSelections: {
    [SYNTHETIC_CHOICES.fightingStyle]: ["option:guarded-hand"],
    [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-riverlore", "option:proficiency:skill-haulage"],
    [SYNTHETIC_CHOICES.backgroundLanguage]: ["option:proficiency:language-trade-cant"],
  },
  equipmentSelections: { [SYNTHETIC_EQUIPMENT_CHOICE]: ["equipment-option:warden-pack"] },
};

const plan = (build: CharacterDraftBuild, presentation: "guided" | "flexible" = "guided") =>
  planBuild(build, SYNTHETIC_ENTRIES, presentation);

const SPELL_CLASS_ID = "class:tidecaller-synthetic";

/**
 * An original synthetic class that does have a spell effect.
 *
 * Applicability is read from content, so proving the Spells step returns needs
 * content that grants a spell — not a change to the planner. This clones the
 * existing synthetic class and adds one `addSpell` effect; it introduces no
 * spellcasting rules and no official material.
 */
function spellCapableClassEntries(): ContentEntry[] {
  const base = SYNTHETIC_ENTRIES.find(entry => entry.id === SYNTHETIC_IDS.class);
  if (!base) throw new Error("The synthetic class fixture is missing");
  return [
    {
      ...base,
      id: SPELL_CLASS_ID,
      slug: "tidecaller-synthetic",
      name: "Tidecaller",
      effects: [
        ...base.effects,
        { id: "effect:tidecaller-tide-whisper", type: "addSpell", spellId: "spell:tide-whisper-synthetic" },
      ],
    },
  ];
}

describe("step list", () => {
  it("is exactly the accepted nine steps in order", () => {
    expect(BUILDER_STEPS.map(step => step.id)).toEqual([
      "start", "class", "origin", "abilities", "class-choices", "spells-resources", "equipment", "identity", "review",
    ]);
    expect(BUILDER_STEPS.map(step => step.label)).toEqual([
      "Basics", "Class & level", "Origin", "Abilities", "Class choices", "Spells & resources", "Equipment", "Identity", "Review",
    ]);
  });

  /**
   * Supersedes the earlier requirement that a non-applicable step stay in the
   * sequence marked "Not needed". The owner changed that product decision after
   * an exploratory review: an empty screen the user must walk through is flow
   * weight, not information. What does not apply is stated once, on the review.
   */
  it("omits a step with nothing to decide instead of showing an empty screen", () => {
    const result = plan(complete);
    const ids = result.steps.map(step => step.id);

    expect(classHasSpells(complete, SYNTHETIC_ENTRIES)).toBe(false);
    expect(ids).not.toContain("spells-resources");
    expect(result.steps).toHaveLength(8);
    // The remaining steps keep their canonical order.
    expect(ids).toEqual(["start", "class", "origin", "abilities", "class-choices", "equipment", "identity", "review"]);
    // The resource itself is unaffected; it is tracked on the sheet.
    expect(resourceIdsFor(complete, SYNTHETIC_ENTRIES)).toEqual([SYNTHETIC_IDS.resource]);
  });

  it("states the non-applicable system on the review instead of as a step", () => {
    const spellcasting = plan(complete).systemSummaries.find(summary => summary.id === "spellcasting");
    expect(spellcasting?.applicable).toBe(false);
    expect(spellcasting?.label).toBe("Spellcasting");
    expect(spellcasting?.value).toBe("None at this level");
  });

  it("includes the step, in order, for a class that does have spell choices", () => {
    // The applicability comes from the class's own content, so a spell-capable
    // class brings the step back with no change to the planner.
    const build = { ...complete, classId: SPELL_CLASS_ID };
    const entries = [...SYNTHETIC_ENTRIES, ...spellCapableClassEntries()];
    expect(classHasSpells(build, entries)).toBe(true);

    const result = planBuild(build, entries);
    const ids = result.steps.map(step => step.id);
    expect(ids).toContain("spells-resources");
    expect(ids.indexOf("spells-resources")).toBe(ids.indexOf("class-choices") + 1);
    expect(ids.indexOf("spells-resources")).toBe(ids.indexOf("equipment") - 1);
    expect(result.systemSummaries.find(summary => summary.id === "spellcasting")?.applicable).toBe(true);
  });
});

describe("standard-array slots", () => {
  it("removes one slot per assignment, in declaration order", () => {
    expect(remainingArraySlots([15, 14, 13, 12, 10, 8], [15])).toEqual([14, 13, 12, 10, 8]);
    expect(remainingArraySlots([15, 14, 13, 12, 10, 8], [15, 12])).toEqual([14, 13, 10, 8]);
  });

  it("ignores unassigned abilities", () => {
    expect(remainingArraySlots([15, 14, 13], [undefined, 14, undefined])).toEqual([15, 13]);
  });

  it("tracks a repeated value as two independent slots", () => {
    // The defining case: a Set of numbers would let one 13 serve both abilities.
    const array = [15, 13, 13, 12, 10, 8];
    expect(remainingArraySlots(array, [13])).toEqual([15, 13, 12, 10, 8]);
    expect(remainingArraySlots(array, [13, 13])).toEqual([15, 12, 10, 8]);
    // Exhausted only after both occurrences are taken.
    expect(remainingArraySlots(array, [13, 13]).includes(13)).toBe(false);
  });

  it("returns everything when nothing is assigned, and nothing when all are", () => {
    const array = [15, 14, 13, 12, 10, 8];
    expect(remainingArraySlots(array, [])).toEqual(array);
    expect(remainingArraySlots(array, array)).toEqual([]);
  });

  it("ignores a value that is not part of the array", () => {
    expect(remainingArraySlots([15, 14], [18])).toEqual([15, 14]);
  });
});

describe("issue planning", () => {
  it("reports a complete build as guided-complete with no issues", () => {
    const result = plan(complete);
    expect(result.guidedComplete).toBe(true);
    expect(result.issueCount).toBe(0);
    expect(result.nextUnresolvedStepId).toBe("review");
  });

  it("walks an empty draft to the first dependency-relevant unresolved step", () => {
    const result = plan(EMPTY_DRAFT_BUILD);
    expect(result.nextUnresolvedStepId).toBe("class");
    expect(result.issues.map(issue => issue.code)).toContain("CLASS_NOT_CHOSEN");
    expect(result.guidedComplete).toBe(false);
  });

  it("advances to origin once the class is chosen", () => {
    expect(plan({ ...EMPTY_DRAFT_BUILD, classId: SYNTHETIC_IDS.class }).nextUnresolvedStepId).toBe("origin");
  });

  it("identifies each missing ability by non-sensitive field path", () => {
    const result = plan({ ...complete, abilityScores: { strength: 16 } });
    const paths = result.issues.filter(issue => issue.code === "ABILITY_SCORE_MISSING").map(issue => issue.fieldPath);
    expect(paths).toEqual([
      "abilityScore.dexterity", "abilityScore.constitution", "abilityScore.intelligence", "abilityScore.wisdom", "abilityScore.charisma",
    ]);
    expect(result.nextUnresolvedStepId).toBe("abilities");
  });

  it("accepts final scores that the standard array plus the origin increases can produce", () => {
    // 16/15/14/12/10/8 is 15/14/13/12/10/8 with the Caravan Warden +2 Strength
    // and +1 Constitution applied.
    expect(standardArrayConsistent(complete, SYNTHETIC_ENTRIES)).toBe(true);
    expect(plan(complete).issues.map(issue => issue.code)).not.toContain("STANDARD_ARRAY_MISMATCH");
  });

  it("warns when no assignment of the array and origin increases produces the scores", () => {
    const inflated = { ...complete, abilityScores: { ...complete.abilityScores, charisma: 18 } };
    expect(standardArrayConsistent(inflated, SYNTHETIC_ENTRIES)).toBe(false);
    const result = plan(inflated);
    expect(result.issues).toContainEqual({ code: "STANDARD_ARRAY_MISMATCH", fieldPath: "abilityMethod", severity: "warning" });
    // A warning never blocks the build.
    expect(result.guidedComplete).toBe(true);
  });

  it("does not run the array check for manually entered scores", () => {
    const manual = { ...complete, abilityMethod: "manual" as const, abilityScores: { ...complete.abilityScores, charisma: 18 } };
    expect(plan(manual).issues.map(issue => issue.code)).not.toContain("STANDARD_ARRAY_MISMATCH");
  });

  it("flags an unresolved class choice against its stable choice ID", () => {
    const result = plan({ ...complete, choiceSelections: { ...complete.choiceSelections, [SYNTHETIC_CHOICES.fightingStyle]: [] } });
    expect(result.issues).toContainEqual({ code: "CHOICE_UNRESOLVED", recordId: SYNTHETIC_CHOICES.fightingStyle, severity: "error" });
    expect(result.nextUnresolvedStepId).toBe("class-choices");
  });

  it("flags an unresolved equipment choice", () => {
    const result = plan({ ...complete, equipmentSelections: {} });
    expect(result.issues).toContainEqual({ code: "EQUIPMENT_CHOICE_REQUIRED", recordId: SYNTHETIC_EQUIPMENT_CHOICE, severity: "error" });
  });

  it("treats a missing name as a warning that never blocks the build", () => {
    const result = plan({ ...complete, name: "  " });
    expect(result.issues).toContainEqual({ code: "NAME_NOT_SET", fieldPath: "name", severity: "warning" });
    expect(result.guidedComplete).toBe(true);
    expect(result.steps.find(step => step.id === "identity")?.status).toBe("complete");
  });

  it("reports a missing source by stable ID rather than by name", () => {
    const result = plan({ ...complete, classId: "class:absent" });
    expect(result.issues).toContainEqual({ code: "CLASS_SOURCE_MISSING", recordId: "class:absent", severity: "error" });
  });
});

describe("required choices", () => {
  it("requires only the level 1 choices at level 1", () => {
    const ids = requiredChoicesFor(complete, SYNTHETIC_ENTRIES).map(choice => choice.choiceId).sort();
    expect(ids).toEqual([SYNTHETIC_CHOICES.backgroundLanguage, SYNTHETIC_CHOICES.classSkills, SYNTHETIC_CHOICES.fightingStyle].sort());
    expect(ids).not.toContain(SYNTHETIC_CHOICES.weaponMastery);
  });

  it("adds the weapon mastery choice at level 2", () => {
    const ids = requiredChoicesFor({ ...complete, level: 2 }, SYNTHETIC_ENTRIES).map(choice => choice.choiceId);
    expect(ids).toContain(SYNTHETIC_CHOICES.weaponMastery);
  });

  it("marks a choice resolved only within its own min and max", () => {
    const under = requiredChoicesFor(
      { ...complete, choiceSelections: { ...complete.choiceSelections, [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-haulage"] } },
      SYNTHETIC_ENTRIES,
    ).find(choice => choice.choiceId === SYNTHETIC_CHOICES.classSkills);
    expect(under?.resolved).toBe(false);

    const duplicated = requiredChoicesFor(
      {
        ...complete,
        choiceSelections: {
          ...complete.choiceSelections,
          [SYNTHETIC_CHOICES.classSkills]: ["option:proficiency:skill-haulage", "option:proficiency:skill-haulage"],
        },
      },
      SYNTHETIC_ENTRIES,
    ).find(choice => choice.choiceId === SYNTHETIC_CHOICES.classSkills);
    expect(duplicated?.resolved).toBe(false);
  });
});

describe("guided recommendations", () => {
  it("ranks a context-valid class recommendation with Why this copy", () => {
    // Both fixture classes are context-valid for an empty draft; each carries
    // its own Why this copy and none of them is auto-applied.
    const recommendations = recommendationsFor("class", EMPTY_DRAFT_BUILD, SYNTHETIC_ENTRIES);
    expect(recommendations.map(recommendation => recommendation.optionId)).toContain(SYNTHETIC_IDS.class);
    expect(recommendations.every(recommendation => recommendation.why.length > 0)).toBe(true);
  });

  it("explains the ability method against the class's primary ability", () => {
    const recommendations = recommendationsFor("abilities", { ...EMPTY_DRAFT_BUILD, classId: SYNTHETIC_IDS.class }, SYNTHETIC_ENTRIES);
    expect(recommendations[0].optionId).toBe("standard-array");
    expect(recommendations[0].why).toContain("Strength");
    expect(recommendations.map(item => item.optionId)).toContain("manual");
  });

  it("never applies a recommendation to the build", () => {
    const before = structuredClone(EMPTY_DRAFT_BUILD);
    recommendationsFor("class", EMPTY_DRAFT_BUILD, SYNTHETIC_ENTRIES);
    recommendationsFor("origin", EMPTY_DRAFT_BUILD, SYNTHETIC_ENTRIES);
    expect(EMPTY_DRAFT_BUILD).toEqual(before);
    expect(plan(EMPTY_DRAFT_BUILD).issues.map(issue => issue.code)).toContain("CLASS_NOT_CHOSEN");
  });
});

describe("presentation mode", () => {
  it("produces the same issues and selections for guided and flexible drafts", () => {
    const guided = plan(complete, "guided");
    const flexible = plan(complete, "flexible");
    expect(flexible.issues).toEqual(guided.issues);
    expect(flexible.requiredChoices).toEqual(guided.requiredChoices);
  });

  it("marks steps optional in flexible mode so an incomplete state stays saveable", () => {
    const guided = plan(EMPTY_DRAFT_BUILD, "guided");
    const flexible = plan(EMPTY_DRAFT_BUILD, "flexible");
    expect(guided.steps.find(step => step.id === "class")?.optional).toBe(false);
    expect(flexible.steps.find(step => step.id === "class")?.optional).toBe(true);
    // Flexible mode does not pretend the build is rules-valid.
    expect(flexible.guidedComplete).toBe(false);
  });
});
