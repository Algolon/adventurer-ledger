"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
import type { InstallPreview, InstallVerdict } from "@/src/services/content-install-service";
import { useAsync, useServices } from "@/src/ui/services-context";
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
    [message, setMessage] = useState("");
  const [form, setForm] = useState({
    id: "source:synthetic-local",
    name: "Synthetic local source",
    abbreviation: "SYN",
    version: "1.0.0",
  });
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
      refresh();
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
                    refresh();
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
  // Same one invalidation contract as every other reader: an import elsewhere
  // must be visible here without this panel being remounted.
  const { refresh } = useServices();
  const listState = useAsync(() => packs.list(), []);
  const list = listState.status === "ready" ? listState.value : [];
  const [form, setForm] = useState(initialPack),
    [editing, setEditing] = useState<string>(),
    [message, setMessage] = useState("");
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
                aria-label={`Delete ${pack.name}`}
                onClick={async () => {
                  await packs.delete(pack.id);
                  refresh();
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
    [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
    setMessage("");
    const source = text;
    try {
      const result = await install.preview([source]);
      setPreview({ source, result });
    } catch (error) {
      // A preview that could not be produced must not leave the previous one
      // standing: the input has already moved on from whatever it described.
      setPreview(undefined);
      setMessage(safeMessage(error));
    }
  };
  /**
   * Importing content that no ruleset activates leaves it installed and
   * unreachable, so the offer to create one is part of the same confirmation and
   * lands in the same transaction: a rolled-back import leaves no profile behind.
   */
  const commit = async () => {
    if (!currentPreview || importing) return;
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
      setMessage("Import was not applied. No content and no ruleset profile were kept.");
      return;
    }
    setMessage(
      outcome.result.createdRulesetIds.length
        ? `Import completed atomically. ${outcome.result.createdRulesetIds.length} ruleset profile(s) created and ready to select.`
        : "Import completed atomically. No ruleset profile was created, so this content is only reachable through an existing ruleset.",
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
        <button className="btn primary" onClick={inspect} disabled={!text}>
          <Import />
          Preview import
        </button>
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
            {currentPreview.offers.map(offer => (
              <p className="issue" key={offer.packId}>
                <b>{offer.name}</b>{" "}
                {offer.alreadyInstalled
                  ? offer.installedMatch === "legacy"
                    ? `maps to the existing ruleset ${offer.installedRulesetId}, which an earlier naming scheme also produced for a differently-named pack. Nothing is overwritten; this pack cannot be installed until that is resolved.`
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
             * The message leads and the code follows in the small print. The
             * code is still needed to report a problem precisely, but a user
             * reading `ENTRY_REVISION_CONFLICT` first learns nothing from it.
             */}
            {currentPreview.issues.map((issue, index) => (
              <p className="issue" key={`${issue.code}-${index}`}>
                {issue.message} <small className="m2-muted">{issue.code}</small>
              </p>
            ))}
            <div className="actions">
              <button
                className="btn primary"
                disabled={!currentPreview.canImport || importing}
                aria-busy={importing || undefined}
                onClick={commit}
              >
                <FileCheck2 />
                {importing ? "Importing…" : "Confirm atomic import"}
              </button>
              <button
                className="btn secondary"
                onClick={() => {
                  clearImport();
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
