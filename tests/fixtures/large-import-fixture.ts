/**
 * A large, wholly original synthetic pack built to reproduce the pilot's import
 * experience — and nothing else.
 *
 * The pilot imported a substantial pack and met a vertical wall of
 * `EFFECT_REVIEW_REQUIRED` rows, every one of them styled like an error, under a
 * result that gave no answer to "did this work?". That failure mode needs three
 * things at once: a lot of entries, a lot of *repeated* non-blocking review
 * notices, and — on a second import — at least one genuine update. This fixture
 * supplies exactly those, from invented material.
 *
 * It deliberately borrows no structure from any published book: the entries are
 * numbered drill rules for an imaginary observatory, with no classes, spells,
 * species or progression, so it exercises the import surface without modelling
 * anyone's content.
 */
import type { ContentPackDocument } from "@/src/domain/content-pack";
import type { Effect } from "@/src/domain/model";

/** The entry shape the pack *document* declares, which is what a file carries. */
type DocumentEntry = ContentPackDocument["entries"][number];

const STAMP = "2026-08-09T09:00:00.000Z";

export const LARGE_PACK_ID = "pack:lantern-observatory";
export const LARGE_PACK_NAME = "Lantern Observatory Drills";
export const LARGE_SOURCE_ID = "source:lantern-observatory";

export interface LargeImportOptions {
  /** Total entries in the document. */
  readonly entryCount?: number;
  /** How many of them carry a manually adjudicated effect. */
  readonly reviewCount?: number;
  /** How many pairs of entries share an alias, raising a second warning code. */
  readonly aliasConflictCount?: number;
  readonly packVersion?: string;
  /** Entry revision, so a second import can be a genuine update. */
  readonly revision?: number;
  /**
   * Adds one entry with a required link to a record that is neither in the file
   * nor installed, which is a blocking error. Off by default: the pilot's
   * problem was a *successful* import that looked broken.
   */
  readonly withBlockingError?: boolean;
}

/** The document form of a source: no audit stamps, which the install writes. */
const source = (): ContentPackDocument["sources"][number] => ({
  id: LARGE_SOURCE_ID,
  name: "Lantern Observatory Handbook",
  abbreviation: "LOH",
  edition: "homebrew",
  type: "homebrew",
  licenseType: "original",
  visibility: "private",
  priority: 20,
  enabledByDefault: true,
  campaignIds: [],
  version: "1.0.0",
});

const reviewEffect = (index: number): Effect => ({
  id: `effect:lantern-drill-${index}-adjudication`,
  type: "manualAdjudication",
  reasonCode: "TABLE_RULING_REQUIRED",
});

const automaticEffect = (index: number): Effect => ({
  id: `effect:lantern-drill-${index}-focus`,
  type: "addAdvantage",
  target: "lantern-observation",
});

type EntryShape = Required<Pick<LargeImportOptions, "reviewCount" | "aliasConflictCount" | "packVersion" | "revision">>;

function entry(index: number, options: EntryShape): DocumentEntry {
  const needsReview = index < options.reviewCount;
  /*
   * Alias sharing is paired: both entries of a pair answer to the same alias,
   * which is what the pipeline reports as ALIAS_CONFLICT. It exists so the
   * fixture produces more than one *kind* of advisory, and grouping therefore
   * has something to group by.
   */
  const aliasPair = Math.floor(index / 2);
  const sharesAlias = aliasPair < options.aliasConflictCount;
  return {
    id: `rule:lantern-drill-${index}`,
    slug: `lantern-drill-${index}`,
    name: `Lantern Drill ${index}`,
    aliases: sharesAlias ? [`shared-drill-${aliasPair}`] : [],
    category: "rule",
    rulesEdition: "homebrew",
    sourceId: LARGE_SOURCE_ID,
    sourceLocator: { sourceId: LARGE_SOURCE_ID, page: String(index + 1), section: "Drills" },
    reviewStatus: "engine-verified",
    licenseType: "original",
    visibility: "private-user-entered",
    fullText: `Drill ${index}: the watch raises a lantern, counts to ${index % 9}, and lowers it again.`,
    summary: `Invented observatory drill number ${index}.`,
    prerequisites: [],
    choices: [],
    equipmentBundles: [],
    effects: [needsReview ? reviewEffect(index) : automaticEffect(index)],
    links: [],
    mechanics: { kind: "observatory-drill", data: { order: index } },
    conflict: { sourcePriority: 20, conflictKey: `rule:lantern-drill-${index}`, resolution: "source-priority" },
    tags: ["synthetic", "lantern"],
    version: options.packVersion,
    revision: options.revision,
    editionRelations: [],
    legacy: false,
    optional: true,
    private: true,
    exportRestricted: false,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

/** The entry that makes the set unimportable, used only by the blocking case. */
function brokenEntry(options: Pick<EntryShape, "packVersion" | "revision">): DocumentEntry {
  const base = entry(0, { reviewCount: 0, aliasConflictCount: 0, ...options });
  return {
    ...base,
    id: "rule:lantern-drill-broken",
    slug: "lantern-drill-broken",
    name: "Lantern Drill Without Its Partner",
    conflict: { sourcePriority: 20, conflictKey: "rule:lantern-drill-broken", resolution: "source-priority" },
    effects: [],
    links: [{ type: "feature", targetId: "rule:lantern-drill-absent", required: true }],
  };
}

export function largeImportDocument(options: LargeImportOptions = {}): ContentPackDocument {
  const entryCount = options.entryCount ?? 600,
    reviewCount = options.reviewCount ?? 480,
    aliasConflictCount = options.aliasConflictCount ?? 6,
    packVersion = options.packVersion ?? "1.0.0",
    revision = options.revision ?? 1;
  const shape: EntryShape = { reviewCount, aliasConflictCount, packVersion, revision };
  const entries = Array.from({ length: entryCount }, (_, index) => entry(index, shape));
  if (options.withBlockingError) entries.push(brokenEntry({ packVersion, revision }));
  return {
    schemaVersion: 2,
    pack: {
      id: LARGE_PACK_ID,
      name: LARGE_PACK_NAME,
      description: "Original synthetic drills used to exercise large-import presentation.",
      version: packVersion,
      coverage: "complete",
      rulesEditions: ["homebrew"],
      visibility: "private",
      licenseType: "original",
      exportRestricted: false,
      includeFullText: true,
      dependencies: [],
      optionalDependencies: [],
    },
    sources: [source()],
    entries,
  };
}

export const largeImportJson = (options: LargeImportOptions = {}) => JSON.stringify(largeImportDocument(options));

/**
 * The same pack one version on: one entry revised, everything else restated.
 *
 * Everything but the first entry is restated byte-for-byte at the revision it
 * was installed at. That is what makes those `unchanged` rather than a revision
 * reuse: the revision is how a pack says a record changed, so restating an
 * altered record under the same one is a conflict, and this fixture is meant to
 * be the ordinary additive case.
 */
export function largeImportUpdateJson(options: LargeImportOptions = {}) {
  const document = largeImportDocument(options);
  const [first, ...rest] = document.entries;
  return JSON.stringify({
    ...document,
    pack: { ...document.pack, version: "1.1.0" },
    entries: [{ ...first, name: `${first.name} (revised)`, revision: (options.revision ?? 1) + 1 }, ...rest],
  });
}
