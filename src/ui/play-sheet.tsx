"use client";

/**
 * The play-first character sheet.
 *
 * The sheet is Play mode: it mutates transient session state only — hit points,
 * temporary hit points, hit dice, death saves, conditions, exhaustion,
 * inspiration, spell slots and limited-use resources — one runtime mutation per
 * action, with Undo. Permanent character data changes go through the single
 * Edit character action, which opens the builder.
 *
 * Presentation follows a clean paper sheet, not a rules console: no override
 * editors, no expressions, no ruleset, source or pack identifiers, and no
 * engine vocabulary. Every headline number can open a details drawer with a
 * human-readable breakdown of what went into it.
 *
 * Structure: a glance header (identity, hit points, armour class, initiative,
 * speed, proficiency, conditions, exhaustion, inspiration) over five sections —
 * Overview, Actions, Spells (only for casters), Inventory and Character.
 * Sections without trustworthy data are hidden rather than filled in.
 */
import { useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import {
  Backpack,
  Heart,
  Minus,
  Pencil,
  Plus,
  ScrollText,
  Sparkles,
  Swords,
  Undo2,
  UserRound,
} from "lucide-react";
import { useAsync, useServices } from "@/src/ui/services-context";
import { Breakdown, Dialog, DerivedNumber, formatDerived, signed } from "@/src/ui/primitives";
import type {
  DerivedAction,
  DerivedCharacterSheet,
  DerivedFeature,
  DerivedResource,
  DerivedSpell,
  DerivedValue,
} from "@/src/services/derived-resolver";
import type { CharacterRuntimeStateRecord } from "@/src/domain/character-record";
import type { RuntimeOperation } from "@/src/services/runtime-service";

type SheetTab = "overview" | "actions" | "spells" | "inventory" | "character";

type Drawer =
  | { kind: "value"; label: string; value: DerivedValue; hint?: string }
  | { kind: "ability"; label: string; score: DerivedValue; modifier: DerivedValue }
  | { kind: "action"; action: DerivedAction }
  | { kind: "spell"; spell: DerivedSpell }
  | { kind: "feature"; feature: DerivedFeature }
  | { kind: "condition"; conditionId: string; label: string; summary?: string }
  | { kind: "state" }
  | { kind: "hp" };

const ABILITY_LABELS: readonly { key: keyof DerivedCharacterSheet["abilities"]; label: string; short: string }[] = [
  { key: "strength", label: "Strength", short: "STR" },
  { key: "dexterity", label: "Dexterity", short: "DEX" },
  { key: "constitution", label: "Constitution", short: "CON" },
  { key: "intelligence", label: "Intelligence", short: "INT" },
  { key: "wisdom", label: "Wisdom", short: "WIS" },
  { key: "charisma", label: "Charisma", short: "CHA" },
];

const ACTION_GROUPS: readonly { kind: DerivedAction["kind"]; label: string }[] = [
  { kind: "attack", label: "Attacks" },
  { kind: "action", label: "Actions" },
  { kind: "bonus-action", label: "Bonus actions" },
  { kind: "reaction", label: "Reactions" },
];

export function PlaySheet({
  characterId,
  onLevelUp,
  onEdit,
}: {
  characterId: string;
  onLevelUp(): void;
  onEdit(): void;
}) {
  const { query, runtime, levelUp, refresh } = useServices();
  const state = useAsync(() => query.sheet(characterId), [characterId]);
  const [tab, setTab] = useState<SheetTab>("overview");
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);

  const sheet = state.status === "ready" ? state.value : undefined;

  const applyRuntime = useCallback(
    async (operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string) => {
      if (!sheet || sheet.runtimeRevision === null) return;
      const outcome = await runtime.apply({
        characterId,
        expectedRuntimeRevision: sheet.runtimeRevision,
        operationId: `ui:${characterId}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        operation,
      });
      if (outcome.status === "ok") {
        setStatus(describe(outcome.result.runtime));
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

  const historyState = useAsync(() => query.history(characterId), [characterId]);
  const restorePoints = historyState.status === "ready" ? historyState.value.snapshots : [];

  const restore = useCallback(
    async (snapshotId: string) => {
      if (!sheet) return;
      const outcome = await levelUp.restore(characterId, snapshotId, sheet.characterRevision, `ui:restore:${Date.now()}`);
      setStatus(outcome.status === "ok" ? "Restored. The change it reverses is still in history." : "That restore point could not be applied.");
      refresh();
    },
    [characterId, levelUp, refresh, sheet],
  );

  /*
   * The sections, and how many of them there are.
   *
   * The count matters to the layout, not just to this list: the tab strip is a
   * fixed grid of exactly this many equal columns, so it is handed down as
   * `--sheet-tab-count`. A martial sheet gets four, a caster five, and in both
   * cases every tab is fully visible with nothing to swipe for.
   */
  const tabs = useMemo<readonly { id: SheetTab; label: string; icon: ReactNode }[]>(() => {
    if (!sheet) return [];
    return [
      { id: "overview" as const, label: "Overview", icon: <ScrollText aria-hidden="true" /> },
      { id: "actions" as const, label: "Actions", icon: <Swords aria-hidden="true" /> },
      // Spells appears only when the content actually declares spellcasting.
      ...(sheet.spellcasting
        ? [{ id: "spells" as const, label: "Spells", icon: <Sparkles aria-hidden="true" /> }]
        : []),
      { id: "inventory" as const, label: "Inventory", icon: <Backpack aria-hidden="true" /> },
      { id: "character" as const, label: "Character", icon: <UserRound aria-hidden="true" /> },
    ];
  }, [sheet]);

  const activeTab: SheetTab = tabs.some(item => item.id === tab) ? tab : "overview";

  /** Roving arrow-key movement across the tab list, per the tabs pattern. */
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === activeTab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    const next = tabs[nextIndex];
    setTab(next.id);
    document.getElementById(`sheet-tab-${next.id}`)?.focus();
  };

  if (state.status === "loading")
    return (
      <section className="m2-page sheet" aria-busy="true">
        <p role="status">Opening the sheet…</p>
      </section>
    );
  if (state.status === "failed" || !sheet)
    return (
      <section className="m2-page sheet">
        <div className="m2-banner m2-banner-error" role="alert">
          <strong>This character could not be opened</strong>
          <p>Its record is still stored on this device.</p>
        </div>
      </section>
    );

  const missingSource = sheet.missingDependencyIds.length > 0;
  const dying = sheet.hitPoints.current.value === 0;
  // Slot resources render in Spells; everything else stays in Actions.
  const slotResourceIds = new Set(sheet.spellcasting?.slotResourceIds ?? []);
  const actionResources = sheet.resources.filter(resource => !slotResourceIds.has(resource.id));
  const slotResources = sheet.resources.filter(resource => slotResourceIds.has(resource.id));

  return (
    <section className="m2-page sheet">
      {missingSource ? (
        <div className="m2-banner m2-banner-warning" role="alert">
          <strong>Some source content is missing</strong>
          <p>
            Content this character was built with is not installed, so the affected values show as uncertain. Nothing is
            substituted for you. You can re-enable or import it under Settings.
          </p>
        </div>
      ) : sheet.completeness === "incomplete" ? (
        <div className="m2-banner m2-banner-warning" role="alert">
          <strong>This character is not finished</strong>
          <p>Values that cannot be calculated yet show as —. Use Edit character to finish the build.</p>
        </div>
      ) : null}

      <header className="sheet-glance">
        <div className="sheet-identity">
          <div className="sheet-identity-text">
            <h2>{sheet.name}</h2>
            <p className="sheet-identity-line">
              {sheet.classLabel ? `${sheet.classLabel} ${sheet.level}` : `Level ${sheet.level}`}
              {sheet.subclassLabel ? ` (${sheet.subclassLabel})` : ""}
              {sheet.speciesLabel ? ` · ${sheet.speciesLabel}` : ""}
            </p>
            {sheet.mode === "manual" ? (
              <p className="sheet-quiet-note">
                <span className="m2-badge m2-badge-manual">Manual</span> This sheet uses values you entered. It is not
                automatically rules-justified.
              </p>
            ) : null}
          </div>
          <button type="button" className="m2-button sheet-edit" onClick={onEdit} aria-label={`Edit character ${sheet.name}`}>
            <Pencil aria-hidden="true" />
            Edit
          </button>
        </div>

        <div className="sheet-vitals">
          <button
            type="button"
            className={dying ? "sheet-hp sheet-hp-dying" : "sheet-hp"}
            onClick={() => setDrawer({ kind: "hp" })}
            aria-label={`Hit points ${hitPointsSummary(sheet)}. Open hit point actions`}
          >
            <span className="sheet-tile-label">
              <Heart aria-hidden="true" /> Hit points
            </span>
            <span className="sheet-hp-value">
              <DerivedNumber value={sheet.hitPoints.current} label="Current hit points" />
              <small> / {formatDerived(sheet.hitPoints.maximum)}</small>
            </span>
            {sheet.hitPoints.temporary > 0 ? <span className="sheet-hp-temp">+{sheet.hitPoints.temporary} temp</span> : null}
            {dying ? <span className="sheet-hp-state">Dying</span> : null}
          </button>
          <GlanceTile label="AC" fullLabel="Armour class" value={sheet.armorClass} onOpen={setDrawer} />
          <GlanceTile label="Init" fullLabel="Initiative" value={sheet.initiative} style="signed" onOpen={setDrawer} />
          <GlanceTile label="Speed" fullLabel="Speed" value={sheet.speed} onOpen={setDrawer} />
          <GlanceTile label="Prof" fullLabel="Proficiency bonus" value={sheet.proficiencyBonus} style="signed" onOpen={setDrawer} />
        </div>

        <div className="sheet-chips">
          <button
            type="button"
            className={sheet.inspiration ? "sheet-chip sheet-chip-on" : "sheet-chip"}
            aria-pressed={sheet.inspiration}
            onClick={() =>
              void applyRuntime(
                { kind: "inspiration-set", value: !sheet.inspiration },
                next => (next.inspiration ? "Inspiration gained." : "Inspiration spent."),
              )
            }
          >
            <Sparkles aria-hidden="true" />
            Inspiration
          </button>
          {sheet.exhaustion > 0 ? (
            <button
              type="button"
              className="sheet-chip sheet-chip-warn"
              onClick={() => setDrawer({ kind: "state" })}
              aria-label={`Exhaustion level ${sheet.exhaustion}. Open conditions and exhaustion`}
            >
              Exhaustion {sheet.exhaustion}
            </button>
          ) : null}
          {sheet.conditions.map(condition => (
            <button
              key={condition.conditionId}
              type="button"
              className="sheet-chip sheet-chip-warn"
              onClick={() =>
                setDrawer({
                  kind: "condition",
                  conditionId: condition.conditionId,
                  label: condition.label,
                  ...(condition.summary ? { summary: condition.summary } : {}),
                })
              }
              aria-label={`${condition.label} condition. Open details`}
            >
              {condition.label}
            </button>
          ))}
          <button type="button" className="sheet-chip sheet-chip-add" onClick={() => setDrawer({ kind: "state" })}>
            <Plus aria-hidden="true" />
            Condition
          </button>
        </div>

        <p className="sheet-receipt" role="status" aria-live="polite">
          {status ?? ""}
          {status && canUndo ? (
            <button type="button" className="sheet-undo" onClick={() => void undo()}>
              <Undo2 aria-hidden="true" />
              Undo
            </button>
          ) : null}
        </p>
      </header>

      {dying ? (
        <section className="sheet-card sheet-dying" aria-labelledby="dying-heading">
          <h3 id="dying-heading">Death saves</h3>
          <div className="sheet-death-tallies">
            <DeathTally label="Successes" count={sheet.deathSaves.successes} />
            <DeathTally label="Failures" count={sheet.deathSaves.failures} />
          </div>
          <div className="sheet-row-actions">
            <button
              type="button"
              className="m2-play-action"
              onClick={() => void applyRuntime({ kind: "death-save", result: "success" }, () => "Death save success recorded.")}
            >
              Success
            </button>
            <button
              type="button"
              className="m2-play-action"
              onClick={() => void applyRuntime({ kind: "death-save", result: "failure" }, () => "Death save failure recorded.")}
            >
              Failure
            </button>
            <button
              type="button"
              className="m2-play-action"
              onClick={() => void applyRuntime({ kind: "death-saves-clear" }, () => "Death saves reset.")}
            >
              Reset
            </button>
          </div>
        </section>
      ) : null}

      <div
        className="sheet-tabs"
        role="tablist"
        aria-label="Character sheet sections"
        onKeyDown={onTabKeyDown}
        style={{ "--sheet-tab-count": tabs.length } as CSSProperties}
      >
        {tabs.map(item => (
          <button
            key={item.id}
            id={`sheet-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === item.id}
            aria-controls={`sheet-panel-${item.id}`}
            tabIndex={activeTab === item.id ? 0 : -1}
            className={activeTab === item.id ? "sheet-tab sheet-tab-active" : "sheet-tab"}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div id={`sheet-panel-${activeTab}`} role="tabpanel" aria-labelledby={`sheet-tab-${activeTab}`} className="sheet-panel">
        {activeTab === "overview" ? <OverviewPanel sheet={sheet} onOpen={setDrawer} /> : null}
        {activeTab === "actions" ? (
          <ActionsPanel sheet={sheet} resources={actionResources} onOpen={setDrawer} applyRuntime={applyRuntime} />
        ) : null}
        {activeTab === "spells" && sheet.spellcasting ? (
          <SpellsPanel sheet={sheet} slots={slotResources} onOpen={setDrawer} applyRuntime={applyRuntime} />
        ) : null}
        {activeTab === "inventory" ? <InventoryPanel sheet={sheet} /> : null}
        {activeTab === "character" ? (
          <CharacterPanel
            sheet={sheet}
            restorePoints={restorePoints}
            onOpen={setDrawer}
            onEdit={onEdit}
            onLevelUp={onLevelUp}
            onRestore={id => void restore(id)}
          />
        ) : null}
      </div>

      {drawer ? (
        <SheetDrawer sheet={sheet} drawer={drawer} onClose={() => setDrawer(null)} applyRuntime={applyRuntime} undo={undo} canUndo={canUndo} />
      ) : null}
    </section>
  );
}

function hitPointsSummary(sheet: DerivedCharacterSheet): string {
  const current = formatDerived(sheet.hitPoints.current);
  const maximum = formatDerived(sheet.hitPoints.maximum);
  const temp = sheet.hitPoints.temporary > 0 ? ` plus ${sheet.hitPoints.temporary} temporary` : "";
  return `${current} of ${maximum}${temp}`;
}

function GlanceTile({
  label,
  fullLabel,
  value,
  style = "plain",
  onOpen,
}: {
  label: string;
  fullLabel: string;
  value: DerivedValue;
  style?: "plain" | "signed";
  onOpen(drawer: Drawer): void;
}) {
  return (
    <button
      type="button"
      className="sheet-tile"
      onClick={() => onOpen({ kind: "value", label: fullLabel, value })}
      aria-label={`${fullLabel} ${formatDerived(value, style)}. Open details`}
    >
      <span className="sheet-tile-label">{label}</span>
      <span className="sheet-tile-value">
        <DerivedNumber value={value} label={fullLabel} style={style} />
      </span>
    </button>
  );
}

function DeathTally({ label, count }: { label: string; count: number }) {
  return (
    <p className="sheet-death-tally">
      <span>{label}</span>
      <span aria-label={`${count} of 3`}>
        {[0, 1, 2].map(index => (
          <span key={index} className={index < count ? "sheet-pip sheet-pip-filled" : "sheet-pip"} aria-hidden="true" />
        ))}
      </span>
    </p>
  );
}

/** Overview: abilities, saving throws and skills. */
function OverviewPanel({ sheet, onOpen }: { sheet: DerivedCharacterSheet; onOpen(drawer: Drawer): void }) {
  return (
    <>
      <section className="sheet-card" aria-labelledby="abilities-heading">
        <h3 id="abilities-heading">Abilities</h3>
        <div className="sheet-abilities">
          {ABILITY_LABELS.map(({ key, label, short }) => {
            const ability = sheet.abilities[key];
            return (
              <button
                key={key}
                type="button"
                className="sheet-ability"
                onClick={() => onOpen({ kind: "ability", label, score: ability.score, modifier: ability.modifier })}
                aria-label={`${label} ${formatDerived(ability.modifier, "signed")}, score ${formatDerived(ability.score)}. Open details`}
              >
                <span className="sheet-tile-label">{short}</span>
                <span className="sheet-tile-value">
                  <DerivedNumber value={ability.modifier} label={`${label} modifier`} style="signed" />
                </span>
                <span className="sheet-ability-score">{formatDerived(ability.score)}</span>
              </button>
            );
          })}
        </div>
      </section>

      {sheet.saves.length ? (
        <section className="sheet-card" aria-labelledby="saves-heading">
          <h3 id="saves-heading">Saving throws</h3>
          <CheckList entries={sheet.saves} onOpen={onOpen} />
        </section>
      ) : null}

      {sheet.checks.length ? (
        <section className="sheet-card" aria-labelledby="skills-heading">
          <h3 id="skills-heading">Skills</h3>
          <CheckList entries={sheet.checks} onOpen={onOpen} />
        </section>
      ) : null}
    </>
  );
}

function CheckList({
  entries,
  onOpen,
}: {
  entries: DerivedCharacterSheet["saves"];
  onOpen(drawer: Drawer): void;
}) {
  return (
    <ul className="sheet-checks">
      {entries.map(entry => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onOpen({ kind: "value", label: entry.label, value: entry.total })}
            aria-label={`${entry.label} ${formatDerived(entry.total, "signed")}${entry.proficient ? ", proficient" : ""}. Open details`}
          >
            <span className={entry.proficient ? "sheet-prof-dot sheet-prof-dot-on" : "sheet-prof-dot"} aria-hidden="true" />
            <span className="sheet-check-label">{entry.label}</span>
            <b>
              <DerivedNumber value={entry.total} label={entry.label} style="signed" />
            </b>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Actions: attacks and other granted actions, then limited-use resources. */
function ActionsPanel({
  sheet,
  resources,
  onOpen,
  applyRuntime,
}: {
  sheet: DerivedCharacterSheet;
  resources: readonly DerivedResource[];
  onOpen(drawer: Drawer): void;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
}) {
  const groups = ACTION_GROUPS.map(group => ({
    ...group,
    actions: sheet.actions.filter(action => action.kind === group.kind),
  })).filter(group => group.actions.length > 0);

  return (
    <>
      {groups.map(group => (
        <section key={group.kind} className="sheet-card" aria-labelledby={`actions-${group.kind}-heading`}>
          <h3 id={`actions-${group.kind}-heading`}>{group.label}</h3>
          <ul className="sheet-rows">
            {group.actions.map(action => {
              const facts = [
                action.attackBonus.value !== null ? `${signed(action.attackBonus.value)} to hit` : null,
                action.damageExpression,
                action.range,
              ].filter(Boolean) as string[];
              return (
                <li key={action.id}>
                  {/* One accessible name, so the row's purpose is announced once. */}
                  <button
                    type="button"
                    className="sheet-row"
                    onClick={() => onOpen({ kind: "action", action })}
                    aria-label={`${action.label}${facts.length ? `, ${facts.join(", ")}` : ""}. Open details`}
                  >
                    <span className="sheet-row-title">{action.label}</span>
                    <span className="sheet-row-meta">{facts.join(" · ")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {groups.length === 0 ? (
        <section className="sheet-card">
          <h3>Actions</h3>
          <p className="m2-muted">No actions can be shown yet. Use Edit character to finish the build.</p>
        </section>
      ) : null}

      {resources.length ? (
        <section className="sheet-card" aria-labelledby="resources-heading">
          <h3 id="resources-heading">Resources</h3>
          {resources.map(resource => (
            <ResourceRow key={resource.id} resource={resource} applyRuntime={applyRuntime} />
          ))}
        </section>
      ) : null}
    </>
  );
}

function ResourceRow({
  resource,
  applyRuntime,
}: {
  resource: DerivedResource;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
}) {
  const empty = resource.current.value !== null && resource.current.value <= 0;
  const full =
    resource.current.value !== null && resource.maximum.value !== null && resource.current.value >= resource.maximum.value;
  return (
    <div className="sheet-resource">
      <span className="sheet-row-title">{resource.label}</span>
      <span className="sheet-resource-count">
        <DerivedNumber value={resource.current} label={`${resource.label} remaining`} /> /{" "}
        <DerivedNumber value={resource.maximum} label={`${resource.label} maximum`} />
      </span>
      <span className="sheet-resource-recharge">{rechargeLabel(resource.recharge)}</span>
      <span className="sheet-stepper">
        <button
          type="button"
          disabled={empty}
          onClick={() =>
            void applyRuntime(
              { kind: "resource-spend", resourceId: resource.id, amount: 1 },
              next => `${resource.label}: ${next.resourceUses[resource.id] ?? 0} left.`,
            )
          }
          aria-label={`Spend one ${resource.label}, ${formatDerived(resource.current)} of ${formatDerived(resource.maximum)} left`}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          disabled={full}
          onClick={() =>
            void applyRuntime(
              { kind: "resource-recover", resourceId: resource.id, amount: 1 },
              next => `${resource.label}: ${next.resourceUses[resource.id] ?? 0} left.`,
            )
          }
          aria-label={`Recover one ${resource.label}, ${formatDerived(resource.current)} of ${formatDerived(resource.maximum)} left`}
        >
          <Plus aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function rechargeLabel(recharge: string): string {
  switch (recharge) {
    case "short-rest":
      return "Back on a short rest";
    case "long-rest":
      return "Back on a long rest";
    case "dawn":
      return "Back at dawn";
    default:
      return "";
  }
}

/** Spells: casting summary, slots, then the known spells by level. */
function SpellsPanel({
  sheet,
  slots,
  onOpen,
  applyRuntime,
}: {
  sheet: DerivedCharacterSheet;
  slots: readonly DerivedResource[];
  onOpen(drawer: Drawer): void;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
}) {
  const casting = sheet.spellcasting;
  if (!casting) return null;
  const levels = [...new Set(casting.spells.map(spell => spell.level))].sort((left, right) => left - right);

  return (
    <>
      <section className="sheet-card" aria-labelledby="casting-heading">
        <h3 id="casting-heading">Casting</h3>
        <div className="sheet-casting">
          <p className="sheet-casting-fact">
            <span className="sheet-tile-label">Ability</span>
            <span className="sheet-tile-value">{casting.abilityLabel}</span>
          </p>
          {casting.spellAttack ? (
            <button
              type="button"
              className="sheet-tile"
              onClick={() => onOpen({ kind: "value", label: "Spell attack", value: casting.spellAttack! })}
              aria-label={`Spell attack ${formatDerived(casting.spellAttack, "signed")}. Open details`}
            >
              <span className="sheet-tile-label">Spell attack</span>
              <span className="sheet-tile-value">
                <DerivedNumber value={casting.spellAttack} label="Spell attack" style="signed" />
              </span>
            </button>
          ) : null}
          {casting.saveDc ? (
            <button
              type="button"
              className="sheet-tile"
              onClick={() => onOpen({ kind: "value", label: "Save DC", value: casting.saveDc! })}
              aria-label={`Save DC ${formatDerived(casting.saveDc)}. Open details`}
            >
              <span className="sheet-tile-label">Save DC</span>
              <span className="sheet-tile-value">
                <DerivedNumber value={casting.saveDc} label="Save DC" />
              </span>
            </button>
          ) : null}
        </div>
        {slots.map(slot => (
          <ResourceRow key={slot.id} resource={slot} applyRuntime={applyRuntime} />
        ))}
      </section>

      {levels.map(level => (
        <section key={level} className="sheet-card" aria-labelledby={`spells-level-${level}-heading`}>
          <h3 id={`spells-level-${level}-heading`}>{level === 0 ? "Cantrips" : `Level ${level}`}</h3>
          <ul className="sheet-rows">
            {casting.spells
              .filter(spell => spell.level === level)
              .map(spell => {
                const facts = [spell.castingTime, spell.range, spell.concentration ? "concentration" : null].filter(
                  Boolean,
                ) as string[];
                return (
                  <li key={spell.id}>
                    <button
                      type="button"
                      className="sheet-row"
                      onClick={() => onOpen({ kind: "spell", spell })}
                      aria-label={`${spell.label}${facts.length ? `, ${facts.join(", ")}` : ""}. Open details`}
                    >
                      <span className="sheet-row-title">
                        {spell.label}
                        {spell.concentration ? <span className="sheet-badge">Concentration</span> : null}
                      </span>
                      <span className="sheet-row-meta">{[spell.castingTime, spell.range].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Inventory: equipped gear first, then everything carried. */
function InventoryPanel({ sheet }: { sheet: DerivedCharacterSheet }) {
  const equipped = sheet.equipment.filter(item => item.status === "equipped");
  const carried = sheet.equipment.filter(item => item.status !== "equipped");

  if (!sheet.equipment.length)
    return (
      <section className="sheet-card">
        <h3>Inventory</h3>
        <p className="m2-muted">Nothing is recorded yet. Use Edit character to change equipment.</p>
      </section>
    );

  return (
    <>
      {equipped.length ? (
        <section className="sheet-card" aria-labelledby="equipped-heading">
          <h3 id="equipped-heading">Equipped</h3>
          <ul className="sheet-rows">
            {equipped.map(item => (
              <li key={item.itemId} className="sheet-item">
                <span className="sheet-row-title">
                  {item.label}
                  {item.quantity > 1 ? <span className="sheet-quantity">×{item.quantity}</span> : null}
                </span>
                {item.armorContribution !== undefined ? <span className="sheet-badge">AC {item.armorContribution}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {carried.length ? (
        <section className="sheet-card" aria-labelledby="carried-heading">
          <h3 id="carried-heading">Carried</h3>
          <ul className="sheet-rows">
            {carried.map(item => (
              <li key={item.itemId} className="sheet-item">
                <span className="sheet-row-title">
                  {item.label}
                  {item.quantity > 1 ? <span className="sheet-quantity">×{item.quantity}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="sheet-quiet-note">Adding, removing or equipping items is part of Edit character.</p>
    </>
  );
}

/** Character: identity, features, proficiencies, and durable-change actions. */
function CharacterPanel({
  sheet,
  restorePoints,
  onOpen,
  onEdit,
  onLevelUp,
  onRestore,
}: {
  sheet: DerivedCharacterSheet;
  restorePoints: readonly { id: string; label: string }[];
  onOpen(drawer: Drawer): void;
  onEdit(): void;
  onLevelUp(): void;
  onRestore(snapshotId: string): void;
}) {
  const featureGroups: readonly { group: DerivedFeature["group"]; label: string }[] = [
    { group: "class", label: sheet.classLabel ? `${sheet.classLabel} features` : "Class features" },
    { group: "species", label: sheet.speciesLabel ? `${sheet.speciesLabel} traits` : "Traits" },
    { group: "background", label: "Background" },
  ];
  const proficiencyGroups: readonly { type: "armor" | "weapon" | "tool" | "language"; label: string }[] = [
    { type: "armor", label: "Armour" },
    { type: "weapon", label: "Weapons" },
    { type: "tool", label: "Tools" },
    { type: "language", label: "Languages" },
  ];

  return (
    <>
      <section className="sheet-card" aria-labelledby="about-heading">
        <h3 id="about-heading">About</h3>
        {/*
         * Class, level, subclass and species are already in the glance header,
         * so they are not restated here. This card carries what the header does
         * not have room for.
         */}
        <dl className="sheet-facts">
          {sheet.backgroundLabel ? <IdentityFact label="Background">{sheet.backgroundLabel}</IdentityFact> : null}
          {sheet.nickname ? <IdentityFact label="Nickname">“{sheet.nickname}”</IdentityFact> : null}
          {sheet.hitDice.value !== null ? (
            <IdentityFact label="Hit dice">
              {sheet.hitDiceRemaining !== null ? `${sheet.hitDiceRemaining} of ${sheet.level} (${sheet.hitDice.value})` : sheet.hitDice.value}
            </IdentityFact>
          ) : null}
        </dl>
        <div className="sheet-row-actions">
          <button type="button" className="m2-button m2-button-primary" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit character
          </button>
          <button type="button" className="m2-button" onClick={onLevelUp}>
            Level up
          </button>
        </div>
        <p className="sheet-quiet-note">Permanent changes — class, scores, equipment, choices — happen in Edit character.</p>
      </section>

      {featureGroups.map(({ group, label }) => {
        const features = sheet.features.filter(feature => feature.group === group);
        if (!features.length) return null;
        return (
          <section key={group} className="sheet-card" aria-labelledby={`features-${group}-heading`}>
            <h3 id={`features-${group}-heading`}>{label}</h3>
            <ul className="sheet-rows">
              {features.map(feature => (
                <li key={feature.id}>
                  <button
                    type="button"
                    className="sheet-row"
                    onClick={() => onOpen({ kind: "feature", feature })}
                    aria-label={`${feature.label}. Open details`}
                  >
                    <span className="sheet-row-title">{feature.label}</span>
                    {feature.summary ? <span className="sheet-row-meta">{feature.summary}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {sheet.otherProficiencies.length ? (
        <section className="sheet-card" aria-labelledby="proficiencies-heading">
          <h3 id="proficiencies-heading">Proficiencies</h3>
          <dl className="sheet-facts">
            {proficiencyGroups.map(({ type, label }) => {
              const items = sheet.otherProficiencies.filter(entry => entry.type === type);
              if (!items.length) return null;
              return (
                <IdentityFact key={type} label={label}>
                  {items.map(entry => entry.label).join(", ")}
                </IdentityFact>
              );
            })}
          </dl>
        </section>
      ) : null}

      {restorePoints.length ? (
        <section className="sheet-card" aria-labelledby="history-heading">
          <h3 id="history-heading">Restore points</h3>
          <ul className="sheet-rows">
            {restorePoints.map(point => (
              <li key={point.id} className="sheet-item">
                <span className="sheet-row-title">{point.label}</span>
                <button
                  type="button"
                  className="m2-button m2-button-small"
                  onClick={() => onRestore(point.id)}
                  aria-label={`Restore ${sheet.name} to the point named ${point.label}`}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
          <p className="sheet-quiet-note">Restoring appends to history; it never deletes the change it reverses.</p>
        </section>
      ) : null}
    </>
  );
}

function IdentityFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The one details surface. A bottom drawer on phones; focus-trapped modal. */
function SheetDrawer({
  sheet,
  drawer,
  onClose,
  applyRuntime,
  undo,
  canUndo,
}: {
  sheet: DerivedCharacterSheet;
  drawer: Drawer;
  onClose(): void;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
  undo(): Promise<void>;
  canUndo: boolean;
}) {
  if (drawer.kind === "hp")
    return (
      <Dialog title="Hit points" onClose={onClose} presentation="sheet">
        <HitPointControls sheet={sheet} applyRuntime={applyRuntime} undo={undo} canUndo={canUndo} />
      </Dialog>
    );

  if (drawer.kind === "state")
    return (
      <Dialog title="Conditions & exhaustion" onClose={onClose} presentation="sheet">
        <StateControls sheet={sheet} applyRuntime={applyRuntime} onClose={onClose} />
      </Dialog>
    );

  if (drawer.kind === "condition")
    return (
      <Dialog title={drawer.label} onClose={onClose} presentation="sheet">
        {drawer.summary ? <p>{drawer.summary}</p> : <p className="m2-muted">No description is stored for this condition.</p>}
        <button
          type="button"
          className="m2-button"
          onClick={() => {
            void applyRuntime({ kind: "condition-remove", conditionId: drawer.conditionId }, () => `Removed ${drawer.label}.`);
            onClose();
          }}
        >
          Remove {drawer.label}
        </button>
      </Dialog>
    );

  if (drawer.kind === "action") {
    const action = drawer.action;
    return (
      <Dialog title={action.label} onClose={onClose} presentation="sheet">
        <dl className="sheet-facts">
          {action.attackBonus.value !== null ? <IdentityFact label="To hit">{signed(action.attackBonus.value)}</IdentityFact> : null}
          {action.damageExpression ? <IdentityFact label="Damage">{action.damageExpression}</IdentityFact> : null}
          {action.range ? <IdentityFact label="Range">{action.range}</IdentityFact> : null}
        </dl>
        {action.attackBonus.contributors.length ? (
          <>
            <h4>To hit</h4>
            <Breakdown contributors={action.attackBonus.contributors} />
          </>
        ) : null}
        {action.damageContributors.length ? (
          <>
            <h4>Damage bonus</h4>
            <Breakdown contributors={action.damageContributors} />
          </>
        ) : null}
      </Dialog>
    );
  }

  if (drawer.kind === "spell") {
    const spell = drawer.spell;
    return (
      <Dialog title={spell.label} onClose={onClose} presentation="sheet">
        <p className="m2-muted">
          {[spell.level === 0 ? "Cantrip" : `Level ${spell.level}`, spell.school].filter(Boolean).join(" · ")}
        </p>
        <dl className="sheet-facts">
          {spell.castingTime ? <IdentityFact label="Casting time">{spell.castingTime}</IdentityFact> : null}
          {spell.range ? <IdentityFact label="Range">{spell.range}</IdentityFact> : null}
          {spell.duration ? (
            <IdentityFact label="Duration">
              {spell.duration}
              {spell.concentration ? " (concentration)" : ""}
            </IdentityFact>
          ) : null}
        </dl>
        {spell.summary ? <p>{spell.summary}</p> : null}
      </Dialog>
    );
  }

  if (drawer.kind === "feature")
    return (
      <Dialog title={drawer.feature.label} onClose={onClose} presentation="sheet">
        {drawer.feature.summary ? <p>{drawer.feature.summary}</p> : <p className="m2-muted">No description is stored for this feature.</p>}
      </Dialog>
    );

  if (drawer.kind === "ability")
    return (
      <Dialog title={drawer.label} onClose={onClose} presentation="sheet">
        <p className="sheet-drawer-value">
          <DerivedNumber value={drawer.modifier} label={`${drawer.label} modifier`} style="signed" />
          <small> modifier · score {formatDerived(drawer.score)}</small>
        </p>
        <Breakdown contributors={drawer.score.contributors} />
        {drawer.modifier.recovery ? <RecoveryNote value={drawer.modifier} /> : null}
      </Dialog>
    );

  return (
    <Dialog title={drawer.label} onClose={onClose} presentation="sheet">
      <p className="sheet-drawer-value">
        <DerivedNumber value={drawer.value} label={drawer.label} />
      </p>
      <Breakdown contributors={drawer.value.contributors} />
      {drawer.value.recovery ? <RecoveryNote value={drawer.value} /> : null}
    </Dialog>
  );
}

/** Plain-words explanation of why a value is unknown, with its next step. */
function RecoveryNote({ value }: { value: DerivedValue }) {
  if (!value.recovery) return null;
  return (
    <p className="m2-banner m2-banner-warning" role="status">
      This value cannot be calculated yet. {value.recovery.action}.
    </p>
  );
}

function HitPointControls({
  sheet,
  applyRuntime,
  undo,
  canUndo,
}: {
  sheet: DerivedCharacterSheet;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
  undo(): Promise<void>;
  canUndo: boolean;
}) {
  const [amount, setAmount] = useState(1);
  const clampAmount = (value: number) => Math.max(1, Math.min(99, Math.trunc(value) || 1));

  return (
    <div className="sheet-hp-controls">
      <p className="sheet-drawer-value">
        <DerivedNumber value={sheet.hitPoints.current} label="Current hit points" />
        <small> / {formatDerived(sheet.hitPoints.maximum)}</small>
        {sheet.hitPoints.temporary > 0 ? <span className="sheet-badge">+{sheet.hitPoints.temporary} temporary</span> : null}
      </p>

      <div className="sheet-amount">
        <button type="button" onClick={() => setAmount(current => clampAmount(current - 1))} aria-label="Decrease amount">
          <Minus aria-hidden="true" />
        </button>
        <label className="m2-visually-hidden" htmlFor="sheet-hp-amount">
          Amount
        </label>
        <input
          id="sheet-hp-amount"
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          value={amount}
          onChange={event => setAmount(clampAmount(Number(event.target.value)))}
        />
        <button type="button" onClick={() => setAmount(current => clampAmount(current + 1))} aria-label="Increase amount">
          <Plus aria-hidden="true" />
        </button>
      </div>
      <p className="m2-muted" aria-live="polite">
        {previewHitPoints(sheet, -amount)} after damage · {previewHitPoints(sheet, amount)} after healing
      </p>

      <div className="sheet-row-actions">
        <button
          type="button"
          className="m2-play-action sheet-action-damage"
          onClick={() =>
            void applyRuntime({ kind: "damage", amount }, next => `Took ${amount} damage. Now ${next.currentHitPoints} hit points.`)
          }
          aria-label={`Apply ${amount} damage to ${sheet.name}`}
        >
          Damage
        </button>
        <button
          type="button"
          className="m2-play-action sheet-action-heal"
          onClick={() =>
            void applyRuntime({ kind: "heal", amount }, next => `Healed ${amount}. Now ${next.currentHitPoints} hit points.`)
          }
          aria-label={`Heal ${sheet.name} by ${amount}`}
        >
          Heal
        </button>
        <button
          type="button"
          className="m2-play-action"
          onClick={() =>
            void applyRuntime({ kind: "temporary-hit-points", amount }, () => `Temporary hit points set to ${amount}.`)
          }
          aria-label={`Set temporary hit points to ${amount}`}
        >
          Set temp
        </button>
      </div>

      {sheet.hitDice.value !== null && sheet.hitDiceRemaining !== null ? (
        <div className="sheet-resource">
          <span className="sheet-row-title">Hit dice</span>
          <span className="sheet-resource-count">
            {sheet.hitDiceRemaining} / {sheet.level} ({sheet.hitDice.value})
          </span>
          <span className="sheet-stepper">
            <button
              type="button"
              disabled={sheet.hitDiceRemaining <= 0}
              onClick={() =>
                void applyRuntime({ kind: "hit-dice-spend", amount: 1 }, next => `Hit die spent. ${next.hitDiceRemaining} left.`)
              }
              aria-label={`Spend one hit die, ${sheet.hitDiceRemaining} of ${sheet.level} left`}
            >
              <Minus aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={sheet.hitDiceRemaining >= sheet.level}
              onClick={() =>
                void applyRuntime(
                  { kind: "hit-dice-recover", amount: 1 },
                  next => `Hit die recovered. ${next.hitDiceRemaining} available.`,
                )
              }
              aria-label={`Recover one hit die, ${sheet.hitDiceRemaining} of ${sheet.level} left`}
            >
              <Plus aria-hidden="true" />
            </button>
          </span>
        </div>
      ) : null}

      <div className="sheet-row-actions">
        <button
          type="button"
          className="m2-play-action"
          onClick={() => void applyRuntime({ kind: "short-rest" }, () => "Short rest applied.")}
          aria-label={`Apply a short rest to ${sheet.name}`}
        >
          Short rest
        </button>
        <button
          type="button"
          className="m2-play-action"
          onClick={() => void applyRuntime({ kind: "long-rest" }, () => "Long rest applied.")}
          aria-label={`Apply a long rest to ${sheet.name}`}
        >
          Long rest
        </button>
        <button
          type="button"
          className="m2-play-action"
          disabled={!canUndo}
          onClick={() => void undo()}
          aria-label={`Undo the last play action for ${sheet.name}`}
        >
          <Undo2 aria-hidden="true" />
          Undo
        </button>
      </div>
      <p className="sheet-quiet-note">Changing the hit point maximum is part of Edit character.</p>
    </div>
  );
}

function StateControls({
  sheet,
  applyRuntime,
  onClose,
}: {
  sheet: DerivedCharacterSheet;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
  onClose(): void;
}) {
  const inactive = sheet.availableConditions.filter(
    condition => !sheet.conditions.some(active => active.conditionId === condition.id),
  );

  return (
    <div className="sheet-state-controls">
      <div className="sheet-resource">
        <span className="sheet-row-title">Exhaustion</span>
        <span className="sheet-resource-count">{sheet.exhaustion} / 6</span>
        <span className="sheet-stepper">
          <button
            type="button"
            disabled={sheet.exhaustion <= 0}
            onClick={() =>
              void applyRuntime(
                { kind: "exhaustion-set", value: sheet.exhaustion - 1 },
                next => `Exhaustion is now ${next.exhaustion}.`,
              )
            }
            aria-label={`Reduce exhaustion, currently ${sheet.exhaustion} of 6`}
          >
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={sheet.exhaustion >= 6}
            onClick={() =>
              void applyRuntime(
                { kind: "exhaustion-set", value: sheet.exhaustion + 1 },
                next => `Exhaustion is now ${next.exhaustion}.`,
              )
            }
            aria-label={`Increase exhaustion, currently ${sheet.exhaustion} of 6`}
          >
            <Plus aria-hidden="true" />
          </button>
        </span>
      </div>

      {sheet.conditions.length ? (
        <>
          <h4>Active conditions</h4>
          <ul className="sheet-rows">
            {sheet.conditions.map(condition => (
              <li key={condition.conditionId} className="sheet-item">
                <span className="sheet-row-title">{condition.label}</span>
                <button
                  type="button"
                  className="m2-button m2-button-small"
                  onClick={() =>
                    void applyRuntime(
                      { kind: "condition-remove", conditionId: condition.conditionId },
                      () => `Removed ${condition.label}.`,
                    )
                  }
                  aria-label={`Remove the ${condition.label} condition from ${sheet.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="m2-muted">No conditions are active.</p>
      )}

      {inactive.length ? (
        <>
          <h4>Add a condition</h4>
          <ul className="sheet-rows">
            {inactive.map(condition => (
              <li key={condition.id}>
                <button
                  type="button"
                  className="sheet-row"
                  onClick={() => {
                    void applyRuntime({ kind: "condition-add", conditionId: condition.id }, () => `Added ${condition.label}.`);
                    onClose();
                  }}
                  aria-label={`Add the ${condition.label} condition to ${sheet.name}`}
                >
                  <span className="sheet-row-title">
                    <Plus aria-hidden="true" /> {condition.label}
                  </span>
                  {condition.summary ? <span className="sheet-row-meta">{condition.summary}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function previewHitPoints(sheet: DerivedCharacterSheet, delta: number): string {
  const current = sheet.hitPoints.current.value;
  const maximum = sheet.hitPoints.maximum.value;
  if (current === null || maximum === null) return "—";
  return String(Math.max(0, Math.min(maximum, current + delta)));
}
