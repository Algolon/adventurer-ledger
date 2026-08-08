/**
 * Which decisions get progressive disclosure, and why.
 *
 * The rule the UI applies has to be a property of the *content*, not of any
 * particular book. Physical testing named Weapon Mastery and the level-based
 * ability-score improvement, and the temptation is to special-case those names —
 * which would give the same treatment to nothing else, break the moment a
 * ruleset called them something different, and put one publisher's vocabulary
 * into public UI logic. The rule is therefore the option count and only the
 * option count, and these tests are what hold it there.
 */
import { describe, expect, it } from "vitest";
import { planBuild, type RequiredChoice } from "@/src/services/build-planner";
import { isLargeChoice, LARGE_CHOICE_OPTION_THRESHOLD } from "@/src/ui/character-builder";
import {
  LARGE_CHOICES,
  LARGE_ENTRIES,
  LARGE_IDS,
  MASTERY_OPTION_COUNT,
  MASTERY_PICKS,
  TRAINING_OPTION_COUNT,
} from "@/tests/fixtures/large-choice-ruleset";
import { SYNTHETIC_ENTRIES, SYNTHETIC_IDS } from "@/src/content/runefolio-synthetic";
import type { CharacterDraftBuild } from "@/src/domain/character-record";

const build = (over: Partial<CharacterDraftBuild> = {}): CharacterDraftBuild => ({
  name: "Scan Probe",
  level: 4,
  classId: LARGE_IDS.class,
  speciesId: LARGE_IDS.species,
  backgroundId: LARGE_IDS.background,
  abilityMethod: "manual",
  abilityScores: { strength: 17, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 },
  abilityBaseScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
  abilityIncreases: { strength: 2, constitution: 1 },
  choiceSelections: {},
  equipmentSelections: {},
  manualValues: {},
  manualActions: [],
  acknowledgedIssueCodes: [],
  ...over,
});

const choiceById = (choices: readonly RequiredChoice[], id: string) => {
  const found = choices.find(choice => choice.choiceId === id);
  if (!found) throw new Error(`the plan did not produce ${id}`);
  return found;
};

describe("a decision is disclosed progressively because of its size", () => {
  const plan = planBuild(build(), LARGE_ENTRIES, "guided");

  it("treats a twelve-option mastery decision as large", () => {
    const mastery = choiceById(plan.requiredChoices, LARGE_CHOICES.mastery);
    expect(mastery.options).toHaveLength(MASTERY_OPTION_COUNT);
    expect(mastery.min).toBe(MASTERY_PICKS);
    expect(isLargeChoice(mastery)).toBe(true);
  });

  /**
   * The level-4 surface. It exists only because the build was created at a
   * level that reaches it, which is what made it hard to find in the first
   * place: a level 1 build never sees this decision at all.
   */
  it("treats the level-based improvement decision as large, and only from its level", () => {
    const training = choiceById(plan.requiredChoices, LARGE_CHOICES.training);
    expect(training.options).toHaveLength(TRAINING_OPTION_COUNT);
    expect(training.level).toBe(4);
    expect(isLargeChoice(training)).toBe(true);

    const early = planBuild(build({ level: 3 }), LARGE_ENTRIES, "guided");
    expect(early.requiredChoices.some(choice => choice.choiceId === LARGE_CHOICES.training)).toBe(false);
  });

  /**
   * The control. A two-option decision is one glance, and putting it behind a
   * summary would add a press to something that never needed one.
   */
  it("leaves a small decision alone", () => {
    const stance = choiceById(plan.requiredChoices, LARGE_CHOICES.stance);
    expect(stance.options).toHaveLength(2);
    expect(isLargeChoice(stance)).toBe(false);
  });

  it("leaves every decision in the shipped synthetic ruleset alone", () => {
    const synthetic = planBuild(
      {
        ...build(),
        level: 2,
        classId: SYNTHETIC_IDS.class,
        speciesId: SYNTHETIC_IDS.species,
        backgroundId: undefined,
      },
      SYNTHETIC_ENTRIES,
      "guided",
    );
    // Nothing this product ships is big enough to need collapsing, so the
    // change is invisible on the built-in content — which is the point.
    expect(synthetic.requiredChoices.filter(isLargeChoice)).toEqual([]);
  });

  /** The boundary, stated rather than implied by whichever fixtures exist. */
  it("draws the line exactly at the threshold", () => {
    const sized = (count: number) =>
      ({
        choiceId: "choice:probe",
        label: "Probe",
        min: 1,
        max: 1,
        stepId: "class-choices",
        options: Array.from({ length: count }, (_, index) => ({ id: `option:${index}`, label: `Option ${index}` })),
        selected: [],
        resolved: false,
        incompatibleOptions: [],
        sourceEntryId: "entry:probe",
        sourceLabel: "Probe",
        sourceCategory: "class",
      }) satisfies RequiredChoice;

    expect(isLargeChoice(sized(LARGE_CHOICE_OPTION_THRESHOLD))).toBe(false);
    expect(isLargeChoice(sized(LARGE_CHOICE_OPTION_THRESHOLD + 1))).toBe(true);
  });
});

describe("nothing about the rule reads a name", () => {
  /**
   * The dense fixture's decisions are called "Tidework mastery 1…5" and carry
   * forty options each. They are large because of the forty, and this is the
   * test that would fail if anyone ever reached for the label instead.
   */
  it("collapses a forty-option decision whatever it is called", async () => {
    const { DENSE_ENTRIES, denseBuild, DENSE_OPTIONS_PER_CHOICE } = await import("@/tests/fixtures/dense-ruleset");
    const dense = planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    const large = dense.requiredChoices.filter(isLargeChoice);

    expect(large.length).toBeGreaterThan(0);
    for (const choice of large) expect(choice.options.length).toBeGreaterThan(LARGE_CHOICE_OPTION_THRESHOLD);
    expect(large.some(choice => choice.options.length === DENSE_OPTIONS_PER_CHOICE)).toBe(true);

    // Renaming every decision changes nothing about which are collapsed.
    const renamed = dense.requiredChoices.map(choice => ({ ...choice, label: "Anonymous decision" }));
    expect(renamed.filter(isLargeChoice)).toHaveLength(large.length);
  });
});
