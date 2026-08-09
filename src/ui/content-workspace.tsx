"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Download,
  FileCheck2,
  FolderLock,
  Import,
  Info,
  OctagonAlert,
  Save,
  Trash2,
} from "lucide-react";
import type {
  ContentEntry,
  ContentPack,
  Effect,
  Source,
} from "@/src/domain/model";
import { packCoveragePresentation } from "@/src/domain/pack-coverage";
import { effectSchema } from "@/src/domain/content-pack";
import { savePackEntry } from "@/src/content/save-pack-entry";
import {
  describePackRemoval,
  describeSourceRemoval,
  describeSourceSaveFailure,
  validateSourceForm,
  type SourceField,
  type SourceSaveProblem,
} from "@/src/content/source-management";
import {
  createContentExport,
  RestrictedExportConfirmationError,
} from "@/src/export/content-export";
import {
  summariseImportIssues,
  summariseImportOutcome,
  type ImportIssueSummary,
  type ImportOutcomeSummary,
} from "@/src/import/issue-presentation";
import type { InstallPreview, InstallVerdict } from "@/src/services/content-install-service";
import { useAsync, useServices } from "@/src/ui/services-context";
import { db } from "@/src/storage/db";
import { isContentOperationError } from "@/src/storage/content-operation-error";
import {
  ContentEntryRepository,
  ContentPackRepository,
  SourceRepository,
} from "@/src/storage/content-repositories";

const sources = new SourceRepository(db),
  packs = new ContentPackRepository(db),
  entries = new ContentEntryRepository(db);
const now = () => new Date().toISOString();
/**
 * The last resort, and only that.
 *
 * It used to be the first and only answer to every failure in this file. A
 * refusal that knows its own reason now says it — see `describeSourceSaveFailure`
 * — and this remains for the genuinely unclassified case, where the honest thing
 * to report is that the write did not happen.
 */
const safeMessage = (error: unknown) =>
  error instanceof RestrictedExportConfirmationError
    ? error.message
    : isContentOperationError(error)
      ? describeSourceSaveFailure(error).message
      : "The operation could not be completed. Check IDs, versions, and required fields.";

/**
 * Severity, said in words as well as in colour.
 *
 * WCAG aside, the pilot's screen is the argument: every issue row carried the
 * danger border, so colour was carrying the entire distinction and carrying it
 * wrongly. A badge that reads "Blocking" or "Review" survives being greyscale,
 * being read aloud, and being skimmed.
 */
function SeverityBadge({ severity }: { severity: "error" | "warning" }) {
  return severity === "error" ? (
    <span className="issuebadge blocking">
      <OctagonAlert aria-hidden="true" />
      Blocking
    </span>
  ) : (
    <span className="issuebadge advisory">
      <Info aria-hidden="true" />
      Review
    </span>
  );
}

/**
 * Every issue the import raised, one row per *kind*.
 *
 * This is the fix for the wall of text. A pack with 480 manually adjudicated
 * effects produced 480 rows; it now produces one, which says 480 and opens on
 * demand. Blocking groups start open because they are the reason nothing was
 * written; advisories start closed because nothing is being asked of the user.
 * Nothing is dropped: each group keeps its affected records, names how many it
 * is not listing, and still shows its machine code for reporting.
 */
function ImportIssueGroups({ summary }: { summary: ImportIssueSummary }) {
  if (!summary.groups.length) return null;
  return (
    <div className="issuegroups">
      {summary.groups.map(group => (
        <details
          className={`issuegroup ${group.severity === "error" ? "blocking" : "advisory"}`}
          key={group.code}
          open={group.severity === "error"}
        >
          <summary>
            <SeverityBadge severity={group.severity} />
            <span className="issuegroup-label">{group.label}</span>
            <span className="issuegroup-count">{group.count}</span>
          </summary>
          <p>{group.explanation}</p>
          {group.listedMessages.length ? (
            <>
              <p className="m2-muted issuegroup-recordhead">
                {group.recordIds.length === 1 ? "Affected record" : `Affected records (${group.recordIds.length})`}
              </p>
              {/*
               * The pipeline's own sentences, which is where the diagnosis
               * lives: a version refusal names both versions, a revision
               * conflict names both revisions, and a label cannot say either.
               * Grouping moves them behind a disclosure; it does not discard
               * them.
               */}
              <ul className="issuegroup-records">
                {group.listedMessages.map(message => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              {group.hiddenMessageCount ? (
                <p className="m2-muted">and {group.hiddenMessageCount} more of the same kind</p>
              ) : null}
            </>
          ) : null}
          <p className="m2-muted issuegroup-code">{group.code}</p>
        </details>
      ))}
    </div>
  );
}

/**
 * One number and what it counts.
 *
 * Tone rides on a data attribute rather than a second class, so the class name
 * stays a literal in the markup — which is what the stylesheet audit reads to
 * prove no rule here has gone unreachable — and so a test can assert the tone
 * without asserting a class list.
 */
function CountCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "blocking" | "advisory";
}) {
  return (
    <div className="countcell" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * What the import did, answered before anything is asked of the reader.
 *
 * Outcome, then the numbers, then detail on demand. The old panel had this
 * exactly inverted: the detail was the page, and the outcome was a sentence
 * somewhere under it.
 */
function ImportResult({ outcome }: { outcome: ImportOutcomeSummary }) {
  const Icon = outcome.tone === "failure" ? OctagonAlert : outcome.tone === "review" ? Info : CheckCircle2;
  return (
    <section className="importresult" data-tone={outcome.tone} aria-labelledby="import-result-headline">
      <h4 id="import-result-headline">
        <Icon aria-hidden="true" />
        {outcome.headline}
      </h4>
      <p>{outcome.detail}</p>
      <dl className="countgrid">
        <CountCell label="Added" value={outcome.counts.added} />
        <CountCell label="Updated" value={outcome.counts.updated} />
        <CountCell label="Unchanged" value={outcome.counts.unchanged} />
        <CountCell label="Errors" value={outcome.issues.errorCount} tone="blocking" />
        <CountCell label="Need review" value={outcome.issues.warningCount} tone="advisory" />
      </dl>
      <ImportIssueGroups summary={outcome.issues} />
    </section>
  );
}

export function ContentWorkspace({ view }: { view: string }) {
  if (view === "Sources") return <SourcesPanel />;
  if (view === "Content packs") return <PackEditor />;
  if (view === "Imports & exports") return <ImportExportPanel />;
  if (view === "Compendium") return <Compendium />;
  return null;
}
function PageIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="intro">
      <span>
        <Archive />
      </span>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </div>
  );
}
function Boundary() {
  return (
    <div className="boundary">
      <FolderLock />
      <p>
        <b>Private-content boundary.</b> Private text remains in IndexedDB and
        is never included in diagnostics.
      </p>
    </div>
  );
}

function SourcesPanel() {
  /*
   * One invalidation contract.
   *
   * This panel used to hold its own list and its own private `refresh`, which
   * shadowed the service-wide one. Content installed anywhere else therefore
   * left it showing yesterday's answer until it happened to remount, and each
   * screen had to be re-derived by hand. Reading through `useAsync` puts it on
   * the same revision every other reader uses, so one `refresh()` after a write
   * updates all of them at once.
   */
  const { refresh } = useServices();
  const listState = useAsync(() => sources.list(), []);
  const list = listState.status === "ready" ? listState.value : [];
  const [editing, setEditing] = useState<string>(),
    [message, setMessage] = useState(""),
    /**
     * The reason a save was refused, and which control owns it.
     *
     * Held as a value rather than a sentence so the message can be printed
     * beside its own field and referenced by `aria-describedby`, instead of
     * being one unattached line at the bottom of the form.
     */
    [problem, setProblem] = useState<SourceSaveProblem>(),
    /** The row a removal is being confirmed for, with what removal would mean. */
    [removing, setRemoving] = useState<{ source: Source; removal: ReturnType<typeof describeSourceRemoval> }>();
  const [form, setForm] = useState({
    id: "source:synthetic-local",
    name: "Synthetic local source",
    abbreviation: "SYN",
    version: "1.0.0",
  });
  /** True when this field is the one the current refusal is about. */
  const faulted = (field: SourceField) => problem?.field === field;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    setProblem(undefined);
    /*
     * Checked against installed state before the write, so the overwhelmingly
     * likely failure — pressing Save again on the ID this form just saved and
     * then restored as its default — is named as a collision on the ID field
     * rather than surfacing as an unexplained persistence error.
     */
    const check = validateSourceForm(form, {
      mode: editing ? "edit" : "create",
      existingIds: list.map(source => source.id),
    });
    if (!check.ok) {
      setProblem(check.problem);
      return;
    }
    try {
      if (editing)
        await sources.update(editing, {
          name: form.name,
          abbreviation: form.abbreviation,
          version: form.version,
        });
      else {
        const stamp = now();
        await sources.create({
          ...form,
          edition: "homebrew",
          type: "homebrew",
          licenseType: "original",
          visibility: "private",
          priority: 100,
          enabledByDefault: true,
          campaignIds: [],
          createdAt: stamp,
          updatedAt: stamp,
        });
      }
      setEditing(undefined);
      setForm({
        id: "source:synthetic-local",
        name: "Synthetic local source",
        abbreviation: "SYN",
        version: "1.0.0",
      });
      setMessage("Source saved locally.");
      refresh();
    } catch (error) {
      // A refusal that reached the database still knows why; it is no longer
      // flattened into one sentence on the way back out.
      setProblem(describeSourceSaveFailure(error));
    }
  };
  /**
   * What removing this source would do, read before anything is offered.
   *
   * The dependency count comes from the same query the deletion refuses on, so
   * "cannot be removed" and "can be removed" are decided by one fact, and the
   * user is told which of the two they are looking at before they confirm.
   */
  const askToRemove = async (source: Source) => {
    setMessage("");
    setProblem(undefined);
    const referencingEntryCount = await sources.dependentEntryCount(source.id);
    setRemoving({ source, removal: describeSourceRemoval({ sourceName: source.name, sourceId: source.id, referencingEntryCount }) });
  };
  const confirmRemove = async () => {
    if (!removing || removing.removal.kind !== "removable") return;
    try {
      await sources.delete(removing.source.id);
      setMessage(`${removing.source.name} was removed from this device.`);
      setRemoving(undefined);
      refresh();
    } catch (error) {
      setProblem(describeSourceSaveFailure(error));
      setRemoving(undefined);
    }
  };
  return (
    <section className="page">
      <PageIntro eyebrow="Provenance first" title="Source management">
        Create, edit, and remove local source metadata without mixing content
        boundaries.
      </PageIntro>
      <form className="card editor" onSubmit={submit}>
        <h3>{editing ? "Edit source" : "New source"}</h3>
        <label>
          Stable ID
          <input
            value={form.id}
            disabled={Boolean(editing)}
            onChange={(event) => setForm({ ...form, id: event.target.value })}
            aria-invalid={faulted("id") || undefined}
            aria-describedby={faulted("id") ? "source-problem" : undefined}
            required
          />
        </label>
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            aria-invalid={faulted("name") || undefined}
            aria-describedby={faulted("name") ? "source-problem" : undefined}
            required
          />
        </label>
        <div className="formrow">
          <label>
            Abbreviation
            <input
              value={form.abbreviation}
              onChange={(event) =>
                setForm({ ...form, abbreviation: event.target.value })
              }
              aria-invalid={faulted("abbreviation") || undefined}
              aria-describedby={faulted("abbreviation") ? "source-problem" : undefined}
              required
            />
          </label>
          <label>
            Version
            <input
              value={form.version}
              onChange={(event) =>
                setForm({ ...form, version: event.target.value })
              }
              aria-invalid={faulted("version") || undefined}
              aria-describedby={faulted("version") ? "source-problem" : undefined}
              required
            />
          </label>
        </div>
        <button className="btn primary" type="submit">
          <Save />
          Save source
        </button>
        {/*
         * The reason, next to the control that owns it. It is a live region
         * because it appears in response to a press, and it is announced as an
         * alert because it is the answer to that press.
         */}
        {problem && (
          <p role="alert" id="source-problem" className="formproblem">
            <OctagonAlert aria-hidden="true" />
            {problem.message}
          </p>
        )}
        {message && (
          <p role="status" className="formmessage">
            {message}
          </p>
        )}
      </form>
      <div className="card registry">
        <h3>Local sources</h3>
        {list.length === 0 ? (
          <p>No sources yet.</p>
        ) : (
          list.map((source) => (
            <div className="registryrow" key={source.id}>
              <span>
                <b>{source.name}</b>
                <small>
                  {source.id} · {source.version}
                </small>
              </span>
              <button
                className="btn secondary"
                onClick={() => {
                  setEditing(source.id);
                  setProblem(undefined);
                  setForm({
                    id: source.id,
                    name: source.name,
                    abbreviation: source.abbreviation,
                    version: source.version,
                  });
                }}
              >
                Edit
              </button>
              {/*
               * Removal asks first. The row control is a request to *see* what
               * removal means, not the removal itself, so the destructive act
               * is always preceded by the sentence describing it.
               */}
              <button
                className="icon danger"
                aria-label={`Remove ${source.name}`}
                onClick={() => void askToRemove(source)}
              >
                <Trash2 />
              </button>
            </div>
          ))
        )}
      </div>
      {removing && (
        <div className="card removalconfirm" role="dialog" aria-modal="false" aria-labelledby="source-removal-title">
          <h3 id="source-removal-title">{removing.removal.title}</h3>
          <p>{removing.removal.explanation}</p>
          <div className="actions">
            {removing.removal.kind === "removable" ? (
              <button className="btn danger" onClick={confirmRemove}>
                <Trash2 />
                Remove this source
              </button>
            ) : null}
            <button className="btn secondary" onClick={() => setRemoving(undefined)}>
              {removing.removal.kind === "removable" ? "Keep it" : "Close"}
            </button>
          </div>
        </div>
      )}
      <Boundary />
    </section>
  );
}

interface PackEditorForm {
  packId: string;
  packName: string;
  packVersion: string;
  coverage: ContentPack["coverage"];
  sourceId: string;
  entryId: string;
  slug: string;
  entryName: string;
  category: ContentEntry["category"];
  fullText: string;
  effects: string;
  restricted: boolean;
}
const initialPack: PackEditorForm = {
  packId: "pack:synthetic-local",
  packName: "Synthetic local pack",
  packVersion: "1.0.0",
  coverage: "complete",
  sourceId: "source:synthetic-local",
  entryId: "rule:moonlit-trail",
  slug: "moonlit-trail",
  entryName: "Moonlit Trail",
  category: "rule",
  fullText:
    "An original synthetic rule used only for testing the local editor.",
  effects: "[]",
  restricted: true,
};
const contentCategories = new Set<string>([
  "class",
  "class-feature",
  "subclass",
  "species",
  "race",
  "lineage",
  "background",
  "feat",
  "spell",
  "item",
  "weapon",
  "armor",
  "tool",
  "fighting-style",
  "weapon-mastery",
  "maneuver",
  "invocation",
  "metamagic",
  "infusion",
  "pact-boon",
  "condition",
  "resource",
  "rule",
]);
function isCategory(value: string): value is ContentEntry["category"] {
  return contentCategories.has(value);
}
function isPackCoverage(value: string): value is ContentPack["coverage"] {
  return value === "pilot" || value === "partial" || value === "complete";
}
function isEffect(value: unknown): value is Effect {
  return effectSchema.safeParse(value).success;
}
function PackEditor() {
  // Same one invalidation contract as every other reader: an import elsewhere
  // must be visible here without this panel being remounted.
  const { refresh } = useServices();
  const listState = useAsync(() => packs.list(), []);
  const list = listState.status === "ready" ? listState.value : [];
  const [form, setForm] = useState(initialPack),
    [editing, setEditing] = useState<string>(),
    [message, setMessage] = useState(""),
    /** The pack a removal is being confirmed for, with what it would take. */
    [removing, setRemoving] = useState<ContentPack>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      const parsed: unknown = JSON.parse(form.effects);
      if (!Array.isArray(parsed) || !parsed.every(isEffect))
        throw new Error("invalid effects");
      if (!isCategory(form.category)) throw new Error("invalid category");
      const stamp = now();
      const entry: ContentEntry = {
        id: form.entryId,
        slug: form.slug,
        name: form.entryName,
        aliases: [],
        category: form.category,
        rulesEdition: "homebrew",
        sourceId: form.sourceId,
        sourceLocator: { sourceId: form.sourceId, page: "local", section: "Local editor" },
        reviewStatus: "engine-verified",
        licenseType: "original",
        visibility: "private-user-entered",
        fullText: form.fullText,
        prerequisites: [],
        choices: [],
        effects: parsed,
        links: [],
        mechanics: { kind: "local-editor", data: {} },
        conflict: { sourcePriority: 0, resolution: "explicit-selection" },
        tags: ["synthetic"],
        version: form.packVersion,
        legacy: false,
        optional: true,
        private: true,
        exportRestricted: form.restricted,
        revision: 1,
        editionRelations: [],
        createdAt: stamp,
        updatedAt: stamp,
      };
      const pack: ContentPack = {
        id: form.packId,
        name: form.packName,
        version: form.packVersion,
        coverage: form.coverage,
        schemaVersion: 2,
        rulesEditions: ["homebrew"],
        visibility: "private",
        licenseType: "original",
        exportRestricted: form.restricted,
        includeFullText: true,
        dependencies: [],
        optionalDependencies: [],
        sourceIds: [form.sourceId],
        entryIds: [form.entryId],
        createdAt: stamp,
        updatedAt: stamp,
      };
      await savePackEntry(db, { editingPackId: editing, entry, pack });
      setMessage("Pack and entry saved locally.");
      setEditing(undefined);
      refresh();
    } catch {
      setMessage(
        "Save failed. Verify the source ID, unique IDs, category, version, and effects JSON structure.",
      );
    }
  };
  return (
    <section className="page">
      <PageIntro
        eyebrow="Full text and mechanics stay separate"
        title="Private content packs"
      >
        Edit readable text independently from declarative effects. Every later
        edit creates entry and pack history.
      </PageIntro>
      <form className="card editor packeditor" onSubmit={submit}>
        <h3>{editing ? "Edit content pack" : "New content pack"}</h3>
        <div className="formrow">
          <label>
            Pack ID
            <input
              value={form.packId}
              disabled={Boolean(editing)}
              onChange={(event) =>
                setForm({ ...form, packId: event.target.value })
              }
              required
            />
          </label>
          <label>
            Pack version
            <input
              value={form.packVersion}
              onChange={(event) =>
                setForm({ ...form, packVersion: event.target.value })
              }
              pattern="\d+\.\d+\.\d+.*"
              required
            />
          </label>
        </div>
        <label>
          Pack name
          <input
            value={form.packName}
            onChange={(event) =>
              setForm({ ...form, packName: event.target.value })
            }
            required
          />
        </label>
        <label>
          Coverage
          <select
            aria-label="Pack coverage"
            value={form.coverage}
            onChange={(event) => {
              if (isPackCoverage(event.target.value))
                setForm({ ...form, coverage: event.target.value });
            }}
          >
            <option value="pilot">Pilot</option>
            <option value="partial">Partial</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <label>
          Source ID
          <input
            value={form.sourceId}
            onChange={(event) =>
              setForm({ ...form, sourceId: event.target.value })
            }
            required
          />
        </label>
        <div className="formrow">
          <label>
            Entry ID
            <input
              value={form.entryId}
              onChange={(event) =>
                setForm({ ...form, entryId: event.target.value })
              }
              required
            />
          </label>
          <label>
            Slug
            <input
              value={form.slug}
              onChange={(event) =>
                setForm({ ...form, slug: event.target.value })
              }
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              required
            />
          </label>
        </div>
        <div className="formrow">
          <label>
            Entry name
            <input
              value={form.entryName}
              onChange={(event) =>
                setForm({ ...form, entryName: event.target.value })
              }
              required
            />
          </label>
          <label>
            Category
            <input
              value={form.category}
              onChange={(event) => {
                if (isCategory(event.target.value))
                  setForm({ ...form, category: event.target.value });
              }}
              required
            />
          </label>
        </div>
        <label>
          Full text
          <textarea
            aria-label="Full text"
            value={form.fullText}
            onChange={(event) =>
              setForm({ ...form, fullText: event.target.value })
            }
            rows={7}
          />
        </label>
        <label>
          Declarative effects (JSON array)
          <textarea
            aria-label="Declarative effects"
            value={form.effects}
            onChange={(event) =>
              setForm({ ...form, effects: event.target.value })
            }
            rows={7}
            spellCheck={false}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.restricted}
            onChange={(event) =>
              setForm({ ...form, restricted: event.target.checked })
            }
          />
          Exclude from standard exports
        </label>
        <button className="btn primary" type="submit">
          <Save />
          Save pack and entry
        </button>
        {message && (
          <p role="status" className="formmessage">
            {message}
          </p>
        )}
      </form>
      <div className="card registry">
        <h3>Content packs</h3>
        {list.length === 0 ? (
          <p>No packs yet.</p>
        ) : (
          list.map((pack) => (
            <div className="registryrow" key={pack.id}>
              <span>
                <b>{pack.name}</b>
                <small>
                  {pack.id} · v{pack.version} · {packCoveragePresentation(pack.coverage).label} ·{" "}
                  {pack.entryIds.length} entries
                </small>
              </span>
              <button
                className="btn secondary"
                onClick={async () => {
                  const entry = pack.entryIds[0]
                    ? await entries.get(pack.entryIds[0])
                    : undefined;
                  setEditing(pack.id);
                  setForm({
                    packId: pack.id,
                    packName: pack.name,
                    packVersion: pack.version,
                    coverage: pack.coverage,
                    sourceId: pack.sourceIds[0] ?? "",
                    entryId: entry?.id ?? "",
                    slug: entry?.slug ?? "",
                    entryName: entry?.name ?? "",
                    category: entry?.category ?? "rule",
                    fullText: entry?.fullText ?? "",
                    effects: JSON.stringify(entry?.effects ?? [], null, 2),
                    restricted: pack.exportRestricted,
                  });
                }}
              >
                Edit
              </button>
              <button
                className="icon danger"
                aria-label={`Remove ${pack.name}`}
                onClick={() => {
                  setMessage("");
                  setRemoving(pack);
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))
        )}
      </div>
      {removing && (
        <div className="card removalconfirm" role="dialog" aria-modal="false" aria-labelledby="pack-removal-title">
          <h3 id="pack-removal-title">
            {describePackRemoval({ packName: removing.name, entryCount: removing.entryIds.length }).title}
          </h3>
          <p>{describePackRemoval({ packName: removing.name, entryCount: removing.entryIds.length }).explanation}</p>
          <div className="actions">
            <button
              className="btn danger"
              onClick={async () => {
                try {
                  await packs.delete(removing.id);
                  setMessage(`${removing.name} was removed from the installed list.`);
                } catch (error) {
                  setMessage(safeMessage(error));
                }
                setRemoving(undefined);
                refresh();
              }}
            >
              <Trash2 />
              Remove this pack
            </button>
            <button className="btn secondary" onClick={() => setRemoving(undefined)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      <Boundary />
    </section>
  );
}

/**
 * What the user is told an import would do.
 *
 * "Import blocked" used to cover a first install, an upgrade, a re-import of
 * what was already installed, and an attempt to install something older. The
 * middle two are ordinary and not failures; presenting them as a block, above a
 * list of raw issue codes, is what made a repeat import read as a broken app.
 */
const VERDICT_HEADINGS: Record<InstallVerdict, string> = {
  install: "Ready to import",
  update: "Ready to update",
  "already-current": "Already installed — nothing to update",
  "older-than-installed": "Not imported: a newer version is already installed",
  "revision-conflict": "Not imported: the installed records are newer",
  blocked: "Import blocked",
};

const VERDICT_EXPLANATIONS: Record<InstallVerdict, string> = {
  install: "Nothing here is installed yet. Confirming writes it in one transaction.",
  update: "This is a newer version of content already on this device. Confirming replaces it in one transaction.",
  "already-current":
    "This is the version already on this device, so there is nothing to write. Your installed content is unchanged and remains usable.",
  "older-than-installed":
    "This file is older than what is installed, so it was not applied. The newer installed content is kept and stays usable.",
  "revision-conflict":
    "One or more records on this device are at a newer revision than the ones in this file, so nothing was written. The installed content is kept and stays usable.",
  blocked: "This file cannot be applied as it stands. Nothing was written. The details below say why.",
};

function ImportExportPanel() {
  const { install, refresh } = useServices();
  const [text, setText] = useState(""),
    /** A preview and the exact input it was computed from, never one alone. */
    [preview, setPreview] = useState<{ source: string; result: InstallPreview }>(),
    [createRuleset, setCreateRuleset] = useState(true),
    [message, setMessage] = useState(""),
    [includeRestricted, setIncludeRestricted] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    /*
     * An import in flight. The write is one transaction and can take a moment on
     * a large pack, during which the button looked idle — so a second press was
     * the natural response, and a second press is a second import attempt.
     */
    [importing, setImporting] = useState(false),
    /*
     * Checking a file is the other operation that takes visible time: schema,
     * migration, duplicate, reference and revision checks all run here, over
     * every entry in the file. It looked idle for exactly as long as the write
     * did, and for the same reason.
     */
    [previewing, setPreviewing] = useState(false),
    /**
     * What the last completed import did, kept as its own state.
     *
     * It outlives the preview deliberately: `clearImport` empties the input the
     * moment a write lands, and the result is the one thing that must still be
     * on screen afterwards.
     */
    [result, setResult] = useState<ImportOutcomeSummary>();
  const fileRef = useRef<HTMLInputElement>(null);
  /** True while either long operation is in flight; the panel is busy then. */
  const busy = previewing || importing;

  /**
   * The preview, but only while it still describes what is in the input.
   *
   * Carrying the source alongside the result makes a stale preview
   * unrepresentable rather than merely unlikely: choosing another file, typing,
   * or a slow preview landing after the input moved on all leave
   * `preview.source` and `text` disagreeing, and a disagreeing preview is not
   * rendered and cannot be confirmed. Clearing it in each handler is still done,
   * but it is no longer what correctness depends on.
   */
  const currentPreview = preview && preview.source === text ? preview.result : undefined;

  /** Forgets the current preview. The input is left alone. */
  const invalidatePreview = () => {
    setPreview(undefined);
    setMessage("");
  };

  /** Clears input and preview together, so neither can outlive the other. */
  const clearImport = () => {
    setPreview(undefined);
    setText("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // Always the set boundary, so the preview shows exactly what confirmation
  // revalidates, and always through the service, so no component installs
  // content by writing tables itself.
  const inspect = async () => {
    if (busy) return;
    setResult(undefined);
    // Acknowledged before the work starts, not after it finishes: this is the
    // announcement, and the only honest thing to say about duration is that it
    // depends on the file.
    setMessage("Checking this file. Large packs take a moment.");
    setPreviewing(true);
    const source = text;
    try {
      const previewed = await install.preview([source]);
      setPreview({ source, result: previewed });
      const summary = summariseImportIssues(previewed.issues);
      setMessage(
        previewed.canImport
          ? `File checked. ${previewed.set.plan.entries.add.length + previewed.set.plan.entries.update.length} entries would be written, ${summary.errorCount} errors, ${summary.warningCount} to review.`
          : `File checked and cannot be imported as it stands: ${summary.errorCount} blocking ${summary.errorCount === 1 ? "problem" : "problems"}.`,
      );
    } catch (error) {
      // A preview that could not be produced must not leave the previous one
      // standing: the input has already moved on from whatever it described.
      setPreview(undefined);
      setMessage(safeMessage(error));
    } finally {
      setPreviewing(false);
    }
  };
  /**
   * Importing content that no ruleset activates leaves it installed and
   * unreachable, so the offer to create one is part of the same confirmation and
   * lands in the same transaction: a rolled-back import leaves no profile behind.
   */
  const commit = async () => {
    if (!currentPreview || busy) return;
    setResult(undefined);
    // Said before the transaction opens, so the acknowledgement is not waiting
    // behind the work it acknowledges.
    setMessage("Import started. Writing this pack in one transaction; large packs take a moment.");
    setImporting(true);
    try {
      await runCommit(currentPreview);
    } finally {
      setImporting(false);
    }
  };

  const runCommit = async (currentPreview: InstallPreview) => {
    const creatable = currentPreview.offers.filter(offer => offer.usable && !offer.alreadyInstalled);
    const requested = createRuleset ? creatable.map(offer => offer.packId) : [];
    const outcome = await install.confirm(currentPreview, {
      createRulesetForPackIds: requested,
      ...(requested.length === 1 ? { activateRulesetId: creatable[0].rulesetId } : {}),
    });
    if (outcome.status !== "ok") {
      const refused = summariseImportOutcome({
        plan: currentPreview.set.plan,
        issues: currentPreview.issues,
        applied: false,
      });
      setResult(refused);
      setMessage("Import was not applied. No content and no ruleset profile were kept.");
      return;
    }
    /*
     * The result, computed from the plan that was actually written and the
     * issues that were actually raised. It is set before the input is cleared,
     * because clearing the input discards the preview it came from.
     */
    const summary = summariseImportOutcome({
      plan: currentPreview.set.plan,
      issues: currentPreview.issues,
      applied: true,
    });
    setResult(summary);
    /*
     * An update creates no profile and must not therefore report that nothing
     * happened to the rulesets. The existing profile advanced to the pack's new
     * membership in the same transaction, and that is the fact the user needs:
     * the content they just added is reachable from the ruleset they already use.
     */
    /*
     * One live region, carrying both facts in the order they matter: what the
     * import did, then what became reachable because of it. A screen reader
     * hears the counts here because the visual summary conveys them as a row of
     * small numbers, which reads as nothing at all.
     */
    setMessage(
      `${summary.announcement} ${
        outcome.result.createdRulesetIds.length
          ? `Import completed atomically. ${outcome.result.createdRulesetIds.length} ruleset profile(s) created and ready to select.`
          : outcome.result.updatedRulesetIds.length
            ? `Import completed atomically. ${outcome.result.updatedRulesetIds.length} existing ruleset(s) updated to include this pack's current entries.`
            : "Import completed atomically. No ruleset profile was created, so this content is only reachable through an existing ruleset."
      }`,
    );
    clearImport();
    refresh();
  };
  const exportData = async () => {
    try {
      const result = await createContentExport(db, {
        includeRestricted,
        confirmedRestrictedExport: confirmed,
      });
      setMessage(`Export ready with ${result.length} pack(s).`);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(
        new Blob([JSON.stringify(result, null, 2)], {
          type: "application/json",
        }),
      );
      link.download = "adventurer-ledger-content.json";
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      setMessage(safeMessage(error));
    }
  };
  return (
    <section className="page">
      <PageIntro eyebrow="Preview before mutation" title="Imports & exports">
        Validate schema, migrations, duplicates, references, and revisions
        before one atomic local write.
      </PageIntro>
      <div className="card editor">
        <h3>Import content pack</h3>
        <label>
          Choose JSON file
          <input
            type="file"
            accept="application/json,.json"
            ref={fileRef}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              // Invalidate first: the preview on screen stops describing the
              // input the moment another file is chosen, not once it is read.
              invalidatePreview();
              setText(await file.text());
            }}
          />
        </label>
        <label>
          Pack JSON
          <textarea
            aria-label="Pack JSON"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              invalidatePreview();
            }}
            rows={10}
            spellCheck={false}
          />
        </label>
        <button className="btn primary" onClick={inspect} disabled={!text || busy} aria-busy={previewing || undefined}>
          <Import />
          {previewing ? "Checking file…" : "Preview import"}
        </button>
        {/*
         * Indeterminate on purpose. The pipeline reports no fraction of the way
         * through — the write is one transaction — and inventing a percentage
         * would be a claim about progress nothing here can make. A moving bar
         * and a sentence saying what is happening is the truthful version.
         */}
        {busy ? (
          <div className="importprogress">
            <div
              className="progressbar"
              role="progressbar"
              aria-label={previewing ? "Checking the file" : "Importing content"}
            />
            <p className="m2-muted">
              {previewing
                ? "Checking schema, references, and revisions against what is installed."
                : "Writing this pack in one transaction. It will be applied in full or not at all."}
            </p>
          </div>
        ) : null}
        {result ? <ImportResult outcome={result} /> : null}
        {currentPreview && (
          <div className="preview" aria-label="Import preview">
            <h4>{VERDICT_HEADINGS[currentPreview.verdict]}</h4>
            <p>{VERDICT_EXPLANATIONS[currentPreview.verdict]}</p>
            {/*
             * A refusal must not imply that nothing usable is installed. When
             * the reason for refusing is that something newer is already here,
             * the next action is to use it, so it is offered directly.
             */}
            {!currentPreview.canImport && currentPreview.usableExistingRulesets.length ? (
              <div className="issue">
                <p>
                  {currentPreview.usableExistingRulesets.length === 1
                    ? "This ruleset is installed and can be selected right now:"
                    : "These rulesets are installed and can be selected right now:"}
                </p>
                <ul>
                  {currentPreview.usableExistingRulesets.map(ruleset => (
                    <li key={ruleset.id}>
                      <b>{ruleset.name}</b> — {ruleset.entryCount} entries, creation levels 1 to{" "}
                      {ruleset.maxSupportedLevel}{" "}
                      <button
                        className="btn secondary"
                        onClick={async () => {
                          const outcome = await install.activate(ruleset.id);
                          setMessage(
                            outcome.status === "ok"
                              ? `${ruleset.name} is now the ruleset new characters start in. Nothing was imported.`
                              : "That ruleset could not be selected on this device.",
                          );
                          // One contract: every dependent read re-runs, so the
                          // builder's picker and the ruleset list agree at once.
                          refresh();
                        }}
                      >
                        Use {ruleset.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p>
              {currentPreview.set.plan.sources.add.length} sources,{" "}
              {currentPreview.set.plan.packs.add.length} packs, and{" "}
              {currentPreview.set.plan.entries.add.length} entries will be added.
            </p>
            <p>
              {currentPreview.set.plan.sources.update.length} sources,{" "}
              {currentPreview.set.plan.packs.update.length} packs, and{" "}
              {currentPreview.set.plan.entries.update.length} entries will be updated.
            </p>
            {/*
             * An additive update is mostly made of records the file restates
             * without changing. Naming them keeps the count honest: without this
             * line a 262-entry file reporting "47 added, 0 updated" reads as if
             * 215 entries went missing.
             */}
            {currentPreview.set.plan.entries.unchanged.length ? (
              <p>
                {currentPreview.set.plan.entries.unchanged.length} entries are
                already installed unchanged and will be left as they are.
              </p>
            ) : null}
            {currentPreview.offers.map(offer => (
              <p className="issue" key={offer.packId}>
                <b>{offer.name}</b>{" "}
                {offer.alreadyInstalled
                  ? offer.installedMatch === "legacy"
                    ? `maps to the existing ruleset ${offer.installedRulesetId}, which an earlier naming scheme also produced for a differently-named pack. Nothing is overwritten; this pack cannot be installed until that is resolved.`
                    : currentPreview.verdict === "update"
                      ? // No second ruleset: the one it already has advances to
                        // the membership this version ships.
                        `already has the ruleset ${offer.installedRulesetId ?? offer.rulesetId}, which will be updated to activate all ${offer.entryCount} entries.`
                      : `already has the ruleset ${offer.installedRulesetId ?? offer.rulesetId}.`
                  : offer.usable
                    ? `can become the ruleset ${offer.rulesetId}, covering levels 1 to ${offer.maxSupportedLevel}.`
                    : `cannot stand as a ruleset on its own: it supplies no ${offer.missingCategories.join(", ")}.`}
              </p>
            ))}
            {currentPreview.offers.some(offer => offer.usable && !offer.alreadyInstalled) && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={createRuleset}
                  onChange={event => setCreateRuleset(event.target.checked)}
                />
                Create a ruleset profile so this content can be selected in the builder
              </label>
            )}
            {/*
             * Grouped, not enumerated. Rendering one row per issue is what made
             * a healthy 600-entry pack produce a page of red: the file raises a
             * notice per adjudicated effect, and there are hundreds of them.
             * They are the same *kind* of notice, so they are one row that says
             * how many, opens on demand, and keeps its records inside.
             */}
            <ImportIssueGroups summary={summariseImportIssues([...currentPreview.issues])} />
            <div className="actions">
              <button
                className="btn primary"
                disabled={!currentPreview.canImport || busy}
                aria-busy={importing || undefined}
                onClick={commit}
              >
                <FileCheck2 />
                {importing ? "Importing…" : "Confirm atomic import"}
              </button>
              <button
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  clearImport();
                  setResult(undefined);
                  setMessage("Import cancelled. The database was not changed.");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {message && (
          <p role="status" className="formmessage">
            {message}
          </p>
        )}
      </div>
      <div className="card editor">
        <h3>Export content packs</h3>
        <p>Standard export excludes every restricted pack and entry.</p>
        <label className="check">
          <input
            type="checkbox"
            checked={includeRestricted}
            onChange={(event) => {
              setIncludeRestricted(event.target.checked);
              setConfirmed(false);
            }}
          />
          Include restricted content
        </label>
        {includeRestricted && (
          <label className="check confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I explicitly confirm this restricted export
          </label>
        )}
        <button className="btn secondary" onClick={exportData}>
          <Download />
          Create local export
        </button>
      </div>
      <Boundary />
    </section>
  );
}

function Compendium() {
  const [list, setList] = useState<ContentEntry[]>([]),
    [query, setQuery] = useState("");
  useEffect(() => {
    void entries.list().then(setList);
  }, []);
  const visible = list.filter((entry) =>
    `${entry.name} ${entry.category} ${entry.tags.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <section className="page">
      <PageIntro eyebrow="Imported local knowledge" title="Content compendium">
        Browse imported and locally edited entries without exposing their full
        text in logs or diagnostics.
      </PageIntro>
      <label className="card compendiumsearch">
        Filter compendium
        <input
          aria-label="Filter compendium"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, category, or tag"
        />
      </label>
      <div className="compendiumgrid">
        {visible.length === 0 ? (
          <div className="card empty">
            <BookOpen />
            <h3>No entries found</h3>
            <p>Import a valid synthetic pack or create one locally.</p>
          </div>
        ) : (
          visible.map((entry) => (
            <article className="card entrycard" key={entry.id}>
              <span className="badge">{entry.category}</span>
              {entry.exportRestricted && (
                <span className="badge private">RESTRICTED</span>
              )}
              <h3>{entry.name}</h3>
              <small>
                {entry.id} · revision {entry.revision}
              </small>
              {entry.summary && <p>{entry.summary}</p>}
              <details>
                <summary>Full text</summary>
                <p>{entry.fullText || "No full text stored."}</p>
              </details>
              <details>
                <summary>Effects ({entry.effects.length})</summary>
                <pre>{JSON.stringify(entry.effects, null, 2)}</pre>
              </details>
            </article>
          ))
        )}
      </div>
      <Boundary />
    </section>
  );
}
