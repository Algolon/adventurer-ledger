/**
 * How an import result is *read*, as opposed to how it is validated.
 *
 * The pipeline already answers the hard question truthfully: every issue it
 * raises carries a severity, and `canImport` is decided from the errors alone.
 * What was missing was a presentable shape for that answer. The import panel
 * rendered `issues.map(...)` — one paragraph per issue, every paragraph styled
 * from the danger palette — so a pack whose entries carry manually adjudicated
 * effects produced hundreds of identical red rows under a heading that said the
 * import had succeeded. The pilot could not tell a successful import from a
 * broken one, and the honest reading of that screen was that it had failed.
 *
 * This module is the presentation contract, kept pure and separate from React so
 * it can be tested directly and so the numbers on screen are derived from the
 * plan and the issue list rather than assembled by hand in a component:
 *
 * - severity is carried through, never flattened: a blocking error and an
 *   advisory notice are different kinds of thing and are labelled as such;
 * - repetition is collapsed by issue code, so the primary surface is bounded by
 *   the number of *kinds* of issue, not by the number of records;
 * - detail survives collapsing: every group keeps its affected record IDs, and
 *   says how many it is not listing.
 *
 * Nothing here suppresses an error, and nothing changes what may be imported.
 */
import type { ImportIssue, ImportIssueCode, ImportPlan } from "@/src/import/content-pipeline";

/** Affected records listed inside one group before the rest become a count. */
export const GROUP_RECORD_SAMPLE = 12;

/**
 * What a group of issues is called, and what it means for the person reading it.
 *
 * Both strings are written for a user, and neither may contain imported text: a
 * group is identified by its code and its records by their stable IDs.
 */
interface IssueCopy {
  readonly label: string;
  readonly explanation: string;
}

const ISSUE_COPY: Record<ImportIssueCode, IssueCopy> = {
  FILE_TOO_LARGE: {
    label: "File too large",
    explanation: "The file is above the import size limit and was not read.",
  },
  INVALID_JSON: {
    label: "File could not be read",
    explanation: "The file is not valid JSON, so nothing in it could be checked.",
  },
  SCHEMA_INVALID: {
    label: "Content does not match the pack schema",
    explanation: "Some records are missing required fields or use unsupported values.",
  },
  SCHEMA_UNSUPPORTED: {
    label: "Unsupported schema version",
    explanation: "This file was written for a pack format this version cannot read.",
  },
  MIGRATION_APPLIED: {
    label: "Older format upgraded on the way in",
    explanation: "The file was written in an earlier pack format and was upgraded for you. Nothing needs doing.",
  },
  PACK_INCOMPLETE: {
    label: "Pack coverage does not match its contents",
    explanation: "The pack declares that it is not a complete source. It imports; expect gaps in what it can build.",
  },
  DUPLICATE_ID: {
    label: "Duplicate identifiers",
    explanation: "The same identifier appears more than once, so the records cannot be told apart.",
  },
  PACK_VERSION_CONFLICT: {
    label: "Version conflict",
    explanation: "The installed pack is at a version this file does not supersede. Your installed content is kept.",
  },
  ENTRY_REVISION_CONFLICT: {
    label: "Installed records are newer",
    explanation:
      "Some installed entries are at a higher revision than the ones in this file. Your installed content is kept.",
  },
  MISSING_SOURCE: {
    label: "Missing source",
    explanation: "An entry names a source that is neither in this file nor installed.",
  },
  MISSING_DEPENDENCY: {
    label: "Missing required dependency",
    explanation: "This pack requires another pack that is neither in this file nor installed.",
  },
  OPTIONAL_DEPENDENCY_MISSING: {
    label: "Optional dependency not available",
    explanation:
      "An optional companion pack is not installed. The import is unaffected; some content simply stays unreached.",
  },
  MISSING_REFERENCE: {
    label: "Unresolved reference",
    explanation: "An entry points at another entry that is neither in this file nor installed.",
  },
  ALIAS_CONFLICT: {
    label: "Alias used by more than one entry",
    explanation: "Two entries answer to the same alias. Both import; searching by that alias may find either.",
  },
  REPLACEMENT_INVALID: {
    label: "Unresolved replacement or edition link",
    explanation: "An entry claims to replace or correspond to a record that cannot be found.",
  },
  DEPENDENCY_CYCLE: {
    label: "Dependency cycle",
    explanation: "These packs require each other in a loop, so no install order exists.",
  },
  MISSING_ITEM_REFERENCE: {
    label: "Unresolved equipment item",
    explanation: "An equipment bundle names an item that is neither in this file nor installed.",
  },
  MISSING_EQUIPMENT_BUNDLE: {
    label: "Unresolved equipment bundle",
    explanation: "An entry names an equipment bundle that is neither in this file nor installed.",
  },
  EFFECT_REVIEW_REQUIRED: {
    label: "Needs a ruling at the table",
    explanation:
      "These entries carry effects the rules engine deliberately does not apply on its own. They import and work normally; you decide their outcome in play. Nothing is required of you now.",
  },
  CONFLICT_POLICY_MISMATCH: {
    label: "Inconsistent conflict policy",
    explanation: "Entries in one conflict group disagree about how a clash between them should be resolved.",
  },
  CONFLICT_REVIEW_REQUIRED: {
    label: "You choose between overlapping entries",
    explanation:
      "These entries deliberately overlap and are resolved by explicit selection. They import; you pick which applies when it comes up.",
  },
};

/** The presentable copy for one issue code. */
export const importIssueCopy = (code: ImportIssueCode): IssueCopy => ISSUE_COPY[code];

export interface ImportIssueGroup {
  readonly code: ImportIssueCode;
  readonly severity: ImportIssue["severity"];
  readonly label: string;
  readonly explanation: string;
  /** How many issues of this code the import produced. */
  readonly count: number;
  /** Distinct records this group touches, in the order the pipeline reported them. */
  readonly recordIds: readonly string[];
  /** The prefix of `recordIds` a bounded detail view may render. */
  readonly listedRecordIds: readonly string[];
  /** Distinct records beyond `listedRecordIds`, reported as a number. */
  readonly hiddenRecordCount: number;
  /**
   * The pipeline's own sentences, deduplicated and bounded.
   *
   * Grouping must not cost the diagnosis. A version refusal says "version 1.0.0
   * is older than the installed version 2.0.0" and a revision conflict names
   * both revisions; a label and a record ID cannot reconstruct either. These are
   * the same sanitized messages the panel always rendered — stable IDs, field
   * paths and declared version numbers, never imported text — carried into the
   * disclosure rather than up the page.
   */
  readonly listedMessages: readonly string[];
  /** Distinct messages beyond `listedMessages`, reported as a number. */
  readonly hiddenMessageCount: number;
}

export interface ImportIssueSummary {
  readonly errorCount: number;
  readonly warningCount: number;
  /** Groups that stop the import. */
  readonly blocking: readonly ImportIssueGroup[];
  /** Groups that do not stop the import and want reading, not repair. */
  readonly advisory: readonly ImportIssueGroup[];
  /** Blocking groups first, then advisory; both largest first. */
  readonly groups: readonly ImportIssueGroup[];
}

/**
 * Collapses an issue list into one group per code.
 *
 * Order is deliberate and stable: blocking before advisory, then by descending
 * count, then by code. A user scanning the result meets the things that stopped
 * the import before the things that merely want reading, and two runs of the
 * same file produce the same screen.
 */
export function summariseImportIssues(issues: readonly ImportIssue[]): ImportIssueSummary {
  const byCode = new Map<
    ImportIssueCode,
    {
      severity: ImportIssue["severity"];
      count: number;
      recordIds: string[];
      seen: Set<string>;
      messages: string[];
      seenMessages: Set<string>;
    }
  >();
  for (const issue of issues) {
    const existing = byCode.get(issue.code) ?? {
      severity: issue.severity,
      count: 0,
      recordIds: [],
      seen: new Set<string>(),
      messages: [],
      seenMessages: new Set<string>(),
    };
    existing.count += 1;
    // One code is raised at one severity by the pipeline; if that ever stopped
    // being true, the stricter reading is the safe one to present.
    if (issue.severity === "error") existing.severity = "error";
    const recordId = issue.recordId ?? issue.targetId;
    if (recordId && !existing.seen.has(recordId)) {
      existing.seen.add(recordId);
      existing.recordIds.push(recordId);
    }
    if (!existing.seenMessages.has(issue.message)) {
      existing.seenMessages.add(issue.message);
      existing.messages.push(issue.message);
    }
    byCode.set(issue.code, existing);
  }

  const groups = [...byCode.entries()]
    .map<ImportIssueGroup>(([code, value]) => ({
      code,
      severity: value.severity,
      label: ISSUE_COPY[code].label,
      explanation: ISSUE_COPY[code].explanation,
      count: value.count,
      recordIds: value.recordIds,
      listedRecordIds: value.recordIds.slice(0, GROUP_RECORD_SAMPLE),
      hiddenRecordCount: Math.max(0, value.recordIds.length - GROUP_RECORD_SAMPLE),
      listedMessages: value.messages.slice(0, GROUP_RECORD_SAMPLE),
      hiddenMessageCount: Math.max(0, value.messages.length - GROUP_RECORD_SAMPLE),
    }))
    .sort((left, right) => {
      if (left.severity !== right.severity) return left.severity === "error" ? -1 : 1;
      if (left.count !== right.count) return right.count - left.count;
      return left.code.localeCompare(right.code);
    });

  return {
    errorCount: issues.filter(issue => issue.severity === "error").length,
    warningCount: issues.filter(issue => issue.severity === "warning").length,
    blocking: groups.filter(group => group.severity === "error"),
    advisory: groups.filter(group => group.severity === "warning"),
    groups,
  };
}

export interface ImportCounts {
  readonly added: number;
  readonly updated: number;
  readonly unchanged: number;
  /** Entries the file described, whatever became of them. */
  readonly processed: number;
  readonly sourcesAdded: number;
  readonly sourcesUpdated: number;
  readonly packsAdded: number;
  readonly packsUpdated: number;
}

export function countsFromPlan(plan: ImportPlan): ImportCounts {
  const added = plan.entries.add.length,
    updated = plan.entries.update.length,
    unchanged = plan.entries.unchanged.length;
  return {
    added,
    updated,
    unchanged,
    processed: added + updated + unchanged,
    sourcesAdded: plan.sources.add.length,
    sourcesUpdated: plan.sources.update.length,
    packsAdded: plan.packs.add.length,
    packsUpdated: plan.packs.update.length,
  };
}

/**
 * Whether the import worked, in the three shapes a person actually cares about.
 *
 * `review` is neither of the other two and must not be presented as either: the
 * content is installed and usable, and something in it wants a human decision
 * later. Collapsing it into `failure` is the pilot defect; collapsing it into
 * `success` would hide the one thing worth saying.
 */
export type ImportOutcomeTone = "success" | "review" | "failure";

export interface ImportOutcomeSummary {
  readonly tone: ImportOutcomeTone;
  /** The first line, and the only line most imports need. */
  readonly headline: string;
  /** One sentence saying whether anything is required of the user. */
  readonly detail: string;
  readonly counts: ImportCounts;
  readonly issues: ImportIssueSummary;
  /**
   * The single sentence a screen reader is given. Counts are spelled out here
   * because the visual summary conveys them through a row of small numbers.
   */
  readonly announcement: string;
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`;

/**
 * The result of an import that was applied, or of one that was refused.
 *
 * `applied` is the caller's fact, not something to be inferred from the issue
 * list: a set can be refused with no error issue at all (an older file, or one
 * already installed), and a set can be applied with hundreds of warnings.
 */
export function summariseImportOutcome(input: {
  readonly plan: ImportPlan;
  readonly issues: readonly ImportIssue[];
  readonly applied: boolean;
}): ImportOutcomeSummary {
  const counts = countsFromPlan(input.plan);
  const issues = summariseImportIssues(input.issues);
  const written = counts.added + counts.updated;

  if (!input.applied) {
    const headline = "Import not applied";
    const detail = issues.errorCount
      ? `Nothing was written. ${plural(issues.errorCount, "problem")} in ${plural(
          issues.blocking.length,
          "category",
        )} stopped it, and your installed content is unchanged.`
      : "Nothing was written, and your installed content is unchanged.";
    return { tone: "failure", headline, detail, counts, issues, announcement: `${headline}. ${detail}` };
  }

  const changed = written
    ? `${plural(counts.added, "entry", "entries")} added, ${counts.updated} updated`
    : "no entries changed";
  const unchanged = counts.unchanged ? `, ${counts.unchanged} already installed and left as they are` : "";

  if (issues.warningCount) {
    const headline = "Import completed — some entries need review";
    const detail = `${plural(issues.warningCount, "notice")} across ${plural(
      issues.advisory.length,
      "category",
    )}. None of them blocked the import, and all of this content is installed and usable.`;
    return {
      tone: "review",
      headline,
      detail,
      counts,
      issues,
      announcement: `${headline}. ${plural(
        counts.processed,
        "entry",
        "entries",
      )} processed, ${changed}${unchanged}. No errors, ${plural(issues.warningCount, "item")} to review.`,
    };
  }

  const headline = "Import completed";
  const detail = "Everything in this file was applied. Nothing needs your attention.";
  return {
    tone: "success",
    headline,
    detail,
    counts,
    issues,
    announcement: `${headline}. ${plural(
      counts.processed,
      "entry",
      "entries",
    )} processed, ${changed}${unchanged}. No errors and nothing to review.`,
  };
}
