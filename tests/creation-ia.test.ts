/**
 * The creation information architecture, and the two correctness gaps the
 * separate Background step exposed.
 *
 * Everything here runs against public-original synthetic content. Nothing
 * asserts on an official name, and the two fixtures used — the seeded Runefolio
 * pack and the acceptance ruleset — are both committed to this repository.
 */
import { describe, expect, it } from "vitest";
import { BUILDER_STEPS, planBuild, recommendationsFor } from "@/src/services/build-planner";
import { planActivation } from "@/src/services/choice-planner";
import {
  originIncreasePatternFor,
  reconcileAbilityAllocation,
  recoverAbilityAllocation,
} from "@/src/services/ability-allocation";
import { backgroundOwnedIds, changeBackground } from "@/src/services/background-change";
import { presentBackground, presentClass, presentSpecies } from "@/src/services/selection-presenter";
import { EMPTY_DRAFT_BUILD, type CharacterDraftBuild } from "@/src/domain/character-record";
import {
  SYNTHETIC_CHOICES,
  SYNTHETIC_ENTRIES,
  SYNTHETIC_IDS,
  PROFICIENCY_IDS,
} from "@/src/content/runefolio-synthetic";
import {
  ACCEPTANCE_CHOICES,
  ACCEPTANCE_IDS,
  acceptancePack,
} from "@/tests/fixtures/acceptance-ruleset";

const ACCEPTANCE_ENTRIES = acceptancePack().entries;

const draft = (patch: Partial<CharacterDraftBuild> = {}): CharacterDraftBuild => ({
  ...EMPTY_DRAFT_BUILD,
  name: "Fixture",
  level: 1,
  ...patch,
});

/* -------------------------------------------------------------------------- */
/* Step information architecture                                              */
/* -------------------------------------------------------------------------- */

describe("Species and Background are separate steps", () => {
  it("keeps `origin` as the species step's storage ID and puts `background` after it", () => {
    const ids = BUILDER_STEPS.map(step => step.id);
    expect(BUILDER_STEPS.find(step => step.id === "origin")?.label).toBe("Species");
    expect(BUILDER_STEPS.find(step => step.id === "background")?.label).toBe("Background");
    expect(ids.indexOf("background")).toBe(ids.indexOf("origin") + 1);
  });

  /**
   * The compatibility guarantee, stated as a test.
   *
   * A draft written before the split holds `lastStepId: "origin"`. That ID is
   * still a step, still in the same position, and now labelled Species — so the
   * draft resumes there with no migration and nothing reset.
   */
  it("resumes a draft persisted against `origin` on the Species step", () => {
    const persisted = "origin";
    const plan = planBuild(draft({ classId: SYNTHETIC_IDS.class }), SYNTHETIC_ENTRIES, "guided");
    const resumed = plan.steps.find(step => step.id === persisted);
    expect(resumed).toBeDefined();
    expect(resumed?.label).toBe("Species");
  });

  it("judges a missing species on Species and a missing background on Background", () => {
    const plan = planBuild(draft({ classId: SYNTHETIC_IDS.class }), SYNTHETIC_ENTRIES, "guided");
    const codes = (id: string) =>
      plan.steps.find(step => step.id === id)?.issues.map(issue => issue.code) ?? [];
    expect(codes("origin")).toContain("SPECIES_NOT_CHOSEN");
    expect(codes("origin")).not.toContain("BACKGROUND_NOT_CHOSEN");
    expect(codes("background")).toContain("BACKGROUND_NOT_CHOSEN");
    expect(codes("background")).not.toContain("SPECIES_NOT_CHOSEN");
  });
});

describe("nested decisions belong to the step that owns their source", () => {
  const build = draft({
    classId: SYNTHETIC_IDS.class,
    speciesId: SYNTHETIC_IDS.speciesAncestry,
    backgroundId: SYNTHETIC_IDS.backgroundSecond,
  });

  const stepOf = (choiceId: string) =>
    planBuild(build, SYNTHETIC_ENTRIES, "guided").requiredChoices.find(choice => choice.choiceId === choiceId)?.stepId;

  it("routes a species-owned ancestry decision to Species", () => {
    expect(stepOf(SYNTHETIC_CHOICES.speciesAncestry)).toBe("origin");
  });

  it("routes a species-owned lineage decision to Species", () => {
    const withLineage = { ...build, speciesId: SYNTHETIC_IDS.speciesLineage };
    const choice = planBuild(withLineage, SYNTHETIC_ENTRIES, "guided").requiredChoices.find(
      item => item.choiceId === SYNTHETIC_CHOICES.speciesLineage,
    );
    expect(choice?.stepId).toBe("origin");
  });

  it("routes a background-owned decision to Background", () => {
    expect(stepOf(SYNTHETIC_CHOICES.backgroundFerryCraft)).toBe("background");
  });

  it("leaves class-owned decisions on Class choices", () => {
    expect(stepOf(SYNTHETIC_CHOICES.fightingStyle)).toBe("class-choices");
    expect(stepOf(SYNTHETIC_CHOICES.classSkills)).toBe("class-choices");
  });

  /**
   * A lineage is reached through the species' own choice, so its trait — and
   * anything that trait declares — is still a species decision. This is the
   * property that keeps a follow-up decision beside the thing that caused it.
   */
  it("keeps a selected lineage's own contributions on Species", () => {
    const withLineage = draft({
      classId: SYNTHETIC_IDS.class,
      speciesId: SYNTHETIC_IDS.speciesLineage,
      choiceSelections: { [SYNTHETIC_CHOICES.speciesLineage]: ["option:deepdelve"] },
    });
    const activation = planActivation(withLineage, SYNTHETIC_ENTRIES);
    const lineage = activation.entries.find(item => item.entry.id === SYNTHETIC_IDS.lineageDeepdelve);
    expect(lineage?.stepId).toBe("origin");
    // The replacement relationship is typed, not name-matched.
    expect(activation.replacedTraitIds).toContain("trait:cavern-sense");
    expect(activation.entries.map(item => item.entry.id)).toContain("trait:stone-listening");
    expect(activation.entries.map(item => item.entry.id)).not.toContain("trait:cavern-sense");
  });

  it("offers no choices at all for a species that declares none", () => {
    const simple = draft({ classId: SYNTHETIC_IDS.class, speciesId: SYNTHETIC_IDS.species });
    const speciesChoices = planBuild(simple, SYNTHETIC_ENTRIES, "guided").requiredChoices.filter(
      choice => choice.stepId === "origin",
    );
    expect(speciesChoices).toEqual([]);
  });

  it("offers no species choices for the acceptance ruleset's simple species either", () => {
    const simple = draft({
      classId: ACCEPTANCE_IDS.class,
      speciesId: ACCEPTANCE_IDS.simpleSpecies,
      backgroundId: ACCEPTANCE_IDS.background,
    });
    const speciesChoices = planBuild(simple, ACCEPTANCE_ENTRIES, "guided").requiredChoices.filter(
      choice => choice.stepId === "origin",
    );
    expect(speciesChoices).toEqual([]);
  });

  it("routes the acceptance ruleset's inline ancestry decision to Species", () => {
    const build = draft({
      classId: ACCEPTANCE_IDS.class,
      speciesId: ACCEPTANCE_IDS.ancestrySpecies,
      backgroundId: ACCEPTANCE_IDS.background,
    });
    const choice = planBuild(build, ACCEPTANCE_ENTRIES, "guided").requiredChoices.find(
      item => item.choiceId === ACCEPTANCE_CHOICES.ancestry,
    );
    expect(choice?.stepId).toBe("origin");
  });
});

describe("guided recommendations follow the two steps", () => {
  it("recommends species on Species and backgrounds on Background", () => {
    const build = draft({ classId: SYNTHETIC_IDS.class });
    const speciesIds = recommendationsFor("origin", build, SYNTHETIC_ENTRIES).map(item => item.optionId);
    const backgroundIds = recommendationsFor("background", build, SYNTHETIC_ENTRIES).map(item => item.optionId);
    expect(speciesIds).toContain(SYNTHETIC_IDS.species);
    expect(speciesIds).not.toContain(SYNTHETIC_IDS.background);
    expect(backgroundIds).toContain(SYNTHETIC_IDS.background);
    expect(backgroundIds).not.toContain(SYNTHETIC_IDS.species);
  });

  /** Derived from typed mechanics, so it cannot describe content it has not read. */
  it("states a speed it actually read from the species", () => {
    const why = recommendationsFor("origin", draft(), SYNTHETIC_ENTRIES).find(
      item => item.optionId === SYNTHETIC_IDS.species,
    )?.why;
    expect(why).toContain("30 ft.");
  });
});

/* -------------------------------------------------------------------------- */
/* Content-generic presentation                                               */
/* -------------------------------------------------------------------------- */

describe("selection presenters read content and never invent it", () => {
  const entry = (id: string) => SYNTHETIC_ENTRIES.find(item => item.id === id)!;

  it("summarises a species from its typed mechanics", () => {
    const view = presentSpecies(entry(SYNTHETIC_IDS.species), SYNTHETIC_ENTRIES);
    expect(view.label).toBe("Riverborn");
    expect(view.facts.map(fact => `${fact.label}: ${fact.value}`)).toContain("Speed: 30 ft.");
    expect(view.facts.length).toBeLessThanOrEqual(4);
    expect(view.grants.map(grant => grant.label)).toEqual(["River Footing", "Steady Lungs"]);
  });

  /**
   * The distinction the step exists to make: what the app applies, and what a
   * table has to rule on. It is read from the trait's own typed effects.
   */
  it("marks an automatic trait and a manually adjudicated one differently", () => {
    const view = presentSpecies(entry(SYNTHETIC_IDS.speciesAncestry), SYNTHETIC_ENTRIES);
    const byLabel = new Map(view.grants.map(grant => [grant.label, grant.disposition]));
    expect(byLabel.get("Cinder Step")).toBe("automatic");
    expect(byLabel.get("Ember Memory")).toBe("manual-adjudication");
  });

  it("summarises a background's increases, feat, skill and tool", () => {
    const view = presentBackground(entry(SYNTHETIC_IDS.background), SYNTHETIC_ENTRIES);
    const facts = new Map(view.facts.map(fact => [fact.label, fact.value]));
    expect(facts.get("Ability increases")).toBe("+2 / +1");
    expect(facts.get("Origin feat")).toBe("Warden's Vigil");
    expect(facts.get("Tool")).toBe("Cartwright's tools");
    expect(view.grants.map(grant => grant.label)).toContain("Watchcraft");
  });

  it("states both distributions when a background offers an alternative", () => {
    const view = presentBackground(entry(SYNTHETIC_IDS.backgroundSecond), SYNTHETIC_ENTRIES);
    const increases = view.facts.find(fact => fact.label === "Ability increases")?.value;
    expect(increases).toBe("+2 / +1 or +1 / +1 / +1");
  });

  it("shows only the levels a starting level actually reaches", () => {
    const atOne = presentClass(entry(SYNTHETIC_IDS.class), SYNTHETIC_ENTRIES, 1);
    const atTwo = presentClass(entry(SYNTHETIC_IDS.class), SYNTHETIC_ENTRIES, 2);
    expect(atOne.atLevel.every(grant => (grant.level ?? 1) <= 1)).toBe(true);
    expect(atTwo.atLevel.length).toBeGreaterThan(atOne.atLevel.length);
    expect(atOne.facts.map(fact => fact.label)).toContain("Hit die");
  });

  it("omits a row rather than inventing one when mechanics do not parse", () => {
    const broken = { ...entry(SYNTHETIC_IDS.species), mechanics: { nonsense: true } };
    const view = presentSpecies(broken, SYNTHETIC_ENTRIES);
    expect(view.label).toBe("Riverborn");
    expect(view.facts).toEqual([]);
    expect(view.grants).toEqual([]);
  });

  it("never emits a raw record ID as user-facing text", () => {
    const views = [
      presentSpecies(entry(SYNTHETIC_IDS.speciesAncestry), SYNTHETIC_ENTRIES),
      presentBackground(entry(SYNTHETIC_IDS.backgroundSecond), SYNTHETIC_ENTRIES),
      presentClass(entry(SYNTHETIC_IDS.class), SYNTHETIC_ENTRIES, 2),
    ];
    const text = views.flatMap(view => [
      ...view.facts.flatMap(fact => [fact.label, fact.value]),
      ...view.grants.flatMap(grant => [grant.label, grant.detail ?? ""]),
      ...view.atLevel.flatMap(grant => [grant.label, grant.detail ?? ""]),
      ...view.details.flatMap(detail => [detail.label, detail.value]),
    ]);
    // Every internal identifier in this schema is `kind:slug`. None may surface.
    for (const value of text) expect(value).not.toMatch(/\b[a-z-]+:[a-z0-9-]+\b/);
  });
});

/* -------------------------------------------------------------------------- */
/* GAP-003 — alternative ability-increase patterns                            */
/* -------------------------------------------------------------------------- */

describe("GAP-003: a background may offer more than one legal distribution", () => {
  const ferryHand = draft({ backgroundId: SYNTHETIC_IDS.backgroundSecond });
  const base = { dexterity: 14, wisdom: 13, charisma: 12, strength: 10, constitution: 10, intelligence: 8 } as const;
  const withIncreases = (increases: Partial<Record<string, number>>) =>
    ({ ...ferryHand, abilityBaseScores: base, abilityIncreases: increases }) as CharacterDraftBuild;

  it("reads every declared distribution, default first", () => {
    const pattern = originIncreasePatternFor(ferryHand, SYNTHETIC_ENTRIES);
    expect(pattern?.patterns).toEqual([
      [2, 1],
      [1, 1, 1],
    ]);
    // The single-pattern background is unchanged and still offers exactly one.
    const single = originIncreasePatternFor(draft({ backgroundId: SYNTHETIC_IDS.background }), SYNTHETIC_ENTRIES);
    expect(single?.patterns).toEqual([[2, 1]]);
  });

  it("accepts +2/+1 across two different allowed abilities", () => {
    const allocation = reconcileAbilityAllocation(withIncreases({ dexterity: 2, wisdom: 1 }), SYNTHETIC_ENTRIES);
    expect(allocation.invalid).toEqual([]);
    expect(allocation.patternSatisfied).toBe(true);
    expect(allocation.final.dexterity).toBe(16);
    expect(allocation.final.wisdom).toBe(14);
  });

  it("accepts +1/+1/+1 across all three allowed abilities", () => {
    const allocation = reconcileAbilityAllocation(
      withIncreases({ dexterity: 1, wisdom: 1, charisma: 1 }),
      SYNTHETIC_ENTRIES,
    );
    expect(allocation.invalid).toEqual([]);
    expect(allocation.patternSatisfied).toBe(true);
    expect(allocation.final.dexterity).toBe(15);
    expect(allocation.final.charisma).toBe(13);
  });

  it("rejects an ability the background does not offer", () => {
    const allocation = reconcileAbilityAllocation(withIncreases({ strength: 2, wisdom: 1 }), SYNTHETIC_ENTRIES);
    expect(allocation.invalid).toEqual([{ ability: "strength", amount: 2, reason: "ability-not-offered" }]);
    expect(allocation.patternSatisfied).toBe(false);
    // The rejected increase never reaches a final score.
    expect(allocation.final.strength).toBe(10);
  });

  it("rejects +2/+2, which no declared distribution allows", () => {
    const allocation = reconcileAbilityAllocation(withIncreases({ dexterity: 2, wisdom: 2 }), SYNTHETIC_ENTRIES);
    expect(allocation.invalid).toHaveLength(1);
    expect(allocation.patternSatisfied).toBe(false);
    expect(allocation.final.dexterity! + allocation.final.wisdom!).toBe(16 + 13);
  });

  it("rejects spending the same distribution twice over", () => {
    const allocation = reconcileAbilityAllocation(
      withIncreases({ dexterity: 1, wisdom: 1, charisma: 1, strength: 1 }),
      SYNTHETIC_ENTRIES,
    );
    // Strength is not offered; the three that are exactly fill +1/+1/+1.
    expect(allocation.invalid.map(item => item.ability)).toEqual(["strength"]);
    expect(Object.keys(allocation.increases).sort()).toEqual(["charisma", "dexterity", "wisdom"]);
  });

  it("keeps base scores separate from the increases at every point", () => {
    const allocation = reconcileAbilityAllocation(withIncreases({ dexterity: 2, wisdom: 1 }), SYNTHETIC_ENTRIES);
    expect(allocation.base.dexterity).toBe(14);
    expect(allocation.increases.dexterity).toBe(2);
    expect(allocation.final.dexterity).toBe(16);
  });

  it("is deterministic: the same draft always resolves to the same distribution", () => {
    const build = withIncreases({ dexterity: 1, wisdom: 1, charisma: 1 });
    const first = reconcileAbilityAllocation(build, SYNTHETIC_ENTRIES);
    const second = reconcileAbilityAllocation(build, SYNTHETIC_ENTRIES);
    expect(second).toEqual(first);
    expect(first.activePatternIndex).toBe(1);
  });

  /**
   * Committed characters store finals only, so reopening one has to recover the
   * split. With alternatives in play the default is no longer the only
   * candidate, and a character built on +1/+1/+1 must come back as that.
   *
   * These finals are reachable only through +1/+1/+1: every +2/+1 assignment
   * leaves a base that is not the declared standard array.
   */
  it("recovers a committed +1/+1/+1 split, not only the default", () => {
    const pattern = originIncreasePatternFor(ferryHand, SYNTHETIC_ENTRIES);
    const recovered = recoverAbilityAllocation({
      finals: { strength: 15, constitution: 14, intelligence: 13, dexterity: 13, wisdom: 11, charisma: 9 },
      pattern,
      standardArray: [15, 14, 13, 12, 10, 8],
      abilityMethod: "standard-array",
    });
    expect(recovered.recovered).toBe(true);
    expect(recovered.increases).toEqual({ dexterity: 1, wisdom: 1, charisma: 1 });
    expect(recovered.base.dexterity).toBe(12);
    expect(recovered.base.strength).toBe(15);
  });

  /**
   * When two distributions produce byte-identical finals, either recovery is
   * correct: the committed scores are the same number either way. The contract
   * is that one is chosen deterministically, not that a particular one is.
   */
  it("resolves an ambiguous split deterministically and without changing a score", () => {
    const pattern = originIncreasePatternFor(ferryHand, SYNTHETIC_ENTRIES);
    const finals = { dexterity: 16, wisdom: 15, charisma: 14, strength: 12, constitution: 10, intelligence: 8 };
    const first = recoverAbilityAllocation({ finals, pattern, standardArray: [15, 14, 13, 12, 10, 8], abilityMethod: "standard-array" });
    const second = recoverAbilityAllocation({ finals, pattern, standardArray: [15, 14, 13, 12, 10, 8], abilityMethod: "standard-array" });
    expect(first.recovered).toBe(true);
    expect(second.increases).toEqual(first.increases);
    for (const ability of ["dexterity", "wisdom", "charisma", "strength"] as const)
      expect((first.base[ability] ?? 0) + (first.increases[ability] ?? 0)).toBe(finals[ability]);
  });

  it("leaves existing single-pattern content behaving exactly as before", () => {
    const warden = draft({
      backgroundId: SYNTHETIC_IDS.background,
      abilityBaseScores: base,
      abilityIncreases: { strength: 2, constitution: 1 },
    });
    const allocation = reconcileAbilityAllocation(warden, SYNTHETIC_ENTRIES);
    expect(allocation.invalid).toEqual([]);
    expect(allocation.patternSatisfied).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* GAP-005 — stale background-owned state                                     */
/* -------------------------------------------------------------------------- */

describe("GAP-005: changing background removes what the old one owned", () => {
  const populated = draft({
    classId: SYNTHETIC_IDS.class,
    speciesId: SYNTHETIC_IDS.speciesAncestry,
    backgroundId: SYNTHETIC_IDS.background,
    abilityBaseScores: { strength: 15, constitution: 14, dexterity: 13, wisdom: 12, intelligence: 10, charisma: 8 },
    abilityIncreases: { strength: 2, constitution: 1 },
    abilityScores: { strength: 17, constitution: 15, dexterity: 13, wisdom: 12, intelligence: 10, charisma: 8 },
    choiceSelections: {
      [SYNTHETIC_CHOICES.backgroundLanguage]: [`option:${PROFICIENCY_IDS.languageTradeCant}`],
      [SYNTHETIC_CHOICES.speciesAncestry]: ["option:hearth-kept"],
      [SYNTHETIC_CHOICES.fightingStyle]: [`option:${SYNTHETIC_IDS.style}`],
    },
  });

  it("identifies what a background owns from typed structure", () => {
    const owned = backgroundOwnedIds(SYNTHETIC_IDS.background, SYNTHETIC_ENTRIES);
    expect(owned.choiceIds.has(SYNTHETIC_CHOICES.backgroundLanguage)).toBe(true);
    expect(owned.choiceIds.has(SYNTHETIC_CHOICES.speciesAncestry)).toBe(false);
    expect(owned.choiceIds.has(SYNTHETIC_CHOICES.fightingStyle)).toBe(false);
  });

  it("removes the old background's nested answer", () => {
    const { build, removed } = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    expect(build.choiceSelections[SYNTHETIC_CHOICES.backgroundLanguage]).toBeUndefined();
    expect(removed).toContainEqual({ kind: "choice", recordId: SYNTHETIC_CHOICES.backgroundLanguage });
  });

  it("preserves species, class and identity state untouched", () => {
    const { build } = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    expect(build.speciesId).toBe(SYNTHETIC_IDS.speciesAncestry);
    expect(build.classId).toBe(SYNTHETIC_IDS.class);
    expect(build.name).toBe(populated.name);
    expect(build.choiceSelections[SYNTHETIC_CHOICES.speciesAncestry]).toEqual(["option:hearth-kept"]);
    expect(build.choiceSelections[SYNTHETIC_CHOICES.fightingStyle]).toEqual([`option:${SYNTHETIC_IDS.style}`]);
  });

  it("never touches the base ability scores", () => {
    const { build } = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    expect(build.abilityBaseScores).toEqual(populated.abilityBaseScores);
  });

  it("drops increases the incoming background does not authorise, and recomputes finals", () => {
    const { build, removed } = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    // Ferry Hand offers dexterity/wisdom/charisma; strength and constitution go.
    expect(build.abilityIncreases).toEqual({});
    expect(removed).toContainEqual({ kind: "ability-increase", recordId: "strength" });
    expect(build.abilityScores.strength).toBe(15);
  });

  it("keeps an increase the incoming background still authorises", () => {
    const compatible = { ...populated, abilityIncreases: { dexterity: 2 } };
    const { build } = changeBackground(compatible, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    expect(build.abilityIncreases).toEqual({ dexterity: 2 });
  });

  it("is idempotent", () => {
    const once = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    const twice = changeBackground(once.build, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    expect(twice.build).toEqual(once.build);
    expect(twice.removed).toEqual([]);
  });

  it("is deterministic", () => {
    const first = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    const second = changeBackground(populated, SYNTHETIC_IDS.backgroundSecond, SYNTHETIC_ENTRIES);
    expect(second).toEqual(first);
  });

  it("clears equipment selections owned by the outgoing background's kit", () => {
    const withKit = {
      ...populated,
      backgroundId: SYNTHETIC_IDS.backgroundSecond,
      equipmentSelections: { "equipment-choice:ferry-hand-tools": ["equipment-option:ferry-warden-pack"] },
    };
    const { build, removed } = changeBackground(withKit, SYNTHETIC_IDS.background, SYNTHETIC_ENTRIES);
    expect(build.equipmentSelections["equipment-choice:ferry-hand-tools"]).toBeUndefined();
    expect(removed).toContainEqual({ kind: "equipment-choice", recordId: "equipment-choice:ferry-hand-tools" });
  });

  it("clears everything when the background is removed entirely", () => {
    const { build } = changeBackground(populated, undefined, SYNTHETIC_ENTRIES);
    expect(build.backgroundId).toBeUndefined();
    expect(build.abilityIncreases).toEqual({});
    expect(build.choiceSelections[SYNTHETIC_CHOICES.backgroundLanguage]).toBeUndefined();
    // Still not the species' business.
    expect(build.choiceSelections[SYNTHETIC_CHOICES.speciesAncestry]).toEqual(["option:hearth-kept"]);
  });
});
