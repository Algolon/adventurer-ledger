"use client";

/**
 * Level up, exactly one level at a time.
 *
 * The preview is read-only: opening this dialog writes nothing, and Cancel
 * leaves the character at its current level. Confirm takes the pre-level restore
 * point and commits atomically. The before/after table names the current-value
 * policy explicitly so the 5/10 to 7/12 and 1/3 to 2/4 results are explained
 * rather than surprising.
 *
 * The dialog will not offer a level the class's own progression does not
 * describe. Without that guard the preview was an empty screen with a live
 * Confirm button: nothing gained, nothing to choose, and a committed level the
 * content could not justify.
 */
import { useCallback, useEffect, useState } from "react";
import { useServices } from "@/src/ui/services-context";
import { Dialog } from "@/src/ui/primitives";
import type { GainedEntryView, LevelUpPreview } from "@/src/services/levelup-service";

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
  const [subclassId, setSubclassId] = useState<string | undefined>(undefined);
  const [errors, setErrors] = useState<{ code: string; label: string }[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);

  const load = useCallback(
    async (choiceSelections: Record<string, string[]>, chosenSubclassId: string | undefined) => {
      const outcome = await levelUp.preview(characterId, choiceSelections, chosenSubclassId);
      if (outcome.status === "ok") setPreview(outcome.result);
      else setBlocked("This character cannot be levelled up right now.");
    },
    [characterId, levelUp],
  );

  useEffect(() => {
    void load(selections, subclassId);
  }, [load, selections, subclassId]);

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
      ...(subclassId ? { subclassId } : {}),
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

  /**
   * A level the class does not describe is not a level-up.
   *
   * The dialog says what is missing and offers no Confirm, instead of showing an
   * empty preview beside a button that would commit it anyway.
   */
  if (!preview.coverage.supported)
    return (
      <Dialog title={`Level ${preview.fromLevel} to ${preview.toLevel}`} onClose={onClose}>
        <p role="alert">
          <b>This content does not describe level {preview.toLevel}.</b>
        </p>
        <p className="m2-muted">
          {preview.coverage.classLabel ?? "This class"}
          {preview.coverage.progressionMax === undefined
            ? " has no progression for the next level."
            : ` defines its progression up to level ${preview.coverage.progressionMax}.`}{" "}
          Nothing has been changed. Install a pack that covers the next level, or keep playing at level{" "}
          {preview.fromLevel}.
        </p>
        <p className="m2-muted">Every value on the sheet stays exactly as it is.</p>
      </Dialog>
    );

  const outstanding = preview.newChoices.filter(choice => !choice.resolved);
  const subclassOutstanding = preview.subclass?.unresolved === true && !subclassId;

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
            disabled={outstanding.length > 0 || subclassOutstanding}
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
      <div className="m2-scroller" tabIndex={0} role="group" aria-label="Automatic gains comparison, scrollable">
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
      </div>

      <h4>Current and maximum values</h4>
      <p className="m2-policy">Policy: {preview.policyLabel}. Your current value moves by the same amount as the maximum.</p>
      <div className="m2-scroller" tabIndex={0} role="group" aria-label="Current and maximum comparison, scrollable">
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
      </div>

      {/*
       * What the level actually adds, named. A level whose only visible change
       * was a hit die used to read as a bug; now it either lists real gains or
       * says outright that there are none.
       */}
      <h4>What you gain</h4>
      <GainList label="Features" items={preview.gainedFeatures} />
      <GainList label="Actions" items={preview.gainedActions} />
      <GainList label="Resources" items={preview.gainedResources} />
      {preview.onlyHitDice ? (
        <p className="m2-muted">
          This level adds no feature, action, resource or choice. Only your hit dice and the values that follow from the
          new level change.
        </p>
      ) : null}

      {preview.subclass?.reached && preview.subclass.options.length ? (
        <>
          <h4>Subclass</h4>
          <p className="m2-muted">
            {preview.subclass.classLabel} chooses its subclass at level {preview.subclass.atLevel}.
          </p>
          <ul className="m2-options">
            {preview.subclass.options.map(option => {
              const chosen = (subclassId ?? preview.subclass?.selectedId) === option.id;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className={chosen ? "m2-option m2-option-selected" : "m2-option"}
                    aria-pressed={chosen}
                    onClick={() => setSubclassId(option.id)}
                  >
                    <span className="m2-option-mark" aria-hidden="true">
                      {chosen ? "✓" : "○"}
                    </span>
                    <span>
                      <b>{option.label}</b>
                      {option.summary ? <small>{option.summary}</small> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

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
      {subclassOutstanding ? (
        <p className="m2-inline-issue" role="status">
          Choose a subclass before confirming.
        </p>
      ) : null}
    </Dialog>
  );
}

/** One named group of gains, omitted entirely when the level adds none. */
function GainList({ label, items }: { label: string; items: readonly GainedEntryView[] }) {
  if (!items.length) return null;
  return (
    <>
      <h5>{label}</h5>
      <ul className="m2-plain-list">
        {items.map(item => (
          <li key={item.id}>
            <b>{item.label}</b>
            {item.summary ? <> — {item.summary}</> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
