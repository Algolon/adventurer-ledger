import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import { validateContentPackJson } from "@/src/import/validate-pack";
import { LedgerDB } from "@/src/storage/db";
import { resolveContentRelations } from "@/src/domain/resolve-content";
import { deriveCharacterState } from "@/src/rules/derive-character";
import type { Character, ChoiceDefinition, EquipmentBundleNode } from "@/src/domain/model";

const privatePackPath = process.env.ADVENTURER_LEDGER_PRIVATE_PACK;
const database = new LedgerDB(`private-local-${crypto.randomUUID()}`);
afterAll(async () => { database.close(); await database.delete(); });
describe.skipIf(!privatePackPath)("local private ingestion", () => {
  it("passes the production validator, preview and importer without printing content", async () => {
    if (!privatePackPath) throw new Error("Private pack path was not provided");
    const json = await readFile(privatePackPath, "utf8"), validation = validateContentPackJson(json);
    expect(validation.success).toBe(true);
    expect(validation.data?.pack).toMatchObject({ id: "private-phb-2024-brammel-pilot", coverage: "pilot" });
    const preview = await previewContentPackSet([json], database);
    expect(preview.canImport).toBe(true);
    expect(preview.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["PACK_INCOMPLETE", "OPTIONAL_DEPENDENCY_MISSING"]));
    expect(preview.issues.filter(issue => issue.code === "EFFECT_REVIEW_REQUIRED")).toEqual([]);
    await confirmImportSet(preview, database);
    expect(await database.contentEntries.count()).toBe(validation.data?.entries.length);
    const relations = resolveContentRelations(await database.contentEntries.toArray());
    expect(relations.missingRequired).toEqual([]);
    expect(relations.unresolvedConflicts).toEqual([]);
    const repeated = await previewContentPackSet([json], database);
    expect(repeated.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(["PACK_VERSION_CONFLICT", "ENTRY_REVISION_CONFLICT"]));
  });
  it("derives the bounded level-five pilot without unexplained effects", async () => {
    if (!privatePackPath) throw new Error("Private pack path was not provided");
    const validation = validateContentPackJson(await readFile(privatePackPath, "utf8"));
    if (!validation.data) throw new Error("Private pack did not pass validation");
    const classEntry = validation.data.entries.find(entry => entry.category === "class");
    if (!classEntry) throw new Error("Pilot class entry is unavailable");
    const subclassEntry = validation.data.entries.find(entry => entry.category === "subclass" && entry.mechanics.classId === classEntry.id);
    const speciesEntry = validation.data.entries.find(entry => entry.category === "species");
    const backgroundEntry = validation.data.entries.find(entry => entry.category === "background");
    const choiceSelections: Record<string, string[]> = {};
    const selectChoice = (choice: ChoiceDefinition) => {
      const selected = choice.options.slice(0, choice.min);
      choiceSelections[choice.id] = selected.map(option => option.id);
      for (const option of selected) for (const child of option.childChoices ?? []) selectChoice(child);
      for (const child of choice.childChoices ?? []) selectChoice(child);
    };
    for (const entry of validation.data.entries) for (const choice of entry.choices) selectChoice(choice);
    const equipmentSelections: Record<string, string[]> = {};
    const selectEquipment = (node: EquipmentBundleNode) => {
      if (node.type === "bundle") for (const child of node.entries) selectEquipment(child);
      if (node.type === "choice") {
        const selected = node.options.slice(0, node.min);
        equipmentSelections[node.id] = selected.map(option => option.id);
        for (const option of selected) for (const child of option.entries) selectEquipment(child);
      }
    };
    for (const entry of validation.data.entries) for (const bundle of entry.equipmentBundles) for (const node of bundle.entries) selectEquipment(node);
    const stamp = "2026-08-03T08:00:00.000Z";
    const character: Character = {
      id: "character:local-pilot-check", name: "Local pilot check", level: 5, advancement: "milestone",
      classLevels: [{ classId: classEntry.id, subclassId: subclassEntry?.id, level: 5 }], speciesId: speciesEntry?.id, backgroundId: backgroundEntry?.id,
      rulesetProfileId: "ruleset:local-pilot-check", abilities: { strength: 15, dexterity: 15, constitution: 15, intelligence: 15, wisdom: 15, charisma: 15 },
      baseHitPoints: 1, currentHitPoints: 1, temporaryHitPoints: 0, exhaustion: 0, deathSaves: { successes: 0, failures: 0 }, selections: [], biography: {}, tags: [], status: "active", kind: "player-character", createdAt: stamp, updatedAt: stamp,
    };
    const result = deriveCharacterState({ character, entries: validation.data.entries, choiceSelections, equipmentSelections });
    expect(result.issues.filter(issue => issue.code === "EFFECT_FAILED" || issue.code === "EFFECT_REVIEW_REQUIRED")).toEqual([]);
    expect(result.ruleResult.trace.every(trace => trace.disposition === "automatic" || trace.disposition === "choice-driven" || trace.disposition === "manual-adjudication")).toBe(true);
    expect(result.classFeatureIds.size).toBeGreaterThan(0);
  });
});
