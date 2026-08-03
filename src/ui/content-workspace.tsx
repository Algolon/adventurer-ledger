"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Archive,
  BookOpen,
  Download,
  FileCheck2,
  FolderLock,
  Import,
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
  createContentExport,
  RestrictedExportConfirmationError,
} from "@/src/export/content-export";
import {
  confirmImportSet,
  previewContentPackSet,
  type ImportSetPreview,
} from "@/src/import/content-pipeline";
import { db } from "@/src/storage/db";
import {
  ContentEntryRepository,
  ContentPackRepository,
  SourceRepository,
} from "@/src/storage/content-repositories";

const sources = new SourceRepository(db),
  packs = new ContentPackRepository(db),
  entries = new ContentEntryRepository(db);
const now = () => new Date().toISOString();
const safeMessage = (error: unknown) =>
  error instanceof RestrictedExportConfirmationError
    ? error.message
    : "The operation could not be completed. Check IDs, versions, and required fields.";

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
  const [list, setList] = useState<Source[]>([]),
    [editing, setEditing] = useState<string>(),
    [message, setMessage] = useState("");
  const [form, setForm] = useState({
    id: "source:synthetic-local",
    name: "Synthetic local source",
    abbreviation: "SYN",
    version: "1.0.0",
  });
  const refresh = useCallback(() => sources.list().then(setList), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
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
      await refresh();
    } catch (error) {
      setMessage(safeMessage(error));
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
            required
          />
        </label>
        <label>
          Name
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
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
              required
            />
          </label>
        </div>
        <button className="btn primary" type="submit">
          <Save />
          Save source
        </button>
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
              <button
                className="icon danger"
                aria-label={`Delete ${source.name}`}
                onClick={async () => {
                  try {
                    await sources.delete(source.id);
                    await refresh();
                  } catch (error) {
                    setMessage(safeMessage(error));
                  }
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))
        )}
      </div>
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
  const [list, setList] = useState<ContentPack[]>([]),
    [form, setForm] = useState(initialPack),
    [editing, setEditing] = useState<string>(),
    [message, setMessage] = useState("");
  const refresh = useCallback(() => packs.list().then(setList), []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
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
      await refresh();
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
                aria-label={`Delete ${pack.name}`}
                onClick={async () => {
                  await packs.delete(pack.id);
                  await refresh();
                }}
              >
                <Trash2 />
              </button>
            </div>
          ))
        )}
      </div>
      <Boundary />
    </section>
  );
}

function ImportExportPanel() {
  const [text, setText] = useState(""),
    [preview, setPreview] = useState<ImportSetPreview>(),
    [message, setMessage] = useState(""),
    [includeRestricted, setIncludeRestricted] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  // Always the set boundary, so the preview shows exactly what confirmation revalidates.
  const inspect = async () => {
    setMessage("");
    setPreview(await previewContentPackSet([text], db));
  };
  const commit = async () => {
    if (!preview) return;
    try {
      await confirmImportSet(preview, db);
      setMessage("Import completed atomically.");
      setPreview(undefined);
      setText("");
    } catch {
      setMessage("Import was not applied. No partial records were kept.");
    }
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
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setText(await file.text());
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
              setPreview(undefined);
            }}
            rows={10}
            spellCheck={false}
          />
        </label>
        <button className="btn primary" onClick={inspect} disabled={!text}>
          <Import />
          Preview import
        </button>
        {preview && (
          <div className="preview" aria-label="Import preview">
            <h4>{preview.canImport ? "Ready to import" : "Import blocked"}</h4>
            <p>
              {preview.plan.sources.add.length} sources,{" "}
              {preview.plan.packs.add.length} packs, and{" "}
              {preview.plan.entries.add.length} entries will be added.
            </p>
            <p>
              {preview.plan.sources.update.length} sources,{" "}
              {preview.plan.packs.update.length} packs, and{" "}
              {preview.plan.entries.update.length} entries will be updated.
            </p>
            {preview.issues.map((issue, index) => (
              <p className="issue" key={`${issue.code}-${index}`}>
                <b>{issue.code}</b> {issue.message}
              </p>
            ))}
            <div className="actions">
              <button
                className="btn primary"
                disabled={!preview.canImport}
                onClick={commit}
              >
                <FileCheck2 />
                Confirm atomic import
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  setPreview(undefined);
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
