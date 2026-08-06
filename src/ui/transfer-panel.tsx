"use client";

/**
 * Standard file transfer between devices.
 *
 * Export produces a user-controlled file; nothing is uploaded and no path here
 * implies automatic device replication. An incoming file is validated and
 * previewed before any write, and the manifest names identity, timestamp,
 * ruleset, dependency counts, restriction status, format version and
 * fingerprint. Cancel simply leaves the preview without confirming.
 */
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { useAsync, useServices } from "@/src/ui/services-context";
import type { ConflictAction, TransferPreview } from "@/src/services/transfer-service";

const CONFLICT_COPY: Record<ConflictAction, { label: string; consequence: string }> = {
  import: { label: "Import", consequence: "No character with this ID exists here, so the import is added on its own." },
  "keep-both": { label: "Keep both", consequence: "The incoming character is added under a new ID and marked as an imported copy. Your local record is untouched." },
  replace: { label: "Replace local with restore point", consequence: "Your local record is versioned and a restore point is taken first, then it is replaced." },
};

export function TransferPanel({ characterId, onImported }: { characterId?: string; onImported(id: string): void }) {
  const { transfer, query, refresh } = useServices();
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [exportIssues, setExportIssues] = useState<string[]>([]);
  const library = useAsync(() => query.library(), []);

  const doExport = async (id: string) => {
    const outcome = await transfer.createTransfer(id);
    if (outcome.status !== "ok") {
      setExportIssues(
        outcome.status === "invalid" ? outcome.issues.map(issue => issue.code) : ["The character could not be exported."],
      );
      return;
    }
    setExportIssues([]);
    const blob = new Blob([outcome.result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    // The filename carries a stable ID only, never private text.
    link.download = `${id.replace(/[^a-z0-9-]+/gi, "-")}-transfer.json`;
    link.click();
    URL.revokeObjectURL(url);
    setMessage(`Transfer file created for ${outcome.result.manifest.name}. It is saved to this device only.`);
  };

  const readFile = async (file: File) => {
    const text = await file.text();
    const outcome = await transfer.preview(text);
    if (outcome.status === "ok") {
      setPreview(outcome.result);
      setMessage(null);
      return;
    }
    setPreview(null);
    setMessage(
      outcome.status === "invalid"
        ? `This file could not be read: ${outcome.issues.map(issue => issue.code).join(", ")}`
        : "This file could not be read.",
    );
  };

  const confirm = async (action: ConflictAction) => {
    if (!preview) return;
    const expected = preview.category === "conflict" ? await currentRevision(preview.manifest.characterId) : undefined;
    const outcome = await transfer.confirm(preview.token, action, `ui:transfer:${Date.now()}`, expected);
    if (outcome.status === "ok") {
      refresh();
      setPreview(null);
      setMessage(`Imported on this device as ${outcome.result.characterId}.`);
      onImported(outcome.result.characterId);
      return;
    }
    setMessage(
      outcome.status === "invalid"
        ? outcome.issues.map(issue => issue.code).join(", ")
        : "The import could not be completed. Nothing was changed.",
    );
  };

  const currentRevision = async (id: string) => {
    const sheet = await query.sheet(id);
    return sheet?.characterRevision;
  };

  const characters = library.status === "ready" ? library.value.characters : [];

  return (
    <section className="m2-page">
      <h2 className="m2-page-title">Transfer</h2>
      <p className="m2-muted">
        Devices do not exchange changes automatically. Move a character with a file you control.
      </p>

      <section className="m2-card">
        <div className="m2-card-head">
          <h3>
            <Download aria-hidden="true" /> Export a character
          </h3>
        </div>
        {characters.length ? (
          <ul className="m2-plain-list">
            {characters.map(card => (
              <li key={card.characterId}>
                <button type="button" className="m2-button" onClick={() => void doExport(card.characterId)}>
                  Export {card.name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m2-muted">There is no character on this device to export yet.</p>
        )}
        {characterId ? (
          <button type="button" className="m2-button m2-button-primary" onClick={() => void doExport(characterId)}>
            Export the open character
          </button>
        ) : null}
        {exportIssues.length ? (
          <p className="m2-inline-issue" role="alert">
            Export blocked: {exportIssues.join(", ")}. A standard transfer never embeds restricted content.
          </p>
        ) : null}
      </section>

      <section className="m2-card">
        <div className="m2-card-head">
          <h3>
            <Upload aria-hidden="true" /> Receive a character
          </h3>
        </div>
        <label className="m2-field">
          <span>Choose a transfer file</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>

        {preview ? (
          <div className="m2-preview">
            <h4>Before anything is written</h4>
            <dl className="m2-summary">
              <div>
                <dt>Character</dt>
                <dd>{preview.manifest.name}</dd>
              </div>
              <div>
                <dt>Stable ID</dt>
                <dd>{preview.manifest.characterId}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{preview.manifest.updatedAt}</dd>
              </div>
              <div>
                <dt>Ruleset</dt>
                <dd>{preview.manifest.rulesetId}</dd>
              </div>
              <div>
                <dt>Level</dt>
                <dd>{preview.manifest.level}</dd>
              </div>
              <div>
                <dt>Dependencies</dt>
                <dd>
                  {preview.manifest.dependencyCount}
                  {preview.manifest.missingDependencyIds.length
                    ? ` · ${preview.manifest.missingDependencyIds.length} missing here`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Restricted content</dt>
                <dd>{preview.manifest.restricted ? "Present" : "None"}</dd>
              </div>
              <div>
                <dt>Format version</dt>
                <dd>{preview.manifest.formatVersion}</dd>
              </div>
              <div>
                <dt>Fingerprint</dt>
                <dd>{preview.manifest.characterFingerprint}</dd>
              </div>
            </dl>

            {preview.category === "already-current" ? (
              <p className="m2-banner m2-banner-info" role="status">
                <strong>Already current</strong> This device already holds this character at this exact fingerprint. There is
                nothing to import.
              </p>
            ) : (
              <div className="m2-play-row">
                {preview.availableActions.map(action => (
                  <button key={action} type="button" className="m2-button m2-button-primary" onClick={() => void confirm(action)}>
                    {CONFLICT_COPY[action].label}
                  </button>
                ))}
                <button type="button" className="m2-button" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            )}
            <ul className="m2-plain-list m2-muted">
              {preview.availableActions.map(action => (
                <li key={action}>
                  <b>{CONFLICT_COPY[action].label}:</b> {CONFLICT_COPY[action].consequence}
                </li>
              ))}
              {preview.category !== "already-current" ? <li>Cancel performs no change at all.</li> : null}
            </ul>
            {preview.manifest.missingDependencyIds.length ? (
              <p className="m2-inline-issue">
                Missing here: {preview.manifest.missingDependencyIds.join(", ")}. Affected values stay uncertain; nothing is
                substituted by name.
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="m2-status" role="status" aria-live="polite">
          {message ?? ""}
        </p>
      </section>
    </section>
  );
}
