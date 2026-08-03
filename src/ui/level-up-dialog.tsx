"use client";

/**
 * Level up, level 1 to level 2.
 *
 * The preview is read-only: opening this dialog writes nothing, and Cancel
 * leaves the character at its current level. Confirm takes the pre-level restore
 * point and commits atomically. The before/after table names the current-value
 * policy explicitly so the 5/10 to 7/12 and 1/3 to 2/4 results are explained
 * rather than surprising.
 */
import { useCallback, useEffect, useState } from "react";
import { useServices } from "@/src/ui/services-context";
import { Dialog } from "@/src/ui/primitives";
import type { LevelUpPreview } from "@/src/services/levelup-service";

export function LevelUpDialog({
  characterId,
  onClose,
  onCommitted,
}: {
  characterId: string;
  onClose(): void;
  onCommitted(restorePointId: string): void;
}) {
  const { levelUp, refresh } = useServices();
  const [preview, setPreview] = useState<LevelUpPreview | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<{ code: string; label: string }[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);

  const load = useCallback(
    async (choiceSelections: Record<string, string[]>) => {
      const outcome = await levelUp.preview(characterId, choiceSelections);
      if (outcome.status === "ok") setPreview(outcome.result);
      else setBlocked("This character cannot be levelled up right now.");
    },
    [characterId, levelUp],
  );

  useEffect(() => {
    void load(selections);
  }, [load, selections]);

  const confirm = async () => {
    if (!preview) return;
    const outcome = await levelUp.confirm({
      operationId: `ui:levelup:${characterId}:${preview.characterRevision}`,
      characterId,
      expectedCharacterRevision: preview.characterRevision,
      expectedRuntimeRevision: preview.runtimeRevision,
      targetLevel: preview.toLevel,
      expectedContentFingerprint: preview.contentFingerprint,
      choiceSelections: selections,
    });
    if (outcome.status === "ok") {
      refresh();
      onCommitted(outcome.result.restorePointId);
      return;
    }
    if (outcome.status === "invalid")
      setErrors(outcome.issues.map(issue => ({ code: issue.code, label: `Resolve: ${issue.recordId ?? issue.code}` })));
    else setErrors([{ code: "STALE", label: "This character changed elsewhere. Reopen level up to see current values." }]);
  };

  if (blocked)
    return (
      <Dialog title="Level up" onClose={onClose}>
        <p role="alert">{blocked}</p>
      </Dialog>
    );

  if (!preview)
    return (
      <Dialog title="Level up" onClose={onClose}>
        <p role="status">Calculating the preview…</p>
      </Dialog>
    );

  const outstanding = preview.newChoices.filter(choice => !choice.resolved);

  return (
    <Dialog
      title={`Level ${preview.fromLevel} to ${preview.toLevel}`}
      onClose={onClose}
      errorSummary={errors}
      footer={
        <>
          <button type="button" className="m2-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="m2-button m2-button-primary"
            onClick={() => void confirm()}
            disabled={outstanding.length > 0}
          >
            Confirm level {preview.toLevel}
          </button>
        </>
      }
    >
      <p className="m2-muted">
        A restore point named “{preview.restorePointLabel}” is taken before anything changes. Cancel writes nothing.
      </p>

      <h4>Automatic gains</h4>
      <table className="m2-diff">
        <caption className="m2-visually-hidden">Before and after comparison for level {preview.toLevel}</caption>
        <thead>
          <tr>
            <th scope="col">Value</th>
            <th scope="col">Before</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {preview.scalars.map(row => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              <td>{row.before ?? "—"}</td>
              <td>{row.after ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Current and maximum values</h4>
      <p className="m2-policy">Policy: {preview.policyLabel}. Your current value moves by the same amount as the maximum.</p>
      <table className="m2-diff">
        <thead>
          <tr>
            <th scope="col">Tracker</th>
            <th scope="col">Before</th>
            <th scope="col">Maximum change</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {[preview.hitPoints, ...preview.resources].map(row => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              <td>
                {row.beforeCurrent ?? "—"} / {row.beforeMaximum ?? "—"}
              </td>
              <td>{row.maximumDelta === null ? "—" : row.maximumDelta >= 0 ? `+${row.maximumDelta}` : row.maximumDelta}</td>
              <td>
                {row.proposedCurrent ?? "—"} / {row.afterMaximum ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>New choices</h4>
      {preview.newChoices.length ? (
        preview.newChoices.map(choice => (
          <fieldset key={choice.choiceId} className="m2-fieldset">
            <legend>{choice.label}</legend>
            <ul className="m2-options">
              {choice.options.map(option => {
                const chosen = (selections[choice.choiceId] ?? []).includes(option.id);
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      className={chosen ? "m2-option m2-option-selected" : "m2-option"}
                      aria-pressed={chosen}
                      onClick={() => setSelections(current => ({ ...current, [choice.choiceId]: [option.id] }))}
                    >
                      <span className="m2-option-mark" aria-hidden="true">
                        {chosen ? "✓" : "○"}
                      </span>
                      <span>
                        <b>{option.label}</b>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ))
      ) : (
        <p className="m2-muted">Nothing new to choose at this level.</p>
      )}
      {outstanding.length ? (
        <p className="m2-inline-issue" role="status">
          Choose {outstanding.map(choice => choice.label).join(", ")} before confirming.
        </p>
      ) : null}
    </Dialog>
  );
}
