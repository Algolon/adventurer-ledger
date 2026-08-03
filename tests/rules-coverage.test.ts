import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import type { Character, ContentEntry, EquipmentBundleDefinition } from "@/src/domain/model";
import { resolveContentRelations } from "@/src/domain/resolve-content";
import { packCoveragePresentation } from "@/src/domain/pack-coverage";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import { deriveCharacterState } from "@/src/rules/derive-character";
import { resolveChoices } from "@/src/rules/choice-resolution";
import { resolveEquipmentBundles } from "@/src/rules/equipment";
import { LedgerDB } from "@/src/storage/db";
import { syntheticPack } from "@/tests/fixtures/synthetic-pack";

const stamp = "2026-08-03T08:00:00.000Z";
const template = (): ContentEntry => syntheticPack().entries[0];
const entry = (id: string, category: ContentEntry["category"], mechanics: Record<string, unknown>, overrides: Partial<ContentEntry> = {}): ContentEntry => ({
  ...template(), id, slug: id.replaceAll(":", "-"), name: `Synthetic ${id}`, category, mechanics, effects: [], choices: [], equipmentBundles: [], links: [], ...overrides,
});
const character = (intelligence = 13): Character => ({
  id: "character:synthetic", name: "Synthetic Hero", level: 5, advancement: "milestone",
  classLevels: [{ classId: "class:sentinel", subclassId: "subclass:warden", level: 3 }, { classId: "class:scholar", level: 2 }],
  rulesetProfileId: "ruleset:synthetic", abilities: { strength: 15, dexterity: 12, constitution: 14, intelligence, wisdom: 10, charisma: 8 },
  baseHitPoints: 30, currentHitPoints: 30, temporaryHitPoints: 0, exhaustion: 0, deathSaves: { successes: 0, failures: 0 }, selections: [], biography: {}, tags: [], status: "active", kind: "player-character", createdAt: stamp, updatedAt: stamp,
});

function multiclassEntries(): ContentEntry[] {
  const sentinel = entry("class:sentinel", "class", {
    hitDie: 10, primaryAbilities: ["strength"], savingThrows: ["save:strength", "save:constitution"], startingProficiencyIds: ["proficiency:all-armor"],
    progression: [{ level: 1, proficiencyBonus: 2, featureIds: ["feature:sentinel-core"], choiceIds: [], resourceChanges: {} }, { level: 2, proficiencyBonus: 2, featureIds: ["feature:sentinel-dice"], choiceIds: [], resourceChanges: { "resource:focus": 1 } }],
    subclassLevel: 3, subclassIds: ["subclass:warden"], multiclass: { prerequisites: [], grantedProficiencyIds: ["proficiency:light-armor"], spellSlotProgression: "none", unsupportedWithClassIds: [] },
  });
  const scholar = entry("class:scholar", "class", {
    hitDie: 6, primaryAbilities: ["intelligence"], savingThrows: ["save:intelligence", "save:wisdom"], startingProficiencyIds: ["proficiency:lore"],
    progression: [{ level: 1, proficiencyBonus: 2, featureIds: ["feature:scholar-spellcasting"], choiceIds: [], resourceChanges: {} }],
    subclassLevel: 3, subclassIds: [], multiclass: {
      prerequisites: [{ id: "prerequisite:scholar-int", label: "Synthetic intellect", condition: { type: "ability", ability: "intelligence", operator: "gte", value: 13 }, enforcement: "hard" }],
      grantedProficiencyIds: ["proficiency:lore"], spellSlotProgression: "full", unsupportedWithClassIds: [],
    },
  });
  const subclass = entry("subclass:warden", "subclass", { classId: "class:sentinel", progression: [{ level: 3, featureIds: ["feature:warden-guard"], choiceIds: [] }] });
  return [
    sentinel, scholar, subclass,
    entry("feature:sentinel-core", "class-feature", { classId: "class:sentinel", level: 1, featureType: "core" }, { effects: [{ id: "effect:sentinel-core", type: "grantFeature", featureId: "feature:sentinel-core" }] }),
    entry("feature:sentinel-dice", "class-feature", { classId: "class:sentinel", level: 2, featureType: "resource" }, { effects: [{ id: "effect:sentinel-dice", type: "addDice", target: "damage:synthetic", dice: { count: 1, faces: 6 } }] }),
    entry("feature:scholar-spellcasting", "class-feature", { classId: "class:scholar", level: 1, featureType: "core" }),
    entry("feature:warden-guard", "class-feature", { classId: "class:sentinel", level: 3, featureType: "subclass" }),
  ];
}

describe("choice, equipment, progression, and multiclass coverage", () => {
  it("resolves selected nested choices and reports every unresolved branch", () => {
    const choices = [{
      id: "choice:style", label: "Synthetic style", min: 1, max: 1, repeatable: false,
      options: [{
        id: "option:guard", label: "Synthetic guard",
        effects: [{ id: "effect:guard", type: "modifyArmorClass" as const, operation: "add" as const, value: { kind: "literal" as const, value: 1 } }],
        childChoices: [{ id: "choice:tool", label: "Synthetic tool", min: 1, max: 1, repeatable: false, options: [{ id: "option:tools", label: "Synthetic tools", entryId: "tool:synthetic" }] }],
      }],
    }];
    const unresolved = resolveChoices(choices, { "choice:style": ["option:guard"] });
    expect(unresolved.unresolvedChoiceIds).toEqual(new Set(["choice:tool"]));
    const resolved = resolveChoices(choices, { "choice:style": ["option:guard"], "choice:tool": ["option:tools"] });
    expect(resolved.issues).toEqual([]);
    expect(resolved.effects.map(effect => effect.id)).toEqual(["effect:guard"]);
    expect(resolved.entryIds).toEqual(new Set(["tool:synthetic"]));
  });

  it("derives class-level progression, subclass features, multiclass grants, slots, and effects", () => {
    const result = deriveCharacterState({ character: character(), entries: multiclassEntries() });
    expect(result.status).toBe("ready");
    expect(result.classFeatureIds).toEqual(new Set(["feature:sentinel-core", "feature:sentinel-dice", "feature:scholar-spellcasting", "feature:warden-guard"]));
    expect(result.ruleResult.context.proficiencies).toEqual(new Set(["save:strength", "save:constitution", "proficiency:all-armor", "proficiency:lore"]));
    expect(result.spellSlots).toMatchObject({ combinedCasterLevel: 2, slotsBySpellLevel: { 1: 3 } });
    expect(result.ruleResult.rollRules.extraDice).toHaveLength(1);
  });

  it("makes failed prerequisites and unsupported class combinations explicit", () => {
    const failed = deriveCharacterState({ character: character(10), entries: multiclassEntries() });
    expect(failed.status).toBe("invalid");
    expect(failed.issues).toContainEqual(expect.objectContaining({ code: "MULTICLASS_PREREQUISITE_FAILED" }));
    const entries = multiclassEntries(), scholar = entries.find(item => item.id === "class:scholar");
    if (!scholar) throw new Error("Synthetic class fixture is missing");
    const mechanics = scholar.mechanics as { multiclass: { unsupportedWithClassIds: string[] } };
    mechanics.multiclass.unsupportedWithClassIds = ["class:sentinel"];
    expect(deriveCharacterState({ character: character(), entries }).issues).toContainEqual(expect.objectContaining({ code: "MULTICLASS_COMBINATION_UNSUPPORTED" }));
  });

  it("rejects duplicate class rows and unavailable selected identity entries", () => {
    const invalidCharacter: Character = {
      ...character(),
      classLevels: [
        { classId: "class:sentinel", subclassId: "subclass:warden", level: 3 },
        { classId: "class:sentinel", level: 2 },
      ],
      backgroundId: "background:missing",
    };
    const result = deriveCharacterState({ character: invalidCharacter, entries: multiclassEntries() });
    expect(result.status).toBe("invalid");
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DUPLICATE_CLASS_SELECTION", recordId: "class:sentinel" }),
      expect.objectContaining({ code: "FEATURE_REFERENCE_MISSING", recordId: "background:missing" }),
    ]));
  });

  it("requires class choices only when their class-level progression unlocks them", () => {
    const entries = multiclassEntries(), sentinel = entries.find(item => item.id === "class:sentinel");
    if (!sentinel) throw new Error("Synthetic class fixture is missing");
    sentinel.choices = [{ id: "choice:future", label: "Synthetic future choice", min: 1, max: 1, repeatable: false, options: [{ id: "option:future", label: "Synthetic future option" }] }];
    expect(deriveCharacterState({ character: character(), entries }).status).toBe("ready");
    const mechanics = sentinel.mechanics as { progression: Array<{ level: number; choiceIds: string[] }> };
    const row = mechanics.progression.find(item => item.level === 2);
    if (!row) throw new Error("Synthetic progression row is missing");
    row.choiceIds = ["choice:future"];
    const unresolved = deriveCharacterState({ character: character(), entries });
    expect(unresolved.status).toBe("invalid");
    expect(unresolved.pendingChoiceIds).toEqual(new Set(["choice:future"]));
  });

  it("does not keep a valid class choice pending after applying its selected effects", () => {
    const entries = multiclassEntries(), sentinel = entries.find(item => item.id === "class:sentinel");
    if (!sentinel) throw new Error("Synthetic class fixture is missing");
    sentinel.choices = [{
      id: "choice:style", label: "Synthetic style", min: 1, max: 1, repeatable: false,
      options: [{
        id: "option:guard", label: "Synthetic guard",
        effects: [{ id: "effect:guard", type: "modifyArmorClass", operation: "add", value: { kind: "literal", value: 1 } }],
      }],
    }];
    sentinel.effects = [{ id: "effect:choose-style", type: "grantChoice", choiceId: "choice:style" }];
    const mechanics = sentinel.mechanics as { progression: Array<{ level: number; choiceIds: string[] }> };
    const row = mechanics.progression.find(item => item.level === 2);
    if (!row) throw new Error("Synthetic progression row is missing");
    row.choiceIds = ["choice:style"];

    const result = deriveCharacterState({
      character: character(), entries, choiceSelections: { "choice:style": ["option:guard"] },
    });

    expect(result.status).toBe("ready");
    expect(result.pendingChoiceIds).toEqual(new Set());
    expect(result.ruleResult.context.values.armorClass).toBe(1);
    expect(result.ruleResult.trace).toContainEqual(expect.objectContaining({ effectId: "effect:choose-style", applied: true, reason: "Applied" }));
  });

  it("resolves nested equipment choices, quantities, alternatives, and status", () => {
    const bundle: EquipmentBundleDefinition = {
      id: "bundle:starter", label: "Synthetic starter", entries: [
        { type: "item", itemId: "armor:missing", alternativeItemIds: ["armor:synthetic"], quantity: 1, status: "equipped" },
        { type: "choice", id: "choice:weapon", label: "Synthetic weapon", min: 1, max: 1, options: [
          { id: "option:sword", label: "Synthetic sword", entries: [{ type: "bundle", id: "bundle:sword-kit", entries: [{ type: "item", itemId: "weapon:synthetic", quantity: 2, status: "carried" }] }] },
          { id: "option:tool", label: "Synthetic tool", entries: [{ type: "item", itemId: "tool:synthetic", quantity: 1, status: "granted" }] },
        ] },
      ],
    };
    const resolved = resolveEquipmentBundles([bundle.id], [bundle], { "choice:weapon": ["option:sword"] }, new Set(["armor:synthetic", "weapon:synthetic"]));
    expect(resolved.issues).toEqual([]);
    expect(resolved.items).toEqual([
      { itemId: "armor:synthetic", quantity: 1, status: "equipped", sourceBundleId: bundle.id },
      { itemId: "weapon:synthetic", quantity: 2, status: "carried", sourceBundleId: bundle.id },
    ]);
    const duplicate = resolveEquipmentBundles([bundle.id], [bundle], { "choice:weapon": ["option:sword", "option:sword"] }, new Set(["armor:synthetic", "weapon:synthetic"]));
    expect(duplicate.issues).toContainEqual(expect.objectContaining({ code: "EQUIPMENT_CHOICE_INVALID" }));
    expect(resolveEquipmentBundles([bundle.id, bundle.id], [bundle], { "choice:weapon": ["option:sword"] }, new Set(["armor:synthetic", "weapon:synthetic"])).items).toEqual(resolved.items);
  });
});

function identityEntries(): ContentEntry[] {
  return [
    ...multiclassEntries(),
    entry("species:synthetic", "species", { creatureType: "humanoid", sizeChoices: ["medium"], speed: 35, traitIds: ["trait:species", "trait:replaced"], lineageIds: ["lineage:synthetic"] }),
    entry("lineage:synthetic", "lineage", { parentSpeciesIds: ["species:synthetic"], traitIds: ["trait:lineage"], replacesTraitIds: ["trait:replaced"] }),
    entry("trait:species", "rule", { kind: "trait", data: {} }, { effects: [{ id: "effect:trait-speed", type: "modifySpeed", operation: "add", value: { kind: "literal", value: 10 } }] }),
    entry("trait:lineage", "rule", { kind: "trait", data: {} }, { effects: [{ id: "effect:trait-initiative", type: "modifyInitiative", operation: "add", value: { kind: "literal", value: 2 } }] }),
    entry("trait:replaced", "rule", { kind: "trait", data: {} }, { effects: [{ id: "effect:trait-replaced", type: "modifyArmorClass", operation: "add", value: { kind: "literal", value: 99 } }] }),
    entry("background:synthetic", "background", { abilityScoreChoices: { abilities: ["strength", "dexterity"], increasePattern: [2, 1] }, featId: "feat:synthetic", proficiencyIds: ["proficiency:insight"], equipmentChoiceIds: [], equipmentBundleIds: [] }),
    entry("feat:synthetic", "feat", { category: "origin", repeatable: false }, { effects: [{ id: "effect:feat-proficiency", type: "grantProficiency", proficiencyId: "proficiency:survival" }] }),
  ];
}
const identityCharacter = (): Character => ({ ...character(), speciesId: "species:synthetic", lineageId: "lineage:synthetic", backgroundId: "background:synthetic" });

describe("derived identity relations", () => {
  it("activates species, lineage and background relations the schema already declares", () => {
    const result = deriveCharacterState({ character: identityCharacter(), entries: identityEntries() });
    expect(result.status).toBe("ready");
    expect(result.identityTraitIds).toEqual(new Set(["trait:lineage", "trait:species"]));
    expect([...result.activeEntryIds]).toEqual(expect.arrayContaining([
      "species:synthetic", "lineage:synthetic", "background:synthetic", "feat:synthetic", "trait:species", "trait:lineage",
    ]));
    // The lineage replaces a species trait, so neither the entry nor its effect is active.
    expect(result.activeEntryIds.has("trait:replaced")).toBe(false);
    expect(result.ruleResult.context.values.armorClass).toBeUndefined();
    // Species speed is the base the modifiers then apply to.
    expect(result.ruleResult.context.values.speed).toBe(45);
    expect(result.ruleResult.context.values.initiative).toBe(3);
    // Background proficiency IDs and the background feat's own effects both land.
    expect([...result.ruleResult.context.proficiencies]).toEqual(expect.arrayContaining(["proficiency:insight", "proficiency:survival"]));
  });

  it("uses the legacy race speed and traits when no species is selected", () => {
    const entries = [
      ...multiclassEntries(),
      entry("race:synthetic", "race", { creatureType: "humanoid", sizeChoices: ["medium"], speed: 25, traitIds: ["trait:legacy"], legacyAbilityScores: {} }),
      entry("trait:legacy", "rule", { kind: "trait", data: {} }),
    ];
    const result = deriveCharacterState({ character: { ...character(), legacyRaceId: "race:synthetic" }, entries });
    expect(result.status).toBe("ready");
    expect(result.identityTraitIds).toEqual(new Set(["trait:legacy"]));
    expect(result.ruleResult.context.values.speed).toBe(25);
  });

  it("reports unavailable trait and background-feat targets instead of ignoring them", () => {
    const entries = identityEntries().filter(item => item.id !== "trait:species" && item.id !== "feat:synthetic");
    const result = deriveCharacterState({ character: identityCharacter(), entries });
    expect(result.status).toBe("invalid");
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FEATURE_REFERENCE_MISSING", recordId: "trait:species" }),
      expect.objectContaining({ code: "FEATURE_REFERENCE_MISSING", recordId: "feat:synthetic" }),
    ]));
  });

  it("rejects a lineage that does not belong to the selected species", () => {
    const entries = identityEntries(), lineage = entries.find(item => item.id === "lineage:synthetic");
    if (!lineage) throw new Error("Synthetic lineage fixture is missing");
    (lineage.mechanics as { parentSpeciesIds: string[] }).parentSpeciesIds = ["species:other"];
    const result = deriveCharacterState({ character: identityCharacter(), entries });
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "LINEAGE_INVALID", recordId: "lineage:synthetic" }));
  });

  it("reports invalid identity mechanics rather than deriving from them", () => {
    const entries = identityEntries(), species = entries.find(item => item.id === "species:synthetic");
    if (!species) throw new Error("Synthetic species fixture is missing");
    species.mechanics = { creatureType: "humanoid", sizeChoices: [], speed: -5, traitIds: [] };
    const result = deriveCharacterState({ character: identityCharacter(), entries });
    expect(result.status).toBe("invalid");
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "IDENTITY_MECHANICS_INVALID", recordId: "species:synthetic" }));
    expect(result.ruleResult.context.values.speed).toBeUndefined();
  });

  it("reports a selected entry whose category does not match the selection slot", () => {
    const result = deriveCharacterState({ character: { ...character(), speciesId: "class:sentinel" }, entries: identityEntries() });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "FEATURE_REFERENCE_MISSING", recordId: "class:sentinel" }));
  });
});

describe("import and conflict visibility", () => {
  let database: LedgerDB | undefined;
  afterEach(async () => { if (database) { database.close(); await database.delete(); database = undefined; } });

  it("blocks missing equipment references and warns for manual effects without echoing content", async () => {
    database = new LedgerDB(`coverage-${crypto.randomUUID()}`);
    const document = syntheticPack({ coverage: "partial" });
    document.pack.id = "pack:synthetic-partial"; document.pack.name = "Synthetic Partial";
    document.entries[0].equipmentBundles = [{ id: "bundle:missing-item", label: "Synthetic bundle", entries: [{ type: "item", itemId: "item:not-installed", quantity: 1, status: "granted" }] }];
    document.entries[0].effects.push({ id: "effect:manual", type: "manualAdjudication", reasonCode: "SYNTHETIC_REVIEW" });
    const preview = await previewContentPackSet([JSON.stringify(document)], database);
    expect(preview.canImport).toBe(false);
    expect(preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "PACK_INCOMPLETE", severity: "warning" }),
      expect.objectContaining({ code: "EFFECT_REVIEW_REQUIRED", severity: "warning" }),
      expect.objectContaining({ code: "MISSING_ITEM_REFERENCE", severity: "error" }),
    ]));
    expect(packCoveragePresentation("pilot")).toEqual(expect.objectContaining({ completeSource: false, requiresWarning: true }));
  });

  it("keeps an explicitly manual effect importable but visibly review-required", async () => {
    database = new LedgerDB(`manual-effect-${crypto.randomUUID()}`);
    const document = syntheticPack();
    document.entries[0].effects = [{ id: "effect:manual", type: "manualAdjudication", reasonCode: "SYNTHETIC_REVIEW" }];
    const preview = await previewContentPackSet([JSON.stringify(document)], database);
    expect(preview.canImport).toBe(true);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: "EFFECT_REVIEW_REQUIRED", severity: "warning", recordId: document.entries[0].id }));
  });

  it("resolves equipment references across a dependency set and imports it atomically", async () => {
    database = new LedgerDB(`equipment-set-${crypto.randomUUID()}`);
    const provider = syntheticPack();
    provider.pack.id = "pack:synthetic-items"; provider.pack.name = "Synthetic Items";
    const providerDocument = { ...provider, entries: [entry("item:synthetic-kit", "item", { itemType: "kit", rarity: "none", attunement: { required: false }, attackIds: [], resourceIds: [] })] };
    const consumer = syntheticPack();
    consumer.pack.id = "pack:synthetic-loadout"; consumer.pack.name = "Synthetic Loadout"; consumer.pack.dependencies = [provider.pack.id]; consumer.sources = [];
    consumer.entries[0].id = "rule:synthetic-loadout"; consumer.entries[0].slug = "rule-synthetic-loadout";
    consumer.entries[0].equipmentBundles = [{ id: "bundle:synthetic-loadout", label: "Synthetic loadout", entries: [{ type: "item", itemId: "item:synthetic-kit", quantity: 1, status: "equipped" }] }];
    consumer.entries[0].effects = [{ id: "effect:synthetic-loadout", type: "grantEquipmentBundle", bundleId: "bundle:synthetic-loadout" }];
    const preview = await previewContentPackSet([JSON.stringify(consumer), JSON.stringify(providerDocument)], database);
    expect(preview.canImport).toBe(true);
    await confirmImportSet(preview, database);
    await expect(database.contentPacks.count()).resolves.toBe(2);
    await expect(database.contentEntries.get("item:synthetic-kit")).resolves.toBeDefined();
  });

  it("requires explicit conflict selection and rejects policy mismatches", () => {
    const first = entry("rule:first", "rule", { kind: "synthetic", data: {} }, { conflict: { sourcePriority: 10, conflictKey: "rule:collision", resolution: "explicit-selection" } });
    const second = entry("rule:second", "rule", { kind: "synthetic", data: {} }, { conflict: { sourcePriority: 20, conflictKey: "rule:collision", resolution: "explicit-selection" } });
    expect(resolveContentRelations([first, second]).unresolvedConflicts).toEqual([{ key: "rule:collision", entryIds: ["rule:second", "rule:first"], reason: "explicit-selection-required" }]);
    expect(resolveContentRelations([first, second], { "rule:collision": second.id }).conflicts[0]?.winner.id).toBe(second.id);
    const mismatch = { ...second, conflict: { ...second.conflict, resolution: "source-priority" as const } };
    expect(resolveContentRelations([first, mismatch]).unresolvedConflicts[0]?.reason).toBe("policy-mismatch");
    const coexisting = [first, second].map(item => ({ ...item, conflict: { ...item.conflict, resolution: "coexist" as const } }));
    const coexistence = resolveContentRelations(coexisting);
    expect(coexistence.conflicts).toEqual([]);
    expect(coexistence.coexistingGroups[0]?.entries.map(item => item.id)).toEqual([second.id, first.id]);
  });
});
