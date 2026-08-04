/**
 * Planning cost scales with content, not with option count.
 *
 * `planBuild` composes three generic layers, and each of them walks the whole
 * activation graph. If any caller re-enters that walk per choice or per option,
 * the planner stays correct and becomes quadratic: the acceptance slice has a
 * handful of options and hides it completely, while a real class list with
 * dozens of mastery-style options per choice does not.
 *
 * This file asserts a deterministic complexity contract rather than a wall-clock
 * budget, because a timing threshold on a shared runner is either so loose it
 * proves nothing or so tight it fails for unrelated reasons. The traversal
 * entry points are counted directly: one activation walk and one proficiency
 * walk per planning pass, whatever the content contains.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const counters = vi.hoisted(() => ({ activation: 0, proficiency: 0, index: 0, context: 0 }));

vi.mock("@/src/services/choice-planner", async importOriginal => {
  const actual = await importOriginal<typeof import("@/src/services/choice-planner")>();
  return {
    ...actual,
    planActivation: (...args: Parameters<typeof actual.planActivation>) => {
      counters.activation += 1;
      return actual.planActivation(...args);
    },
    draftContext: (...args: Parameters<typeof actual.draftContext>) => {
      counters.context += 1;
      return actual.draftContext(...args);
    },
  };
});

/**
 * The per-pass index and evaluation context are counted at their factory rather
 * than by a production counter, so nothing in `src/` knows it is being measured.
 */
vi.mock("@/src/services/planning-context", async importOriginal => {
  const actual = await importOriginal<typeof import("@/src/services/planning-context")>();
  return {
    ...actual,
    createPlanningIndex: (...args: Parameters<typeof actual.createPlanningIndex>) => {
      counters.index += 1;
      return actual.createPlanningIndex(...args);
    },
  };
});

vi.mock("@/src/services/proficiency-planner", async importOriginal => {
  const actual = await importOriginal<typeof import("@/src/services/proficiency-planner")>();
  return {
    ...actual,
    planProficiencies: (...args: Parameters<typeof actual.planProficiencies>) => {
      counters.proficiency += 1;
      return actual.planProficiencies(...args);
    },
  };
});

const { planBuild, recommendationsFor } = await import("@/src/services/build-planner");
const {
  DENSE_ENTRIES,
  DENSE_OPTIONS_PER_CHOICE,
  DENSE_PROFICIENCY_CHOICES,
  denseBuild,
} = await import("@/tests/fixtures/dense-ruleset");

const { incompatibleOptionsFor } = await import("@/src/services/build-planner");
const { createPlanningIndex } = await import("@/src/services/planning-context");

beforeEach(() => {
  counters.activation = 0;
  counters.proficiency = 0;
  counters.index = 0;
  counters.context = 0;
});

/** Every counter, so a whole pass can be compared in one assertion. */
const snapshot = () => ({ ...counters });

describe("one planning pass performs one traversal", () => {
  it("has enough density for the contract to mean something", () => {
    const build = denseBuild();
    const plan = planBuild(build, DENSE_ENTRIES, "guided");
    // Several proficiency choices, dozens of options each, plus the nested
    // choice a selected option brings with it.
    expect(plan.requiredChoices.length).toBeGreaterThanOrEqual(DENSE_PROFICIENCY_CHOICES + 2);
    const optionCount = plan.requiredChoices.reduce((total, choice) => total + choice.options.length, 0);
    expect(optionCount).toBeGreaterThanOrEqual(DENSE_PROFICIENCY_CHOICES * DENSE_OPTIONS_PER_CHOICE);
    // Level 5 accumulates every level's choices into the one pass.
    expect(build.level).toBe(5);
  });

  it("walks the activation graph exactly once for a level 5 dense build", () => {
    planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    expect(counters.activation).toBe(1);
  });

  it("computes proficiency provenance exactly once for the same pass", () => {
    planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    expect(counters.proficiency).toBe(1);
  });

  it("does not scale the traversal count with the number of options", () => {
    planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    const dense = counters.activation;
    counters.activation = 0;
    // The same build against a single-option version of every choice.
    const narrowed = DENSE_ENTRIES.map(entry =>
      entry.choices.length
        ? { ...entry, choices: entry.choices.map(choice => ({ ...choice, options: choice.options.slice(0, 1) })) }
        : entry,
    );
    planBuild(denseBuild(), narrowed, "guided");
    expect(counters.activation).toBe(dense);
  });

  it("reuses the plan's choices when producing guided recommendations", () => {
    const plan = planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    counters.activation = 0;
    counters.proficiency = 0;
    recommendationsFor("class-choices", denseBuild(), DENSE_ENTRIES, plan);
    // Recommendations describe a plan that already exists; producing them must
    // not re-enter the traversal.
    expect(counters.activation).toBe(0);
    expect(counters.proficiency).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Setup happens once per pass, not once per choice.
 *
 * The traversal counts above catch a planner that re-walks the activation graph.
 * They do not catch the cheaper-looking mistake of rebuilding the entry index
 * and the evaluation context inside the per-choice loop: the walk count stays at
 * one while the real work becomes `choices × entries`. These assertions close
 * that gap by counting the factory that produces both.
 */
describe("one planning pass performs one setup", () => {
  it("builds the entry index and evaluation context exactly once", () => {
    const plan = planBuild(denseBuild(), DENSE_ENTRIES, "guided");

    // The pass has many choices to evaluate...
    expect(plan.requiredChoices.length).toBeGreaterThan(1);
    // ...and built the state they share exactly once between them.
    expect(counters.index).toBe(1);
    expect(counters.activation).toBe(1);
    expect(counters.proficiency).toBe(1);
  });

  it("does not build a context per choice", () => {
    const plan = planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    // Activation builds its own context; the contract is that the total is a
    // small constant, not that it grows with the number of choices.
    expect(counters.context).toBeLessThan(plan.requiredChoices.length);
  });

  it("keeps every setup count identical as option density grows", () => {
    const thin = DENSE_ENTRIES.map(entry =>
      entry.choices.length
        ? { ...entry, choices: entry.choices.map(choice => ({ ...choice, options: choice.options.slice(0, 1) })) }
        : entry,
    );
    planBuild(denseBuild(), thin, "guided");
    const sparse = snapshot();

    counters.activation = 0;
    counters.proficiency = 0;
    counters.index = 0;
    counters.context = 0;
    planBuild(denseBuild(), DENSE_ENTRIES, "guided");

    // Forty options per choice costs exactly what one option per choice costs.
    expect(snapshot()).toEqual(sparse);
  });

  it("evaluates every choice's options against the pass's own index", () => {
    const plan = planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    expect(counters.index).toBe(1);

    // Reusing that index for a further evaluation builds nothing new; omitting
    // it is what makes each call pay for its own setup.
    const index = createPlanningIndex(denseBuild(), DENSE_ENTRIES);
    const before = counters.index;
    for (const choice of plan.requiredChoices.slice(0, 3))
      incompatibleOptionsFor(
        { id: choice.choiceId, label: choice.label, min: choice.min, max: choice.max, repeatable: false, options: [] },
        denseBuild(),
        DENSE_ENTRIES,
        index,
      );
    expect(counters.index).toBe(before);
  });

  it("produces recommendations without repeating any setup", () => {
    const plan = planBuild(denseBuild(), DENSE_ENTRIES, "guided");
    counters.activation = 0;
    counters.proficiency = 0;
    counters.index = 0;
    counters.context = 0;

    recommendationsFor("class-choices", denseBuild(), DENSE_ENTRIES, plan);

    expect(snapshot()).toEqual({ activation: 0, proficiency: 0, index: 0, context: 0 });
  });
});
