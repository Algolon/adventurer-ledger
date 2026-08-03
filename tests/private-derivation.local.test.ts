import "fake-indexeddb/auto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { Character, ContentEntry } from "@/src/domain/model";
import { confirmImportSet, previewContentPackSet } from "@/src/import/content-pipeline";
import { deriveCharacterState } from "@/src/rules/derive-character";
import { actionGrantsByKind } from "@/src/rules/engine";
import { LedgerDB } from "@/src/storage/db";

/**
 * Local-only derivation harness for a bounded private pilot. Reads the pack path from
 * the environment; contains no private data itself. Prints stable IDs and derived
 * numbers only — never fullText, summary, notes or raw imported JSON.
 */
const packPath = process.env.ADVENTURER_LEDGER_PRIVATE_PACK;
const classId = process.env.PILOT_CLASS_ID ?? "";
const subclassId = process.env.PILOT_SUBCLASS_ID ?? "";
const speciesId = process.env.PILOT_SPECIES_ID ?? "";
const backgroundId = process.env.PILOT_BACKGROUND_ID ?? "";

const out = (line: string) => process.stdout.write(`${line}\n`);
const list = (values: Iterable<string>) => [...values].sort().join(", ") || "(none)";

describe.skipIf(!packPath)("bounded private pilot derivation", () => {
  it("derives each pilot level and reports mechanical state only", async () => {
    if (!packPath) throw new Error("Private pack path was not provided");
    const database = new LedgerDB(`private-derivation-${crypto.randomUUID()}`);
    try {
      const json = await readFile(packPath, "utf8");
      const preview = await previewContentPackSet([json], database);
      out(`preview.canImport            ${preview.canImport}`);
      out(`preview.issues by code       ${JSON.stringify(preview.issues.reduce<Record<string, number>>((acc, issue) => { acc[`${issue.code}/${issue.severity}`] = (acc[`${issue.code}/${issue.severity}`] ?? 0) + 1; return acc; }, {}))}`);
      expect(preview.canImport).toBe(true);

      const transaction = vi.spyOn(database, "transaction");
      await confirmImportSet(preview, database);
      out(`confirm transaction scopes   ${transaction.mock.calls.length}`);
      expect(transaction).toHaveBeenCalledTimes(1);
      transaction.mockRestore();

      const entries: ContentEntry[] = await database.contentEntries.toArray();
      out(`installed entries            ${entries.length}\n`);

      const character = (level: number): Character => ({
        id: "character:pilot-check",
        name: "Pilot check",
        level,
        advancement: "milestone",
        classLevels: [{ classId, level, ...(level >= 3 && subclassId ? { subclassId } : {}) }],
        ...(speciesId ? { speciesId } : {}),
        ...(backgroundId ? { backgroundId } : {}),
        rulesetProfileId: "ruleset:pilot-check",
        abilities: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 10 },
        baseHitPoints: 1, currentHitPoints: 1, temporaryHitPoints: 0, exhaustion: 0,
        deathSaves: { successes: 0, failures: 0 }, selections: [], biography: {}, tags: [],
        status: "active", kind: "player-character",
        createdAt: "2026-08-03T08:00:00.000Z", updatedAt: "2026-08-03T08:00:00.000Z",
      });

      for (const level of [1, 2, 3, 4, 5]) {
        const result = deriveCharacterState({ character: character(level), entries });
        const rule = result.ruleResult;
        out(`===== LEVEL ${level} =====`);
        out(`  status                   ${result.status}`);
        out(`  issues                   ${result.issues.map(issue => `${issue.code}:${issue.recordId}`).sort().join(" | ") || "(none)"}`);
        out(`  pendingChoiceIds         ${list(result.pendingChoiceIds)}`);
        out(`  classFeatureIds          ${list(result.classFeatureIds)}`);
        out(`  identityTraitIds         ${list(result.identityTraitIds)}`);
        out(`  proficiencies            ${list(rule.context.proficiencies)}`);
        out(`  values                   ${JSON.stringify(rule.context.values)}`);
        out(`  actionGrants             ${JSON.stringify(actionGrantsByKind(rule.actionGrants))}`);
        out(`  resources                ${rule.resources.join(", ") || "(none)"}`);
        out(`  resourceMaxima           ${JSON.stringify([...rule.resourceDefinitions].map(([id, definition]) => [id, definition.maximum, definition.recharge]))}`);
        out(`  resourceRecharge         ${JSON.stringify([...rule.resourceRecharge])}`);
        out(`  equipment items          ${result.equipment.items.length} / issues ${result.equipment.issues.length}`);
        out(`  rollRules                extraDice=${rule.rollRules.extraDice.length} replace=${rule.rollRules.replacements.length} reroll=${rule.rollRules.rerolls.length} min=${rule.rollRules.minimums.length} adv=${rule.rollRules.advantages.size} dis=${rule.rollRules.disadvantages.size}`);
        out(`  grantedFeatures          ${list(rule.grantedFeatures)}`);
        out(`  optionGrants             ${JSON.stringify({ masteries: [...rule.optionGrants.weaponMasteries], styles: [...rule.optionGrants.fightingStyles] })}`);
        out(`  trace applied/total      ${rule.trace.filter(item => item.applied).length}/${rule.trace.length}`);
        out("");
      }
    } finally {
      database.close();
      await database.delete();
    }
  });
});
