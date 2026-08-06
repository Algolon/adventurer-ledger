/**
 * The engine-correctness regressions.
 *
 * Three generic contracts, each of which real-content validation showed the
 * engine breaking, pinned against the public-original Tidewatch slice:
 *
 *  A. maximum hit points apply the Constitution modifier once per character
 *     level, not once per character;
 *  B. the armour context is resolved from the build's own typed equipment, so an
 *     armour-dependent effect actually activates;
 *  C. one conceptual subclass decision produces one user-facing decision, even
 *     when a pack declares it both as typed `subclassIds` and as a generic
 *     choice over the same entries.
 *
 * Nothing here names, imports or depends on private content. Every number is
 * declared by `tests/fixtures/engine-correctness-ruleset.ts`.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeHarnesses,
  createHarness,
  expectOk,
  installTidewatchRuleset,
  type Harness,
} from "@/tests/fixtures/service-harness";
import {
  TIDEWATCH_ARMOR_BONUS,
  TIDEWATCH_BODY_ARMOR_CLASS,
  TIDEWATCH_BUNDLES,
  TIDEWATCH_CHOICES,
  TIDEWATCH_ENTRIES,
  TIDEWATCH_EQUIPMENT_OPTIONS,
  TIDEWATCH_HIT_POINT_BASE,
  TIDEWATCH_IDS,
  TIDEWATCH_PROFICIENCIES,
  TIDEWATCH_RULESET_ID,
  TIDEWATCH_SHIELD_ARMOR_CLASS,
} from "@/tests/fixtures/engine-correctness-ruleset";
import { characterFixture } from "@/tests/fixtures/character-records";
import type { CharacterDraftBuild, CharacterRecord } from "@/src/domain/character-record";
import { deriveCharacterState } from "@/src/rules/derive-character";
import { maximumHitPointsFor } from "@/src/rules/hit-points";
import { resolveDerivedCharacter, type DerivedCharacterSheet } from "@/src/services/derived-resolver";
import { planBuild } from "@/src/services/build-planner";
import { planActivation } from "@/src/services/choice-planner";
import type { CommitResult, DraftSnapshot } from "@/src/services/character-services";
import type { LevelUpPreview, LevelUpResult } from "@/src/services/levelup-service";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeHarnesses();
});

/** Standard array plus the origin's +2/+1, producing a Constitution of 14. */
const BASE_SCORES = { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 } as const;
const INCREASES = { strength: 2, constitution: 1 } as const;
const FINAL_SCORES = { strength: 17, dexterity: 14, constitution: 14, intelligence: 12, wisdom: 10, charisma: 8 } as const;

/** A committed record against the engine-correctness class, for pure resolution. */
function record(
  options: {
    level?: number;
    constitution?: number;
    protection?: string;
    subclassId?: string;
    classId?: string;
    id?: string;
    classLevels?: CharacterRecord["classLevels"];
  } = {},
): CharacterRecord {
  const level = options.level ?? 5;
  const classId = options.classId ?? TIDEWATCH_IDS.class;
  const subclassId = options.subclassId ?? (level >= 3 && classId === TIDEWATCH_IDS.class ? TIDEWATCH_IDS.subclassHold : undefined);
  return characterFixture({
    id: options.id ?? "character:tidewatch",
    rulesetProfileId: TIDEWATCH_RULESET_ID,
    name: "Perrin Sallow",
    level,
    classLevels: options.classLevels ?? [{ classId, level, ...(subclassId ? { subclassId } : {}) }],
    speciesId: TIDEWATCH_IDS.species,
    backgroundId: TIDEWATCH_IDS.background,
    abilityScores: { ...FINAL_SCORES, constitution: options.constitution ?? FINAL_SCORES.constitution },
    choiceSelections:
      classId === TIDEWATCH_IDS.class
        ? { [TIDEWATCH_CHOICES.classSkills]: [`option:${TIDEWATCH_PROFICIENCIES.skillRigging}`] }
        : {},
    // Every class in this slice grants the same kit, so every build answers the
    // one equipment decision it carries.
    equipmentSelections: { [TIDEWATCH_BUNDLES.protection]: [options.protection ?? TIDEWATCH_EQUIPMENT_OPTIONS.coat] },
  });
}

const sheetFor = (options: Parameters<typeof record>[0] = {}): DerivedCharacterSheet =>
  resolveDerivedCharacter({ character: record(options), entries: TIDEWATCH_ENTRIES });

/** A complete draft build for the engine-correctness class at the given level. */
function build(options: { level?: number; classId?: string; subclassId?: string | null; protection?: string; choiceSelections?: Record<string, string[]> } = {}): CharacterDraftBuild {
  const level = options.level ?? 5;
  const classId = options.classId ?? TIDEWATCH_IDS.class;
  const subclassId =
    options.subclassId === null
      ? undefined
      : (options.subclassId ?? (level >= 3 && classId === TIDEWATCH_IDS.class ? TIDEWATCH_IDS.subclassHold : undefined));
  return {
    name: "Perrin Sallow",
    level,
    classId,
    ...(subclassId ? { subclassId } : {}),
    speciesId: TIDEWATCH_IDS.species,
    backgroundId: TIDEWATCH_IDS.background,
    abilityMethod: "standard-array",
    abilityBaseScores: { ...BASE_SCORES },
    abilityIncreases: { ...INCREASES },
    abilityScores: { ...FINAL_SCORES },
    choiceSelections:
      options.choiceSelections ??
      (classId === TIDEWATCH_IDS.class
        ? { [TIDEWATCH_CHOICES.classSkills]: [`option:${TIDEWATCH_PROFICIENCIES.skillRigging}`] }
        : {}),
    equipmentSelections: { [TIDEWATCH_BUNDLES.protection]: [options.protection ?? TIDEWATCH_EQUIPMENT_OPTIONS.coat] },
    manualValues: {},
    manualActions: [],
    acknowledgedIssueCodes: [],
  } as CharacterDraftBuild;
}

async function openDraft(patch: Partial<CharacterDraftBuild>): Promise<DraftSnapshot> {
  const draftId = `draft:${Math.random().toString(36).slice(2)}`;
  const created = expectOk<DraftSnapshot>(
    await harness.drafts.create({
      draftId,
      rulesetProfileId: TIDEWATCH_RULESET_ID,
      level: patch.level ?? 1,
      presentation: "guided",
    }),
  );
  return expectOk<DraftSnapshot>(await harness.drafts.update({ draftId, expectedRevision: created.revision, patch }));
}

async function commitDraft(snapshot: DraftSnapshot, characterId: string): Promise<CommitResult> {
  return expectOk<CommitResult>(
    await harness.commit.commit({
      operationId: `op:${characterId}`,
      draftId: snapshot.draft.id,
      expectedDraftRevision: snapshot.revision,
      characterId,
      intent: "create",
      acknowledgedIssueCodes: [],
      expectedContentFingerprint: await harness.query.contentFingerprint(TIDEWATCH_RULESET_ID),
    }),
  );
}

/** The armour-conditioned effect's trace entry, which says outright whether it applied. */
function bracedStanceApplied(character: CharacterRecord): boolean {
  const state = deriveCharacterState({
    character: {
      id: character.id,
      name: character.name,
      level: character.level,
      advancement: "milestone",
      classLevels: character.classLevels.map(item => ({ ...item })),
      speciesId: character.speciesId,
      backgroundId: character.backgroundId,
      rulesetProfileId: character.rulesetProfileId,
      abilities: character.abilityScores as never,
      baseHitPoints: 0,
      currentHitPoints: 0,
      temporaryHitPoints: 0,
      exhaustion: 0,
      deathSaves: { successes: 0, failures: 0 },
      selections: [],
      biography: {},
      tags: [],
      status: "active",
      kind: "player-character",
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    } as never,
    entries: TIDEWATCH_ENTRIES,
    choiceSelections: character.choiceSelections,
    equipmentSelections: character.equipmentSelections,
  });
  return state.ruleResult.trace.some(item => item.effectId === "effect:tw-braced-stance-armor" && item.applied);
}

function armorContextOf(character: CharacterRecord) {
  const state = deriveCharacterState({
    character: {
      id: character.id,
      name: character.name,
      level: character.level,
      advancement: "milestone",
      classLevels: character.classLevels.map(item => ({ ...item })),
      speciesId: character.speciesId,
      backgroundId: character.backgroundId,
      rulesetProfileId: character.rulesetProfileId,
      abilities: character.abilityScores as never,
      baseHitPoints: 0,
      currentHitPoints: 0,
      temporaryHitPoints: 0,
      exhaustion: 0,
      deathSaves: { successes: 0, failures: 0 },
      selections: [],
      biography: {},
      tags: [],
      status: "active",
      kind: "player-character",
      createdAt: character.createdAt,
      updatedAt: character.updatedAt,
    } as never,
    entries: TIDEWATCH_ENTRIES,
    choiceSelections: character.choiceSelections,
    equipmentSelections: character.equipmentSelections,
  });
  return state.ruleResult.context.armor;
}

// ---------------------------------------------------------------------------
// Scope A — maximum-hit-point progression
// ---------------------------------------------------------------------------

describe("maximum hit points apply Constitution once per level", () => {
  it("is the acceptance case: a level 5 build reaches 44, not 36", () => {
    // The defect this pins: the engine reported class base + one Constitution
    // modifier, so every level above the first lost its contribution.
    const sheet = sheetFor({ level: 5 });
    expect(TIDEWATCH_HIT_POINT_BASE[5]).toBe(34);
    expect(sheet.abilities.constitution.modifier.value).toBe(2);
    expect(sheet.hitPoints.maximum.value).toBe(44);
    expect(sheet.hitPoints.maximum.value).not.toBe(TIDEWATCH_HIT_POINT_BASE[5] + 2);
  });

  it("keeps the level 1 calculation exactly as it was", () => {
    expect(sheetFor({ level: 1 }).hitPoints.maximum.value).toBe(TIDEWATCH_HIT_POINT_BASE[1] + 2);
  });

  it("explains the Constitution contribution as a per-level total", () => {
    const maximum = sheetFor({ level: 5 }).hitPoints.maximum;
    const ability = maximum.contributors.filter(item => item.kind === "ability");
    expect(ability).toHaveLength(1);
    expect(ability[0].amount).toBe(10);
    const base = maximum.contributors.filter(item => item.kind === "base");
    expect(base).toHaveLength(1);
    expect(base[0].amount).toBe(TIDEWATCH_HIT_POINT_BASE[5]);
  });

  it("applies a zero modifier as zero at every level", () => {
    // Constitution 10 is a modifier of 0, so the maximum is exactly the base.
    const sheet = sheetFor({ level: 5, constitution: 10 });
    expect(sheet.abilities.constitution.modifier.value).toBe(0);
    expect(sheet.hitPoints.maximum.value).toBe(TIDEWATCH_HIT_POINT_BASE[5]);
  });

  it("subtracts a negative modifier once per level, with no invented floor", () => {
    /*
     * No schema, decision record or content mechanism in this repository
     * declares a minimum hit-point gain per level, so none is applied. Inventing
     * one here would be a rule this project has never made.
     */
    const sheet = sheetFor({ level: 5, constitution: 8 });
    expect(sheet.abilities.constitution.modifier.value).toBe(-1);
    expect(sheet.hitPoints.maximum.value).toBe(TIDEWATCH_HIT_POINT_BASE[5] - 5);
    expect(sheet.issues.map(issue => issue.code)).not.toContain("HIT_POINTS_MAXIMUM_NOT_POSITIVE");
  });

  it("applies the arithmetic to the lowest reachable modifier without clamping", () => {
    const bleak = record({ level: 1, constitution: 1 });
    const sheet = resolveDerivedCharacter({ character: bleak, entries: TIDEWATCH_ENTRIES });
    // Constitution 1 is a modifier of -5, so a 10-point base becomes 5.
    expect(sheet.hitPoints.maximum.value).toBe(TIDEWATCH_HIT_POINT_BASE[1] - 5);
    expect(sheet.issues.map(issue => issue.code)).not.toContain("HIT_POINTS_MAXIMUM_NOT_POSITIVE");
  });

  it("is one calculation, exposed for every consumer", () => {
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: 2, level: 5 }).value).toBe(44);
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: 0, level: 5 }).value).toBe(34);
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: -1, level: 5 }).value).toBe(29);
    expect(maximumHitPointsFor({ classBase: null, constitutionModifier: 2, level: 5 }).value).toBeNull();
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: null, level: 5 }).value).toBeNull();
    // The Constitution contribution is reported per level, not per character.
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: 2, level: 5 }).constitutionTotal).toBe(10);
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: 2, level: 1 }).constitutionTotal).toBe(2);
  });

  it("names a maximum that is not a usable number rather than clamping it", () => {
    // Content this repository ships cannot reach it, but the arithmetic can, and
    // a maximum of zero or less describes no character. It is reported, not
    // silently raised to some invented floor.
    const bottomed = maximumHitPointsFor({ classBase: 8, constitutionModifier: -2, level: 5 });
    expect(bottomed.value).toBe(-2);
    expect(bottomed.notPositive).toBe(true);
    expect(maximumHitPointsFor({ classBase: 34, constitutionModifier: -1, level: 5 }).notPositive).toBe(false);
  });

  it("recomputes deterministically when an ability score changes", () => {
    const first = sheetFor({ level: 5 }).hitPoints.maximum.value;
    const second = sheetFor({ level: 5 }).hitPoints.maximum.value;
    expect(first).toBe(second);
    const raised = sheetFor({ level: 5, constitution: 16 });
    expect(raised.abilities.constitution.modifier.value).toBe(3);
    expect(raised.hitPoints.maximum.value).toBe(TIDEWATCH_HIT_POINT_BASE[5] + 15);
    // Returning to the original score returns to the original maximum.
    expect(sheetFor({ level: 5 }).hitPoints.maximum.value).toBe(first);
  });

  it("reports that a multiclass hit-point base is not represented rather than guessing", () => {
    const multi = record({
      level: 5,
      classLevels: [
        { classId: TIDEWATCH_IDS.class, level: 3, subclassId: TIDEWATCH_IDS.subclassHold },
        { classId: TIDEWATCH_IDS.mirroredClass, level: 2 },
      ],
    });
    const sheet = resolveDerivedCharacter({ character: multi, entries: TIDEWATCH_ENTRIES });
    expect(sheet.issues.map(issue => issue.code)).toContain("HIT_POINTS_MULTICLASS_UNRESOLVED");
  });

  it("agrees between direct creation and a sequential climb, and through reopen", async () => {
    await installTidewatchRuleset(harness);

    // Direct creation at level 5.
    const direct = await openDraft(build({ level: 5 }));
    expect(direct.plan.guidedComplete).toBe(true);
    await commitDraft(direct, "character:direct");
    const directSheet = await harness.query.sheet("character:direct");
    expect(directSheet?.hitPoints.maximum.value).toBe(44);

    // The same class climbed one level at a time.
    const sequentialDraft = await openDraft(build({ level: 1, subclassId: null }));
    await commitDraft(sequentialDraft, "character:climb");
    const expectedByLevel = [12, 20, 28, 36, 44];
    expect((await harness.query.sheet("character:climb"))?.hitPoints.maximum.value).toBe(expectedByLevel[0]);

    for (let target = 2; target <= 5; target++) {
      const character = await harness.database.characters.get("character:climb");
      const runtime = await harness.database.characterRuntimeStates.get("character:climb");
      const preview = expectOk<LevelUpPreview>(
        await harness.levelUp.preview(
          "character:climb",
          {},
          target === 3 ? TIDEWATCH_IDS.subclassHold : undefined,
        ),
      );
      expect(preview.toLevel).toBe(target);
      // The preview promises exactly what the commit then produces.
      expect(preview.hitPoints.afterMaximum).toBe(expectedByLevel[target - 1]);
      expect(preview.hitPoints.maximumDelta).toBe(expectedByLevel[target - 1] - expectedByLevel[target - 2]);
      expectOk<LevelUpResult>(
        await harness.levelUp.confirm({
          operationId: `op:climb-${target}`,
          characterId: "character:climb",
          expectedCharacterRevision: character?.revision ?? 0,
          expectedRuntimeRevision: runtime?.revision ?? 0,
          targetLevel: target,
          expectedContentFingerprint: preview.contentFingerprint,
          choiceSelections: {},
          ...(target === 3 ? { subclassId: TIDEWATCH_IDS.subclassHold } : {}),
        }),
      );
      expect((await harness.query.sheet("character:climb"))?.hitPoints.maximum.value).toBe(expectedByLevel[target - 1]);
    }

    // Direct and sequential land on the same maximum.
    const climbed = await harness.query.sheet("character:climb");
    expect(climbed?.hitPoints.maximum.value).toBe(directSheet?.hitPoints.maximum.value);

    // Reopening reads the same number back rather than a stored one.
    const reopened = await harness.query.sheet("character:direct");
    expect(reopened?.hitPoints.maximum.value).toBe(44);
  });
});

// ---------------------------------------------------------------------------
// Scope B — typed armour context
// ---------------------------------------------------------------------------

describe("the armour context is resolved from the build's own equipment", () => {
  it("is the acceptance case: 16 base armour plus a generic +1 is 17", () => {
    const sheet = sheetFor({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coat });
    expect(sheet.armorClass.value).toBe(TIDEWATCH_BODY_ARMOR_CLASS + TIDEWATCH_ARMOR_BONUS);
    expect(sheet.armorClass.value).toBe(17);
  });

  it("includes the applicable modifier exactly once", () => {
    const contributors = sheetFor({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coat }).armorClass.contributors;
    const feature = contributors.filter(item => item.kind === "feature");
    expect(feature).toHaveLength(1);
    expect(feature[0].amount).toBe(TIDEWATCH_ARMOR_BONUS);
    const equipment = contributors.filter(item => item.kind === "equipment");
    expect(equipment).toHaveLength(1);
    expect(equipment[0].amount).toBe(TIDEWATCH_BODY_ARMOR_CLASS);
  });

  it("reports worn armour and its typed category", () => {
    const worn = armorContextOf(record({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coat }));
    expect(worn.worn).toBe(true);
    expect(worn.type).toBe("heavy");
  });

  it("leaves the effect inactive when nothing is worn", () => {
    const bare = record({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.ropeOnly });
    expect(armorContextOf(bare)).toMatchObject({ worn: false });
    expect(armorContextOf(bare).type).toBeUndefined();
    expect(bracedStanceApplied(bare)).toBe(false);
  });

  it("does not let unrelated equipped gear activate the condition", () => {
    const gear = record({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.ropeOnly });
    // The rope is equipped, and it is still not armour.
    const sheet = resolveDerivedCharacter({ character: gear, entries: TIDEWATCH_ENTRIES });
    expect(sheet.equipment.some(item => item.itemId === TIDEWATCH_IDS.plainGear && item.status === "equipped")).toBe(true);
    expect(bracedStanceApplied(gear)).toBe(false);
  });

  it("does not mistake a shield for body armour", () => {
    const shielded = record({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.shieldOnly });
    const context = armorContextOf(shielded);
    expect(context.worn).toBe(false);
    expect(context.type).toBeUndefined();
    expect(context.shield).toBe(true);
    expect(bracedStanceApplied(shielded)).toBe(false);
  });

  it("adds a shield on top of body armour without changing what counts as worn", () => {
    const both = record({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coatAndShield });
    expect(armorContextOf(both)).toMatchObject({ worn: true, type: "heavy", shield: true });
    const sheet = resolveDerivedCharacter({ character: both, entries: TIDEWATCH_ENTRIES });
    expect(sheet.armorClass.value).toBe(TIDEWATCH_BODY_ARMOR_CLASS + TIDEWATCH_SHIELD_ARMOR_CLASS + TIDEWATCH_ARMOR_BONUS);
  });

  it("updates immediately when the equipment selection changes", () => {
    const armoured = sheetFor({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coat }).armorClass.value;
    const swapped = sheetFor({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coatAndShield }).armorClass.value;
    const removed = sheetFor({ level: 1, protection: TIDEWATCH_EQUIPMENT_OPTIONS.ropeOnly }).armorClass;
    expect(armoured).toBe(17);
    expect(swapped).toBe(19);
    // With nothing worn there is no automatic answer to give, and none is invented.
    expect(removed.value).toBeNull();
    expect(removed.recovery?.code).toBe("ARMOUR_UNRESOLVED");
  });

  it("uses the same resolved context in planning as in derivation", () => {
    for (const protection of Object.values(TIDEWATCH_EQUIPMENT_OPTIONS)) {
      const planned = planActivation(build({ level: 1, subclassId: null, protection }), TIDEWATCH_ENTRIES).armor;
      const derived = armorContextOf(record({ level: 1, protection }));
      expect(planned).toEqual(derived);
    }
  });

  it("agrees between direct creation and reopen", async () => {
    await installTidewatchRuleset(harness);
    const draft = await openDraft(build({ level: 1, subclassId: null, protection: TIDEWATCH_EQUIPMENT_OPTIONS.coat }));
    expect(draft.plan.guidedComplete).toBe(true);
    await commitDraft(draft, "character:armoured");
    expect((await harness.query.sheet("character:armoured"))?.armorClass.value).toBe(17);
    // Reopening resolves from content again and reaches the same answer.
    expect((await harness.query.sheet("character:armoured"))?.armorClass.value).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// Scope C — defensive subclass unification
// ---------------------------------------------------------------------------

describe("one subclass decision produces one user-facing decision", () => {
  it("leaves a typed-only declaration exactly as it was", () => {
    const plan = planBuild(build({ level: 5 }), TIDEWATCH_ENTRIES);
    expect(plan.subclass?.selectedId).toBe(TIDEWATCH_IDS.subclassHold);
    expect(plan.subclass?.valid).toBe(true);
    expect(plan.subclass?.unresolved).toBe(false);
    expect(plan.requiredChoices.map(choice => choice.choiceId)).toEqual([TIDEWATCH_CHOICES.classSkills]);
    expect(plan.guidedComplete).toBe(true);
  });

  it("shows a redundant declaration once, and the typed decision satisfies it", () => {
    const unresolved = planBuild(build({ level: 3, classId: TIDEWATCH_IDS.mirroredClass, subclassId: null }), TIDEWATCH_ENTRIES);
    // One surface before the decision: the typed one, reported unresolved.
    expect(unresolved.subclass?.unresolved).toBe(true);
    expect(unresolved.requiredChoices.map(choice => choice.choiceId)).not.toContain(TIDEWATCH_CHOICES.mirroredPath);
    expect(unresolved.issues.map(issue => issue.code)).toContain("SUBCLASS_NOT_CHOSEN");
    expect(unresolved.guidedComplete).toBe(false);

    const resolved = planBuild(
      build({ level: 3, classId: TIDEWATCH_IDS.mirroredClass, subclassId: TIDEWATCH_IDS.mirroredFirst }),
      TIDEWATCH_ENTRIES,
    );
    // One surface after it, too — and no leftover generic requirement.
    expect(resolved.subclass?.valid).toBe(true);
    expect(resolved.requiredChoices.map(choice => choice.choiceId)).not.toContain(TIDEWATCH_CHOICES.mirroredPath);
    expect(resolved.issues.map(issue => issue.code)).not.toContain("CHOICE_UNRESOLVED");
    expect(resolved.guidedComplete).toBe(true);
  });

  it("records which generic choice the typed decision absorbed", () => {
    const activation = planActivation(
      build({ level: 3, classId: TIDEWATCH_IDS.mirroredClass, subclassId: TIDEWATCH_IDS.mirroredFirst }),
      TIDEWATCH_ENTRIES,
    );
    expect(activation.subclass?.unifiedChoiceIds).toEqual([TIDEWATCH_CHOICES.mirroredPath]);
  });

  it("resolves a redundantly declared subclass through the rules engine", () => {
    const state = deriveCharacterState({
      character: {
        id: "character:mirror",
        name: "Mirror",
        level: 3,
        advancement: "milestone",
        classLevels: [{ classId: TIDEWATCH_IDS.mirroredClass, level: 3, subclassId: TIDEWATCH_IDS.mirroredFirst }],
        speciesId: TIDEWATCH_IDS.species,
        backgroundId: TIDEWATCH_IDS.background,
        rulesetProfileId: TIDEWATCH_RULESET_ID,
        abilities: FINAL_SCORES,
        baseHitPoints: 0,
        currentHitPoints: 0,
        temporaryHitPoints: 0,
        exhaustion: 0,
        deathSaves: { successes: 0, failures: 0 },
        selections: [],
        biography: {},
        tags: [],
        status: "active",
        kind: "player-character",
        createdAt: "2026-08-05T08:00:00.000Z",
        updatedAt: "2026-08-05T08:00:00.000Z",
      } as never,
      entries: TIDEWATCH_ENTRIES,
      choiceSelections: {},
      equipmentSelections: { [TIDEWATCH_BUNDLES.protection]: [TIDEWATCH_EQUIPMENT_OPTIONS.coat] },
    });
    // The typed decision alone leaves nothing unresolved and activates the
    // subclass's own progression exactly once.
    expect(state.issues.map(issue => issue.code)).not.toContain("CHOICE_UNRESOLVED");
    expect(state.status).toBe("ready");
    expect(state.activeEntryIds.has(TIDEWATCH_IDS.mirroredFirst)).toBe(true);
    expect(state.classFeatureIds.has("feature:tw-mirror-ebb")).toBe(true);
  });

  it("diagnoses an ambiguous partial overlap instead of deadlocking on it", () => {
    const plan = planBuild(
      build({ level: 3, classId: TIDEWATCH_IDS.tangledClass, subclassId: TIDEWATCH_IDS.tangledFirst }),
      TIDEWATCH_ENTRIES,
    );
    // Not unified: the choice offers something that is not a subclass, so
    // discarding it would drop a real decision.
    expect(plan.requiredChoices.map(choice => choice.choiceId)).toContain(TIDEWATCH_CHOICES.tangledPath);
    const ambiguous = plan.issues.find(issue => issue.code === "SUBCLASS_CHOICE_OVERLAP_AMBIGUOUS");
    expect(ambiguous).toBeDefined();
    expect(ambiguous?.severity).toBe("warning");
    expect(ambiguous?.recordId).toBe(TIDEWATCH_CHOICES.tangledPath);
    // A warning is not a deadlock: answering both decisions still completes.
    const answered = planBuild(
      build({
        level: 3,
        classId: TIDEWATCH_IDS.tangledClass,
        subclassId: TIDEWATCH_IDS.tangledFirst,
        choiceSelections: { [TIDEWATCH_CHOICES.tangledPath]: ["option:tw-net-hauler"] },
      }),
      TIDEWATCH_ENTRIES,
    );
    expect(answered.guidedComplete).toBe(true);
  });

  it("leaves unrelated generic choices untouched", () => {
    const plan = planBuild(build({ level: 5, choiceSelections: {} }), TIDEWATCH_ENTRIES);
    const skills = plan.requiredChoices.find(choice => choice.choiceId === TIDEWATCH_CHOICES.classSkills);
    expect(skills).toBeDefined();
    expect(skills?.resolved).toBe(false);
    expect(skills?.options.map(option => option.id)).toEqual([
      `option:${TIDEWATCH_PROFICIENCIES.skillRigging}`,
      `option:${TIDEWATCH_PROFICIENCIES.skillTidelore}`,
    ]);
    expect(plan.issues.map(issue => issue.code)).not.toContain("SUBCLASS_CHOICE_OVERLAP_AMBIGUOUS");
  });

  it("commits a redundantly declared subclass created directly at level 5", async () => {
    await installTidewatchRuleset(harness);
    const before = await openDraft(build({ level: 5, classId: TIDEWATCH_IDS.mirroredClass, subclassId: null }));
    // Confirmation is unavailable until the one decision is made.
    expect(before.plan.guidedComplete).toBe(false);
    expect(before.plan.issues.map(issue => issue.code)).toContain("SUBCLASS_NOT_CHOSEN");

    const after = expectOk<DraftSnapshot>(
      await harness.drafts.update({
        draftId: before.draft.id,
        expectedRevision: before.revision,
        patch: { subclassId: TIDEWATCH_IDS.mirroredSecond },
      }),
    );
    expect(after.plan.guidedComplete).toBe(true);

    await commitDraft(after, "character:mirror-direct");
    const sheet = await harness.query.sheet("character:mirror-direct");
    expect(sheet?.subclassLabel).toBe("Flood");
    expect(sheet?.issues.map(issue => issue.code)).not.toContain("CHOICE_UNRESOLVED");
    // Persisted, and read back from content on reopen.
    const stored = await harness.database.characters.get("character:mirror-direct");
    expect(stored?.classLevels[0].subclassId).toBe(TIDEWATCH_IDS.mirroredSecond);
    expect((await harness.query.sheet("character:mirror-direct"))?.subclassLabel).toBe("Flood");
  });

  it("chooses a redundantly declared subclass sequentially at level 3", async () => {
    await installTidewatchRuleset(harness);
    const draft = await openDraft(build({ level: 2, classId: TIDEWATCH_IDS.mirroredClass, subclassId: null }));
    await commitDraft(draft, "character:mirror-climb");

    const character = await harness.database.characters.get("character:mirror-climb");
    const runtime = await harness.database.characterRuntimeStates.get("character:mirror-climb");
    const preview = expectOk<LevelUpPreview>(await harness.levelUp.preview("character:mirror-climb"));
    expect(preview.toLevel).toBe(3);
    // One decision in the preview: the typed subclass, and no duplicate choice.
    expect(preview.subclass?.unresolved).toBe(true);
    expect(preview.newChoices.map(choice => choice.choiceId)).not.toContain(TIDEWATCH_CHOICES.mirroredPath);
    expect(preview.blocked).toBe(true);
    expect(preview.blockingCodes).toContain("SUBCLASS_NOT_CHOSEN");

    const chosen = expectOk<LevelUpPreview>(
      await harness.levelUp.preview("character:mirror-climb", {}, TIDEWATCH_IDS.mirroredFirst),
    );
    expect(chosen.blocked).toBe(false);

    expectOk<LevelUpResult>(
      await harness.levelUp.confirm({
        operationId: "op:mirror-climb",
        characterId: "character:mirror-climb",
        expectedCharacterRevision: character?.revision ?? 0,
        expectedRuntimeRevision: runtime?.revision ?? 0,
        targetLevel: 3,
        expectedContentFingerprint: chosen.contentFingerprint,
        choiceSelections: {},
        subclassId: TIDEWATCH_IDS.mirroredFirst,
      }),
    );
    const sheet = await harness.query.sheet("character:mirror-climb");
    expect(sheet?.subclassLabel).toBe("Ebb");
    expect(sheet?.issues.map(issue => issue.code)).not.toContain("CHOICE_UNRESOLVED");
  });
});
