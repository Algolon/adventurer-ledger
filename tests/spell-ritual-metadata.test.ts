/**
 * Ritual is typed content, not prose.
 *
 * A spell either is or is not castable as a ritual, and until now the only place
 * that fact could live was the summary line. This pins the smallest durable
 * representation of it: one optional boolean on the spell's own mechanics, with
 * an unambiguous default, that survives validate → import → persist → derive.
 *
 * It is metadata only. Nothing here casts a ritual, and nothing here should.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentEntrySchema, contentPackSchema } from "@/src/domain/content-pack";
import { spellIsRitual } from "@/src/services/spell-availability";
import { resolveDerivedCharacter } from "@/src/services/derived-resolver";
import { closeHarnesses, createHarness, expectOk, type Harness } from "@/tests/fixtures/service-harness";
import {
  SPELL_IDS,
  SPELL_PACK_ID,
  SPELL_RULESET_ID,
  spellPackV2,
  spellPackV2Json,
  spellPackV2StoredEntries,
} from "@/tests/fixtures/spell-foundation-pack";
import { tidecaller } from "@/tests/fixtures/spell-foundation-character";
import type { ContentEntry } from "@/src/domain/model";
import type { InstallResult } from "@/src/services/content-install-service";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await closeHarnesses();
});

/** One spell record as the schema accepts it, with `mechanics` under the caller's control. */
const spellRecord = (mechanics: Record<string, unknown>) => ({
  id: "spell:ritual-probe",
  slug: "ritual-probe",
  name: "Ritual probe",
  aliases: [],
  category: "spell",
  rulesEdition: "homebrew",
  sourceId: "source:ritual-probe",
  sourceLocator: { sourceId: "source:ritual-probe", page: "1", section: "Probe" },
  reviewStatus: "engine-verified",
  licenseType: "original",
  visibility: "public-original",
  prerequisites: [],
  choices: [],
  equipmentBundles: [],
  effects: [],
  links: [],
  conflict: { sourcePriority: 1, conflictKey: "spell:ritual-probe", resolution: "source-priority" },
  tags: [],
  version: "1.0.0",
  revision: 1,
  editionRelations: [],
  legacy: false,
  optional: false,
  private: false,
  exportRestricted: false,
  createdAt: "2026-08-08T08:00:00.000Z",
  updatedAt: "2026-08-08T08:00:00.000Z",
  mechanics: {
    level: 1,
    school: "abjuration",
    components: { verbal: true, somatic: true },
    castingTime: { amount: 1, unit: "action" },
    duration: { type: "instantaneous", concentration: false },
    range: { type: "touch" },
    spellListIds: ["spell-list:probe"],
    ...mechanics,
  },
});

const parsedMechanics = (mechanics: Record<string, unknown>) => {
  const parsed = contentEntrySchema.parse(spellRecord(mechanics));
  return parsed.mechanics as { ritual?: unknown };
};

describe("the schema accepts spell records written before ritual existed", () => {
  it("parses a spell that omits the field entirely", () => {
    expect(() => contentEntrySchema.parse(spellRecord({}))).not.toThrow();
  });

  it("reads an omitted field as not a ritual, so the default is unambiguous", () => {
    expect(parsedMechanics({}).ritual).toBe(false);
    expect(spellIsRitual(parsedMechanics({}))).toBe(false);
  });

  it("keeps a declared value in both directions", () => {
    expect(parsedMechanics({ ritual: true }).ritual).toBe(true);
    expect(parsedMechanics({ ritual: false }).ritual).toBe(false);
  });

  it("refuses a non-boolean rather than coercing one", () => {
    expect(() => contentEntrySchema.parse(spellRecord({ ritual: "yes" }))).toThrow();
    expect(() => contentEntrySchema.parse(spellRecord({ ritual: 1 }))).toThrow();
  });

  it("still refuses an unknown mechanics field, so the shape stays strict", () => {
    expect(() => contentEntrySchema.parse(spellRecord({ rituals: true }))).toThrow();
  });
});

describe("the whole fixture pack carries ritual through validation", () => {
  it("validates a pack whose spells mix a declared ritual with omitted ones", () => {
    expect(() => spellPackV2()).not.toThrow();
  });

  it("distinguishes the declared ritual from the spells that omit the field", () => {
    const byId = new Map(spellPackV2StoredEntries().map(item => [item.id, item]));
    expect(spellIsRitual(byId.get(SPELL_IDS.saltWard)?.mechanics)).toBe(true);
    expect(spellIsRitual(byId.get(SPELL_IDS.undertow)?.mechanics)).toBe(false);
    expect(spellIsRitual(byId.get(SPELL_IDS.tidemark)?.mechanics)).toBe(false);
  });
});

describe("ritual survives import and persistence", () => {
  it("stores the declared value and reads it back from the database", async () => {
    const preview = await harness.install.preview([spellPackV2Json()]);
    expect(preview.canImport).toBe(true);
    expectOk<InstallResult>(
      await harness.install.confirm(preview, { createRulesetForPackIds: [SPELL_PACK_ID] }),
    );

    const stored = await harness.context.repositories.content.listEntries();
    const byId = new Map(stored.map(item => [item.id, item]));
    expect(spellIsRitual(byId.get(SPELL_IDS.saltWard)?.mechanics)).toBe(true);
    expect(spellIsRitual(byId.get(SPELL_IDS.undertow)?.mechanics)).toBe(false);
  });
});

describe("the derived sheet reports ritual as a property of the spell", () => {
  it("carries the flag onto every projected spell", () => {
    const entries: ContentEntry[] = spellPackV2StoredEntries();
    const sheet = resolveDerivedCharacter({
      character: tidecaller(),
      entries,
      ruleset: undefined,
    });
    const granted = sheet.spellcasting?.spells.find(item => item.id === SPELL_IDS.tidemark);
    expect(granted).toBeDefined();
    expect(granted?.ritual).toBe(false);
  });

  it("does not hide ritual identity in the summary line", () => {
    const byId = new Map(spellPackV2StoredEntries().map(item => [item.id, item]));
    const ward = byId.get(SPELL_IDS.saltWard);
    // The fact is in the mechanics, and the prose does not have to mention it.
    expect(spellIsRitual(ward?.mechanics)).toBe(true);
    expect(ward?.summary?.toLowerCase()).not.toContain("ritual");
  });
});
