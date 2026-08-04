/**
 * Generic activation and target-level planning.
 *
 * These run against an original synthetic ruleset with real 1–5 progression, so
 * they exercise the shapes the first slice could not: a subclass at an
 * intermediate level, a choice on a species trait, a nested choice inside a
 * feat, a level with no choices and a level with two.
 */
import { describe, expect, it } from "vitest";
import {
  activatedEntriesFor,
  automaticallyGrantedProficiencyIds,
  maximumLevelFor,
  proficiencyProvenance,
  subclassLevelFor,
  subclassOptionsFor,
} from "@/src/services/activation";
import { planBuild, requiredChoicesFor } from "@/src/services/build-planner";
import { EMPTY_DRAFT_BUILD, type CharacterDraftBuild } from "@/src/domain/character-record";
import {
  PROG_CHOICES,
  PROG_ENTRIES,
  PROG_IDS,
  PROG_MAX_LEVEL,
  PROG_PROFICIENCIES,
  PROG_SUBCLASS_LEVEL,
} from "@/tests/fixtures/progression-ruleset";

const at = (level: number, over: Partial<CharacterDraftBuild> = {}): CharacterDraftBuild => ({
  ...EMPTY_DRAFT_BUILD,
  name: "Wren Halloway",
  level,
  classId: PROG_IDS.class,
  speciesId: PROG_IDS.species,
  backgroundId: PROG_IDS.background,
  abilityScores: { strength: 15, dexterity: 13, constitution: 14, intelligence: 10, wisdom: 16, charisma: 8 },
  ...over,
});

const choiceIds = (build: CharacterDraftBuild) =>
  requiredChoicesFor(build, PROG_ENTRIES).map(choice => choice.choiceId);

describe("activation reaches every entry the build turns on", () => {
  it("activates species traits, the background feat and level-gated class features", () => {
    const activated = activatedEntriesFor(at(5), PROG_ENTRIES);
    const ids = activated.map(item => item.entry.id);

    expect(ids).toContain(PROG_IDS.speciesTrait);
    expect(ids).toContain(PROG_IDS.backgroundFeat);
    for (const feature of [PROG_IDS.feature1, PROG_IDS.feature2, PROG_IDS.feature3, PROG_IDS.feature4, PROG_IDS.feature5])
      expect(ids).toContain(feature);
  });

  it("does not activate a feature above the build's level", () => {
    const ids = activatedEntriesFor(at(2), PROG_ENTRIES).map(item => item.entry.id);
    expect(ids).toContain(PROG_IDS.feature2);
    expect(ids).not.toContain(PROG_IDS.feature3);
    expect(ids).not.toContain(PROG_IDS.feature4);
  });

  it("records provenance for each activation", () => {
    const activated = activatedEntriesFor(at(5), PROG_ENTRIES);
    const trait = activated.find(item => item.entry.id === PROG_IDS.speciesTrait);
    expect(trait?.via).toBe("species-trait");
    expect(trait?.parentId).toBe(PROG_IDS.species);
    const feature4 = activated.find(item => item.entry.id === PROG_IDS.feature4);
    expect(feature4?.via).toBe("class-feature");
    expect(feature4?.level).toBe(4);
  });

  it("activates an entry once even when two paths reach it", () => {
    // The level-4 feat choice offers the same feat the background already grants.
    const build = at(5, {
      subclassId: PROG_IDS.subclassA,
      choiceSelections: { [PROG_CHOICES.feat]: ["option:feat-road-sense"] },
    });
    const occurrences = activatedEntriesFor(build, PROG_ENTRIES).filter(
      item => item.entry.id === PROG_IDS.backgroundFeat,
    );
    expect(occurrences).toHaveLength(1);
    // First path wins, and it is the deterministic one.
    expect(occurrences[0].via).toBe("background-feat");
    // And the choice it owns is presented exactly once.
    expect(choiceIds(build).filter(id => id === "choice:road-sense-approach")).toHaveLength(1);
  });
});

describe("choice discovery across every activated entry", () => {
  it("finds a choice that lives on a species trait, not on the species", () => {
    expect(choiceIds(at(1))).toContain(PROG_CHOICES.speciesStone);
  });

  it("finds the background feat's own choice", () => {
    expect(choiceIds(at(1))).toContain("choice:road-sense-approach");
  });

  it("presents a nested choice only once its parent option is selected", () => {
    expect(choiceIds(at(1))).not.toContain(PROG_CHOICES.featNested);
    const selected = at(1, { choiceSelections: { "choice:road-sense-approach": ["option:road-sense-terrain"] } });
    expect(choiceIds(selected)).toContain(PROG_CHOICES.featNested);
  });

  it("gates class choices by the level their progression row declares", () => {
    expect(choiceIds(at(1))).toContain(PROG_CHOICES.classSkills);
    expect(choiceIds(at(1))).not.toContain(PROG_CHOICES.subclassPath);
    expect(choiceIds(at(3))).toContain(PROG_CHOICES.subclassPath);
    expect(choiceIds(at(3))).not.toContain(PROG_CHOICES.feat);
  });

  it("opens both level-4 choices at level 4", () => {
    const ids = choiceIds(at(4, { subclassId: PROG_IDS.subclassA }));
    expect(ids).toContain(PROG_CHOICES.feat);
    expect(ids).toContain(PROG_CHOICES.technique);
  });

  it("adds no new class choice at a level that declares none", () => {
    const one = choiceIds(at(1)).filter(id => id.startsWith("choice:wayfinder"));
    const two = choiceIds(at(2)).filter(id => id.startsWith("choice:wayfinder"));
    expect(two).toEqual(one);
  });

  it("finds the subclass's own choice once the subclass is selected", () => {
    expect(choiceIds(at(3))).not.toContain(PROG_CHOICES.subclassMark);
    expect(choiceIds(at(3, { subclassId: PROG_IDS.subclassA }))).toContain(PROG_CHOICES.subclassMark);
  });

  it("carries source entry and category on every discovered choice", () => {
    const choices = requiredChoicesFor(at(3, { subclassId: PROG_IDS.subclassA }), PROG_ENTRIES);
    const mark = choices.find(choice => choice.choiceId === PROG_CHOICES.subclassMark);
    expect(mark?.source.entryId).toBe(PROG_IDS.subclassA);
    expect(mark?.source.category).toBe("subclass");
    expect(mark?.level).toBe(3);
    const stone = choices.find(choice => choice.choiceId === PROG_CHOICES.speciesStone);
    expect(stone?.source.category).toBe("rule");
    expect(stone?.stepId).toBe("origin");
  });
});

describe("target level", () => {
  it("derives the supported range from the class's own progression", () => {
    expect(maximumLevelFor(at(1), PROG_ENTRIES)).toBe(PROG_MAX_LEVEL);
    expect(subclassLevelFor(at(1), PROG_ENTRIES)).toBe(PROG_SUBCLASS_LEVEL);
    expect(subclassOptionsFor(at(1), PROG_ENTRIES).map(option => option.id)).toEqual([
      PROG_IDS.subclassA,
      PROG_IDS.subclassB,
    ]);
  });

  it("rejects a target level the content does not describe", () => {
    const codes = planBuild(at(9), PROG_ENTRIES).issues.map(issue => issue.code);
    expect(codes).toContain("TARGET_LEVEL_UNSUPPORTED");
  });

  it("accumulates every level's choices rather than jumping to the target", () => {
    // Creating directly at 5 must surface the level 1, 3 and 4 decisions.
    const ids = choiceIds(at(5, { subclassId: PROG_IDS.subclassA }));
    expect(ids).toContain(PROG_CHOICES.classSkills);
    expect(ids).toContain(PROG_CHOICES.subclassPath);
    expect(ids).toContain(PROG_CHOICES.feat);
    expect(ids).toContain(PROG_CHOICES.technique);
    expect(ids).toContain(PROG_CHOICES.subclassMark);
  });

  it("blocks guided completion while a level-4 choice is unresolved", () => {
    const build = at(5, {
      subclassId: PROG_IDS.subclassA,
      choiceSelections: {
        [PROG_CHOICES.classSkills]: ["option:skill-pathfinding", "option:skill-masonry"],
        [PROG_CHOICES.speciesStone]: ["option:stone-granite"],
        "choice:road-sense-approach": ["option:road-sense-weather"],
        [PROG_CHOICES.subclassPath]: ["option:path-cairn"],
        [PROG_CHOICES.subclassMark]: ["option:mark-stacked"],
        [PROG_CHOICES.feat]: ["option:feat-road-sense"],
        // technique deliberately unresolved
      },
    });
    const plan = planBuild(build, PROG_ENTRIES);
    expect(plan.guidedComplete).toBe(false);
    expect(plan.issues.some(issue => issue.recordId === PROG_CHOICES.technique)).toBe(true);
  });
});

describe("subclass identity", () => {
  it("requires a subclass once the class's subclass level is reached", () => {
    expect(planBuild(at(2), PROG_ENTRIES).issues.map(i => i.code)).not.toContain("SUBCLASS_NOT_CHOSEN");
    expect(planBuild(at(3), PROG_ENTRIES).issues.map(i => i.code)).toContain("SUBCLASS_NOT_CHOSEN");
  });

  it("rejects a subclass that does not belong to the class", () => {
    const codes = planBuild(at(3, { subclassId: "subclass:not-of-this-class" }), PROG_ENTRIES).issues.map(i => i.code);
    expect(codes).toContain("SUBCLASS_INVALID_FOR_CLASS");
  });

  it("activates subclass features from the subclass's own level", () => {
    const ids = activatedEntriesFor(at(5, { subclassId: PROG_IDS.subclassA }), PROG_ENTRIES).map(i => i.entry.id);
    expect(ids).toContain(PROG_IDS.subclassFeature3);
    expect(ids).toContain(PROG_IDS.subclassFeature5);
    const belowFive = activatedEntriesFor(at(4, { subclassId: PROG_IDS.subclassA }), PROG_ENTRIES).map(i => i.entry.id);
    expect(belowFive).toContain(PROG_IDS.subclassFeature3);
    expect(belowFive).not.toContain(PROG_IDS.subclassFeature5);
  });
});

describe("proficiency provenance", () => {
  const build = at(1, {
    choiceSelections: { [PROG_CHOICES.classSkills]: ["option:skill-pathfinding", "option:skill-masonry"] },
  });

  it("separates automatic grants from user selections", () => {
    const provenance = proficiencyProvenance(build, PROG_ENTRIES);
    const watchkeeping = provenance.find(p => p.proficiencyId === PROG_PROFICIENCIES.skillWatchkeeping);
    expect(watchkeeping?.grant).toBe("automatic");
    expect(watchkeeping?.sourceCategory).toBe("background");
    expect(watchkeeping?.sourceEntryName).toBe("Road Warden");

    const pathfinding = provenance.find(p => p.proficiencyId === PROG_PROFICIENCIES.skillPathfinding);
    expect(pathfinding?.grant).toBe("selected");
    expect(pathfinding?.choiceId).toBe(PROG_CHOICES.classSkills);
    expect(pathfinding?.type).toBe("skill");
  });

  it("marks a class option the background already granted", () => {
    const skills = requiredChoicesFor(build, PROG_ENTRIES).find(c => c.choiceId === PROG_CHOICES.classSkills);
    const watchkeeping = skills?.options.find(o => o.entryId === PROG_PROFICIENCIES.skillWatchkeeping);
    expect(watchkeeping?.alreadyGranted).toBe(true);
    expect(watchkeeping?.grantedBy).toBe("Road Warden");
    // An option the build does not hold is not marked.
    expect(skills?.options.find(o => o.entryId === PROG_PROFICIENCIES.skillWeatherlore)?.alreadyGranted).toBe(false);
  });

  it("reports the automatic set for option marking", () => {
    const granted = automaticallyGrantedProficiencyIds(build, PROG_ENTRIES);
    expect(granted.has(PROG_PROFICIENCIES.skillWatchkeeping)).toBe(true);
    expect(granted.has(PROG_PROFICIENCIES.skillPathfinding)).toBe(false);
  });
});

describe("applicability-driven steps", () => {
  it("keeps Equipment while the build is still indeterminate", () => {
    // Nothing chosen yet: "empty" would be a not-yet, not a fact, and dropping
    // the step here would make the progress denominator grow later.
    const ids = planBuild({ ...EMPTY_DRAFT_BUILD, level: 1 }, PROG_ENTRIES).steps.map(step => step.id);
    expect(ids).toContain("equipment");
    // Spellcasting is determinate from the class, so it is dropped immediately.
    expect(ids).not.toContain("spells-resources");
  });

  it("omits Equipment once a determinate build genuinely offers no choice", () => {
    // A class and background are chosen, and this background grants no bundle.
    const noBundle = PROG_ENTRIES.map(item =>
      item.id === PROG_IDS.background
        ? { ...item, equipmentBundles: [], mechanics: { ...(item.mechanics as object), equipmentBundleIds: [] } }
        : item,
    );
    const ids = planBuild(at(1), noBundle).steps.map(step => step.id);
    expect(ids).not.toContain("equipment");
  });

  it("includes Equipment once a bundle offers a real choice", () => {
    expect(planBuild(at(1), PROG_ENTRIES).steps.map(step => step.id)).toContain("equipment");
  });
});

describe("adversarial: target level moving up and down", () => {
  const resolvedAtFive = at(5, {
    subclassId: PROG_IDS.subclassA,
    equipmentSelections: { [PROG_CHOICES.equipment]: ["equipment-option:lantern"] },
    choiceSelections: {
      [PROG_CHOICES.classSkills]: ["option:skill-pathfinding", "option:skill-masonry"],
      [PROG_CHOICES.speciesStone]: ["option:stone-granite"],
      "choice:road-sense-approach": ["option:road-sense-weather"],
      [PROG_CHOICES.subclassPath]: ["option:path-cairn"],
      [PROG_CHOICES.subclassMark]: ["option:mark-stacked"],
      [PROG_CHOICES.feat]: ["option:feat-road-sense"],
      [PROG_CHOICES.technique]: ["option:technique-quiet-camp"],
    },
  });

  it("stops presenting higher-level choices when the target drops to 2", () => {
    const lowered = { ...resolvedAtFive, level: 2 };
    const ids = choiceIds(lowered);
    expect(ids).toContain(PROG_CHOICES.classSkills);
    expect(ids).not.toContain(PROG_CHOICES.subclassPath);
    expect(ids).not.toContain(PROG_CHOICES.feat);
    expect(ids).not.toContain(PROG_CHOICES.subclassMark);
  });

  it("keeps the stored higher-level selections so raising the target restores them", () => {
    const lowered = { ...resolvedAtFive, level: 2 };
    // Nothing was discarded on the way down...
    expect(lowered.choiceSelections[PROG_CHOICES.feat]).toEqual(["option:feat-road-sense"]);
    // ...so coming back up finds them already resolved.
    const raised = { ...lowered, level: 5 };
    const feat = requiredChoicesFor(raised, PROG_ENTRIES).find(c => c.choiceId === PROG_CHOICES.feat);
    expect(feat?.resolved).toBe(true);
    expect(planBuild(raised, PROG_ENTRIES).guidedComplete).toBe(true);
  });

  it("does not count a stale higher-level selection as an issue at the lower target", () => {
    const lowered = { ...resolvedAtFive, level: 2 };
    const plan = planBuild(lowered, PROG_ENTRIES);
    // The level-4 choice is simply not due, so it neither blocks nor warns.
    expect(plan.issues.some(issue => issue.recordId === PROG_CHOICES.feat)).toBe(false);
    expect(plan.guidedComplete).toBe(true);
  });

  it("drops a subclass requirement when the target falls below the subclass level", () => {
    const lowered = { ...resolvedAtFive, level: 2, subclassId: undefined };
    expect(planBuild(lowered, PROG_ENTRIES).issues.map(i => i.code)).not.toContain("SUBCLASS_NOT_CHOSEN");
  });
});

describe("adversarial: unrelated ruleset content", () => {
  it("does not change the build when unrelated entries are present", () => {
    const build = at(3, { subclassId: PROG_IDS.subclassA });
    const before = choiceIds(build);
    const unrelated = [
      ...PROG_ENTRIES,
      // A class from somewhere else entirely, never referenced by this build.
      { ...PROG_ENTRIES.find(e => e.id === PROG_IDS.class)!, id: "class:unrelated-elsewhere", name: "Unrelated" },
    ];
    expect(requiredChoicesFor(build, unrelated).map(c => c.choiceId)).toEqual(before);
  });
});
