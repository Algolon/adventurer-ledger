"use client";

/**
 * The active mobile-first character sheet.
 *
 * Play actions commit exactly one runtime mutation each and offer Undo. Editing
 * a maximum is a separate Manage action, never part of a damage or heal control.
 * Every value can open a details surface that explains its base inputs, applied
 * contributors, source IDs, active ruleset and override; the dialog restores
 * focus and scroll position on close. Attack details expose the roll expression
 * and a Copy expression control — there is no Roll control and no random result.
 */
import { useCallback, useMemo, useState } from "react";
import { Heart, Minus, Plus, RotateCcw, Settings2, Shield, Undo2, Zap } from "lucide-react";
import { useAsync, useServices } from "@/src/ui/services-context";
import { ContributorList, CopyExpression, DerivedNumber, Dialog, StateBadge, formatDerived } from "@/src/ui/primitives";
import type { DerivedAction, DerivedCharacterSheet, DerivedValue } from "@/src/services/derived-resolver";
import type { RuntimeOperation } from "@/src/services/runtime-service";

type DetailTarget =
  | { kind: "value"; label: string; value: DerivedValue }
  | { kind: "action"; action: DerivedAction }
  | { kind: "manage" };

export function PlaySheet({
  characterId,
  onLevelUp,
  onEdit,
}: {
  characterId: string;
  onLevelUp(): void;
  onEdit(): void;
}) {
  const { query, runtime, refresh } = useServices();
  const state = useAsync(() => query.sheet(characterId), [characterId]);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(1);

  const sheet = state.status === "ready" ? state.value : undefined;

  const applyRuntime = useCallback(
    async (operation: RuntimeOperation, describe: (result: number) => string) => {
      if (!sheet || sheet.runtimeRevision === null) return;
      const outcome = await runtime.apply({
        characterId,
        expectedRuntimeRevision: sheet.runtimeRevision,
        operationId: `ui:${characterId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        operation,
      });
      if (outcome.status === "ok") {
        setStatus(describe(outcome.result.runtime.currentHitPoints));
        setCanUndo(outcome.result.undoable);
        refresh();
      } else if (outcome.status === "stale") {
        setStatus("This character changed elsewhere. The sheet has been refreshed.");
        setCanUndo(false);
        refresh();
      } else {
        setStatus("That action could not be applied.");
      }
    },
    [characterId, refresh, runtime, sheet],
  );

  const undo = useCallback(async () => {
    if (!sheet || sheet.runtimeRevision === null) return;
    const outcome = await runtime.undoLast(characterId, sheet.runtimeRevision, `ui:undo:${Date.now()}`);
    setStatus(outcome.status === "ok" ? "Last action undone." : "There is nothing to undo.");
    setCanUndo(false);
    refresh();
  }, [characterId, refresh, runtime, sheet]);

  const favourite = useMemo(() => sheet?.actions.find(action => action.kind === "attack") ?? sheet?.actions[0], [sheet]);

  if (state.status === "loading")
    return (
      <section className="m2-page" aria-busy="true">
        <p role="status">Opening the sheet…</p>
      </section>
    );
  if (state.status === "failed" || !sheet)
    return (
      <section className="m2-page">
        <div className="m2-banner m2-banner-error" role="alert">
          <strong>This character could not be opened</strong>
          <p>Its record is still stored on this device.</p>
        </div>
      </section>
    );

  const missingSource = sheet.missingDependencyIds.length > 0;

  return (
    <section className="m2-page m2-sheet">
      {/* One highest-priority banner per surface. */}
      {missingSource ? (
        <div className="m2-banner m2-banner-warning" role="alert">
          <strong>Missing source</strong>
          <p>
            Some definitions this character uses are not installed, so affected values are marked uncertain. The last safe
            snapshot is still shown. Missing: {sheet.missingDependencyIds.join(", ")}.
          </p>
          <p className="m2-muted">Re-enable or import the source, or continue read-only. Nothing is substituted for you.</p>
        </div>
      ) : sheet.completeness === "incomplete" ? (
        <div className="m2-banner m2-banner-warning" role="alert">
          <strong>Incomplete character</strong>
          <p>Some required values are not resolved yet. They show as — with the action that resolves them.</p>
        </div>
      ) : null}

      <header className="m2-sheet-head">
        <div>
          <h2>{sheet.name}</h2>
          <p className="m2-muted">
            {sheet.classLabel ? `${sheet.classLabel} ${sheet.level}` : `Level ${sheet.level}`}
            {sheet.speciesLabel ? ` · ${sheet.speciesLabel}` : ""}
            {sheet.nickname ? ` · “${sheet.nickname}”` : ""}
          </p>
          <p>
            <StateBadge state={missingSource ? "missing-source" : sheet.mode === "manual" ? "manual" : "automatic"} />
            {sheet.mode === "manual" ? (
              <span className="m2-muted"> This sheet uses values you entered. It is not automatically rules-justified.</span>
            ) : null}
          </p>
        </div>
        <div className="m2-sheet-head-actions">
          <button type="button" className="m2-button" onClick={onEdit}>
            Edit build
          </button>
          <button type="button" className="m2-button" onClick={onLevelUp}>
            Level up
          </button>
        </div>
      </header>

      <div className="m2-stat-row">
        <StatTile
          label="Armour class"
          icon={<Shield aria-hidden="true" />}
          value={sheet.armorClass}
          onOpen={() => setDetail({ kind: "value", label: "Armour class", value: sheet.armorClass })}
        />
        <StatTile
          label="Initiative"
          value={sheet.initiative}
          style="signed"
          onOpen={() => setDetail({ kind: "value", label: "Initiative", value: sheet.initiative })}
        />
        <StatTile
          label="Speed"
          value={sheet.speed}
          onOpen={() => setDetail({ kind: "value", label: "Speed", value: sheet.speed })}
        />
        <StatTile
          label="Proficiency"
          value={sheet.proficiencyBonus}
          style="signed"
          onOpen={() => setDetail({ kind: "value", label: "Proficiency bonus", value: sheet.proficiencyBonus })}
        />
      </div>

      <section className="m2-card" aria-labelledby="hp-heading">
        <div className="m2-card-head">
          <h3 id="hp-heading">
            <Heart aria-hidden="true" /> Hit points
          </h3>
          <button type="button" className="m2-button m2-button-small" onClick={() => setDetail({ kind: "manage" })}>
            <Settings2 aria-hidden="true" />
            Manage
          </button>
        </div>
        <p className="m2-big-value">
          <DerivedNumber value={sheet.hitPoints.current} label="Current hit points" /> /{" "}
          <DerivedNumber value={sheet.hitPoints.maximum} label="Maximum hit points" />
          {sheet.hitPoints.temporary > 0 ? <span className="m2-badge"> +{sheet.hitPoints.temporary} temporary</span> : null}
        </p>
        <div className="m2-amount-row">
          <label className="m2-field m2-field-inline">
            <span>Amount</span>
            <input
              type="number"
              min={1}
              max={99}
              value={pendingAmount}
              onChange={event => setPendingAmount(Math.max(1, Number(event.target.value) || 1))}
            />
          </label>
          <p className="m2-muted" aria-live="polite">
            Preview: {previewHitPoints(sheet, -pendingAmount)} after damage, {previewHitPoints(sheet, pendingAmount)} after
            healing.
          </p>
        </div>
        <div className="m2-play-row">
          <button
            type="button"
            className="m2-play-action"
            onClick={() => void applyRuntime({ kind: "damage", amount: pendingAmount }, hp => `Took ${pendingAmount} damage. Now ${hp} hit points.`)}
            aria-label={`Apply ${pendingAmount} damage to ${sheet.name}`}
          >
            <Minus aria-hidden="true" />
            Damage
          </button>
          <button
            type="button"
            className="m2-play-action"
            onClick={() => void applyRuntime({ kind: "heal", amount: pendingAmount }, hp => `Healed ${pendingAmount}. Now ${hp} hit points.`)}
            aria-label={`Heal ${sheet.name} by ${pendingAmount}`}
          >
            <Plus aria-hidden="true" />
            Heal
          </button>
          <button
            type="button"
            className="m2-play-action"
            onClick={() => void applyRuntime({ kind: "short-rest" }, () => "Short rest applied.")}
            aria-label={`Apply a short rest to ${sheet.name}`}
          >
            <RotateCcw aria-hidden="true" />
            Short rest
          </button>
          <button
            type="button"
            className="m2-play-action"
            onClick={() => void undo()}
            disabled={!canUndo}
            aria-label={`Undo the last play action for ${sheet.name}`}
          >
            <Undo2 aria-hidden="true" />
            Undo
          </button>
        </div>
        <p className="m2-status" role="status" aria-live="polite">
          {status ?? ""}
        </p>
      </section>

      {sheet.resources.length ? (
        <section className="m2-card" aria-labelledby="resource-heading">
          <div className="m2-card-head">
            <h3 id="resource-heading">
              <Zap aria-hidden="true" /> Resources
            </h3>
          </div>
          {sheet.resources.map(resource => (
            <div key={resource.id} className="m2-resource">
              <p>
                <b>{resource.label}</b>{" "}
                <span>
                  <DerivedNumber value={resource.current} label={`${resource.label} remaining`} /> /{" "}
                  <DerivedNumber value={resource.maximum} label={`${resource.label} maximum`} />
                </span>
                <small className="m2-muted"> recharges on a {resource.recharge.replace("-", " ")}</small>
              </p>
              <div className="m2-play-row">
                <button
                  type="button"
                  className="m2-play-action"
                  disabled={resource.current.value !== null && resource.current.value <= 0}
                  onClick={() =>
                    void applyRuntime({ kind: "resource-spend", resourceId: resource.id, amount: 1 }, () => `Spent one ${resource.label}.`)
                  }
                  aria-label={`Spend one ${resource.label}`}
                >
                  <Minus aria-hidden="true" />
                  Spend
                </button>
                <button
                  type="button"
                  className="m2-play-action"
                  disabled={
                    resource.current.value !== null && resource.maximum.value !== null && resource.current.value >= resource.maximum.value
                  }
                  onClick={() =>
                    void applyRuntime({ kind: "resource-recover", resourceId: resource.id, amount: 1 }, () => `Recovered one ${resource.label}.`)
                  }
                  aria-label={`Recover one ${resource.label}`}
                >
                  <Plus aria-hidden="true" />
                  Recover
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {favourite ? (
        <section className="m2-card" aria-labelledby="action-heading">
          <div className="m2-card-head">
            <h3 id="action-heading">Actions</h3>
          </div>
          <ul className="m2-plain-list">
            {sheet.actions.map(action => (
              <li key={action.id} className="m2-action-row">
                <button type="button" className="m2-action-open" onClick={() => setDetail({ kind: "action", action })}>
                  <b>{action.label}</b>
                  <span>
                    {formatDerived(action.attackBonus, "signed")} to hit
                    {action.damageExpression ? ` · ${action.damageExpression}` : ""}
                  </span>
                  <span className="m2-visually-hidden">Open details for {action.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="m2-card" aria-labelledby="checks-heading">
        <div className="m2-card-head">
          <h3 id="checks-heading">Saves and checks</h3>
        </div>
        <ul className="m2-check-list">
          {[...sheet.saves, ...sheet.checks].map(entry => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setDetail({ kind: "value", label: entry.label, value: entry.total })}
                aria-label={`Explain ${entry.label}, ${formatDerived(entry.total, "signed")}`}
              >
                <span>
                  {entry.label}
                  {entry.proficient ? <span className="m2-badge">Proficient</span> : null}
                </span>
                <b>
                  <DerivedNumber value={entry.total} label={entry.label} style="signed" />
                </b>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {sheet.equipment.length ? (
        <section className="m2-card" aria-labelledby="equipment-heading">
          <div className="m2-card-head">
            <h3 id="equipment-heading">Equipment</h3>
          </div>
          <ul className="m2-plain-list">
            {sheet.equipment.map(item => (
              <li key={item.itemId}>
                {item.label} <small className="m2-muted">{item.status}</small>
                {item.armorContribution !== undefined ? <span className="m2-badge">AC {item.armorContribution}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="m2-muted m2-ruleset-note">
        Active ruleset {sheet.activeRulesetLabel ?? sheet.activeRulesetId} · sources {sheet.activeSourceIds.join(", ")} ·{" "}
        {sheet.confidence === "calculated" ? "values calculated locally" : "some values uncertain"}
      </p>

      {detail ? <DetailDialog sheet={sheet} detail={detail} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}

function previewHitPoints(sheet: DerivedCharacterSheet, delta: number): string {
  const current = sheet.hitPoints.current.value;
  const maximum = sheet.hitPoints.maximum.value;
  if (current === null || maximum === null) return "—";
  return String(Math.max(0, Math.min(maximum, current + delta)));
}

function StatTile({
  label,
  value,
  icon,
  style = "plain",
  onOpen,
}: {
  label: string;
  value: DerivedValue;
  icon?: React.ReactNode;
  style?: "plain" | "signed";
  onOpen(): void;
}) {
  return (
    <button type="button" className="m2-stat" onClick={onOpen} aria-label={`Explain ${label}, ${formatDerived(value, style)}`}>
      <span className="m2-stat-label">
        {icon}
        {label}
      </span>
      <span className="m2-stat-value">
        <DerivedNumber value={value} label={label} style={style} />
      </span>
    </button>
  );
}

function DetailDialog({
  sheet,
  detail,
  onClose,
}: {
  sheet: DerivedCharacterSheet;
  detail: DetailTarget;
  onClose(): void;
}) {
  if (detail.kind === "manage")
    return (
      <Dialog title="Manage hit points" onClose={onClose}>
        <p>
          The maximum is calculated from the class and Constitution. To change it, edit the build or add a typed override —
          both are separate from the damage and healing controls on the sheet.
        </p>
        <ContributorList contributors={sheet.hitPoints.maximum.contributors} />
      </Dialog>
    );

  if (detail.kind === "action") {
    const action = detail.action;
    return (
      <Dialog title={action.label} onClose={onClose}>
        <dl className="m2-summary">
          <div>
            <dt>Attack</dt>
            <dd>{formatDerived(action.attackBonus, "signed")}</dd>
          </div>
          {action.range ? (
            <div>
              <dt>Range</dt>
              <dd>{action.range}</dd>
            </div>
          ) : null}
        </dl>
        {action.attackExpression ? <CopyExpression expression={action.attackExpression} label={`${action.label} attack`} /> : null}
        {action.damageExpression ? <CopyExpression expression={action.damageExpression} label={`${action.label} damage`} /> : null}
        <h4>Attack contributors</h4>
        <ContributorList contributors={action.attackBonus.contributors} />
        <h4>Damage contributors</h4>
        <ContributorList contributors={action.damageContributors} />
        <p className="m2-muted">
          Active ruleset {sheet.activeRulesetLabel ?? sheet.activeRulesetId}
          {action.masteryId ? ` · mastery ${action.masteryId}` : ""}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog title={detail.label} onClose={onClose}>
      <p className="m2-big-value">
        <DerivedNumber value={detail.value} label={detail.label} />
      </p>
      {detail.value.recovery ? (
        <p className="m2-banner m2-banner-warning" role="status">
          This value cannot be calculated yet. {detail.value.recovery.action}. Field: {detail.value.recovery.fieldPath}.
        </p>
      ) : null}
      <ContributorList contributors={detail.value.contributors} />
      {detail.value.override ? (
        <p>
          Override {detail.value.override.operation} {detail.value.override.value}; automatic baseline{" "}
          {detail.value.override.automaticBaseline ?? "—"}
          {detail.value.override.stale ? " · the baseline moved, so this override needs review" : ""}.
        </p>
      ) : null}
      <p className="m2-muted">Active ruleset {sheet.activeRulesetLabel ?? sheet.activeRulesetId}</p>
    </Dialog>
  );
}
