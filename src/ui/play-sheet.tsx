"use client";

/**
 * The character sheet: Runefolio's play and character-management workspace.
 *
 * The sheet is Play mode. It mutates transient session state only — hit points,
 * temporary hit points, hit dice, death saves, conditions, exhaustion,
 * inspiration, spell slots and limited-use resources — one runtime mutation per
 * action, with Undo. Permanent build decisions go through Edit character and
 * Level up, which live in the Character workspace. That boundary is stated as
 * data in `sheet-scope.ts` rather than only in prose here, so the screen and the
 * services cannot drift apart quietly.
 *
 * Presentation follows a clean paper sheet, not a rules console: no override
 * editors, no expressions, no ruleset, source or pack identifiers, and no
 * engine vocabulary. Every headline number can open a details drawer with a
 * human-readable breakdown of what went into it.
 *
 * ## Information architecture
 *
 * A glance header over four sections — Overview, Actions, Inventory, Character
 * — with Spells inserted for a character whose content declares spellcasting.
 * The tab strip is a fixed grid of exactly that many columns, so nothing is ever
 * behind a swipe.
 *
 * The shape of each section is chosen for how it grows, because a level 1
 * martial and a level 12 one are the same screen:
 *
 * - **A section is a heading over one bordered group**, not a card carrying its
 *   own heading. The heading sits outside the border, so a screen with five
 *   groups pays for one boundary each instead of a boundary, a heading and two
 *   lots of padding each.
 * - **Rows carry their most important number on the row.** An attack states
 *   what it hits on beside its name rather than only inside its drawer.
 * - **Character is progressive disclosure.** Class, Species, Background, Feats,
 *   Proficiencies and anything else arrive as collapsed rows that state what is
 *   inside them. Twelve levels of features is a list somebody opens, not a list
 *   somebody scrolls past on the way to Level up.
 *
 * Sections without trustworthy data are hidden rather than filled in, and a
 * group with nothing in it is not rendered at all.
 */
import {
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Backpack,
  BookMarked,
  ChevronDown,
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
import { BUILD_BOUNDARY_SENTENCE, spellStateBadge } from "@/src/ui/sheet-scope";
import type {
  DerivedAction,
  DerivedCharacterSheet,
  DerivedEquipmentItem,
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
  | { kind: "item"; item: DerivedEquipmentItem }
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

/**
 * When a repertoire stops being readable by scrolling.
 *
 * Deliberately a count and nothing else: no rule here reads a class, a school
 * or a spell's name. Below the threshold a filter would be a control with
 * nothing to do; above it, six level groups do not fit on a phone screen and
 * finding one spell means scrolling past twenty.
 */
const SPELL_FILTER_THRESHOLD = 12;

/** The Character groups this component renders under a name of their own. */
const NAMED_FEATURE_GROUPS = new Set<DerivedFeature["group"]>(["class", "species", "background", "feat"]);

/** "Rage", "Rage and Giant Ancestry", "Rage, Giant Ancestry and Second Wind". */
function listConcepts(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The recharge every one of these resources shares, or `null` if they differ. */
function commonRecharge(resources: readonly DerivedResource[]): string | null {
  if (!resources.length) return null;
  const first = resources[0].recharge;
  return resources.every(resource => resource.recharge === first) ? first : null;
}

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
  const tabsRef = useRef<HTMLDivElement>(null);

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

  /**
   * Changing section starts at the top of that section.
   *
   * A section is a page in every sense the user experiences it, and the panels
   * are wildly different lengths — Overview is three screens, Actions is often
   * one. Switching from the bottom of a long Overview to a short Actions used to
   * leave the viewport past the end of the new content, showing whitespace and
   * nothing else, because React replaced the panel under a scrolled window.
   *
   * The correction is the minimum one: if the new panel's first row would be
   * behind the app bar and the sticky strip, the page scrolls up by exactly the
   * amount that puts it below them. Somebody who was reading the top of a
   * section stays exactly where they were, because for them nothing is wrong.
   *
   * The measurement is taken from the *panel*, deliberately. The tab strip is
   * `position: sticky`, so once it is stuck its own rectangle reports the sticky
   * position no matter how far the document has scrolled — measuring it would
   * report "already in place" in precisely the case that needs correcting.
   *
   * It runs in a layout effect and without smooth behaviour, for the same
   * reasons the shell's own workspace reset does: the corrected position is the
   * first one painted, rather than something the user watches happen.
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);
  useLayoutEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const strip = tabsRef.current;
    const panel = panelRef.current;
    if (!strip || !panel) return;
    const declared = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--appbar-height") || "",
    );
    const barHeight = Number.isFinite(declared)
      ? declared
      : (document.querySelector(".m2-appbar")?.getBoundingClientRect().height ?? 0);
    const chrome = barHeight + strip.getBoundingClientRect().height;
    const deficit = chrome - panel.getBoundingClientRect().top;
    if (deficit > 1) window.scrollTo({ top: Math.max(0, window.scrollY - deficit), left: 0, behavior: "instant" });
  }, [activeTab]);

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
      ) : sheet.unavailableValues.length > 0 ? (
        /*
         * Creation owes nothing here, so this must not say "not finished" and
         * must not send the user to Edit character: nothing they can decide
         * resolves a value the installed content never defines.
         */
        <div className="m2-banner m2-banner-warning" role="alert">
          <strong>Some values could not be calculated</strong>
          <p>
            {listConcepts(sheet.unavailableValues.map(item => item.label))}{" "}
            {sheet.unavailableValues.length === 1 ? "shows" : "show"} as — because the content installed on this device
            does not define {sheet.unavailableValues.length === 1 ? "it" : "them"} at this level. The rest of this
            character is complete.
          </p>
        </div>
      ) : null}

      {/*
       * The glance header answers "who am I, and what matters right now" and
       * then gets out of the way. It used to take a third of a 780 px phone
       * screen before a single row of actual content: the vitals were two rows
       * of tall tiles, the receipt line reserved space whether or not it had
       * anything to say, and Edit carried a word as well as its pencil. All five
       * vitals are now one row, and the receipt occupies nothing until it does.
       */}
      <header className="sheet-glance">
        <div className="sheet-identity">
          <div className="sheet-identity-text">
            <h2>
              {sheet.name}
              {sheet.nickname ? <small className="sheet-alias"> “{sheet.nickname}”</small> : null}
            </h2>
            <p className="sheet-identity-line">
              {sheet.classLabel ? `${sheet.classLabel} ${sheet.level}` : `Level ${sheet.level}`}
              {sheet.subclassLabel ? ` (${sheet.subclassLabel})` : ""}
              {sheet.speciesLabel ? ` · ${sheet.speciesLabel}` : ""}
            </p>
          </div>
          {/*
           * One route to permanent change from anywhere on the sheet, and the
           * Character workspace carries the labelled pair. The pencil is icon
           * only because the word "Edit" beside it said nothing the icon and its
           * accessible name did not, and cost about 40 px of a 360 px row that
           * the character's own name wanted.
           */}
          <button type="button" className="m2-button sheet-edit" onClick={onEdit} aria-label={`Edit character ${sheet.name}`}>
            <Pencil aria-hidden="true" />
          </button>
        </div>

        {sheet.mode === "manual" ? (
          <p className="sheet-quiet-note">
            <span className="m2-badge m2-badge-manual">Manual</span> This sheet uses values you entered. It is not
            automatically rules-justified.
          </p>
        ) : null}

        <div className="sheet-vitals">
          <button
            type="button"
            className={dying ? "sheet-tile sheet-hp sheet-hp-dying" : "sheet-tile sheet-hp"}
            onClick={() => setDrawer({ kind: "hp" })}
            aria-label={`Hit points ${hitPointsSummary(sheet)}. Open hit point actions`}
          >
            <span className="sheet-tile-label">
              <Heart aria-hidden="true" /> {dying ? "Dying" : "HP"}
            </span>
            <span className="sheet-tile-value sheet-hp-value">
              <DerivedNumber value={sheet.hitPoints.current} label="Current hit points" />
              <small> / {formatDerived(sheet.hitPoints.maximum)}</small>
            </span>
            {sheet.hitPoints.temporary > 0 ? <span className="sheet-hp-temp">+{sheet.hitPoints.temporary}</span> : null}
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
        <section className="sheet-section sheet-dying" aria-labelledby="dying-heading">
          <h3 id="dying-heading" className="sheet-section-title">
            Death saves
          </h3>
          <div className="sheet-card">
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
          </div>
        </section>
      ) : null}

      <div
        className="sheet-tabs"
        role="tablist"
        aria-label="Character sheet sections"
        onKeyDown={onTabKeyDown}
        ref={tabsRef}
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

      <div
        id={`sheet-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`sheet-tab-${activeTab}`}
        className="sheet-panel"
        ref={panelRef}
      >
        {activeTab === "overview" ? <OverviewPanel sheet={sheet} onOpen={setDrawer} /> : null}
        {activeTab === "actions" ? (
          <ActionsPanel sheet={sheet} resources={actionResources} onOpen={setDrawer} applyRuntime={applyRuntime} />
        ) : null}
        {activeTab === "spells" && sheet.spellcasting ? (
          <SpellsPanel sheet={sheet} slots={slotResources} onOpen={setDrawer} applyRuntime={applyRuntime} />
        ) : null}
        {activeTab === "inventory" ? <InventoryPanel sheet={sheet} onOpen={setDrawer} /> : null}
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

/**
 * A heading over one bordered group.
 *
 * The heading is deliberately outside the border. Every group used to be a card
 * carrying its own title, which meant each one paid for a boundary, the title's
 * own row inside it and padding above and below that row — about 60 px of
 * chrome per group, on a screen that routinely has five of them.
 */
function SheetSection({
  title,
  meta,
  children,
  bare,
}: {
  title: string;
  /** A short qualifier for the whole group: a count, a shared recharge. */
  meta?: string;
  children: ReactNode;
  /** Renders the group without the inner card, for grids that own their edges. */
  bare?: boolean;
}) {
  const headingId = useId();
  return (
    <section className="sheet-section" aria-labelledby={headingId}>
      <h3 id={headingId} className="sheet-section-title">
        {title}
        {meta ? <span className="sheet-section-meta">{meta}</span> : null}
      </h3>
      {bare ? children : <div className="sheet-card">{children}</div>}
    </section>
  );
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

/** Overview: the quick-reference numbers — abilities, saving throws and skills. */
function OverviewPanel({ sheet, onOpen }: { sheet: DerivedCharacterSheet; onOpen(drawer: Drawer): void }) {
  return (
    <>
      <SheetSection title="Abilities">
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
      </SheetSection>

      {sheet.saves.length ? (
        <SheetSection title="Saving throws" meta={proficientMeta(sheet.saves)}>
          <CheckList entries={sheet.saves} onOpen={onOpen} />
        </SheetSection>
      ) : null}

      {sheet.checks.length ? (
        <SheetSection title="Skills" meta={proficientMeta(sheet.checks)}>
          <CheckList entries={sheet.checks} onOpen={onOpen} />
        </SheetSection>
      ) : null}
    </>
  );
}

/** "3 proficient" — the one fact a player scans a save or skill list for. */
function proficientMeta(entries: DerivedCharacterSheet["saves"]): string | undefined {
  const proficient = entries.filter(entry => entry.proficient).length;
  return proficient ? `${proficient} proficient` : undefined;
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

/**
 * A row that leads with a name and a number.
 *
 * The number is on the row rather than only in the drawer, because "what do I
 * hit on" is the question an attack row exists to answer and opening a details
 * surface to read a single modifier is not answering it.
 */
function SheetRow({
  title,
  value,
  meta,
  badges,
  ariaLabel,
  onOpen,
}: {
  title: string;
  value?: string;
  meta?: string;
  badges?: readonly string[];
  ariaLabel: string;
  onOpen(): void;
}) {
  return (
    <li>
      {/* One accessible name, so the row's purpose is announced once. */}
      <button type="button" className="sheet-row" onClick={onOpen} aria-label={ariaLabel}>
        <span className="sheet-row-title">
          {title}
          {badges?.map(badge => (
            <span key={badge} className="sheet-badge">
              {badge}
            </span>
          ))}
        </span>
        {value ? <span className="sheet-row-value">{value}</span> : null}
        {meta ? <span className="sheet-row-meta">{meta}</span> : null}
      </button>
    </li>
  );
}

/** Actions: what this character can do right now, then what it can spend. */
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
        <SheetSection key={group.kind} title={group.label} meta={group.actions.length > 3 ? `${group.actions.length}` : undefined}>
          <ul className="sheet-rows">
            {group.actions.map(action => {
              const hit = action.attackBonus.value !== null ? signed(action.attackBonus.value) : undefined;
              const meta = [action.damageExpression, action.range].filter(Boolean).join(" · ");
              const spoken = [
                hit ? `${hit} to hit` : null,
                action.damageExpression,
                action.range,
              ].filter(Boolean) as string[];
              return (
                <SheetRow
                  key={action.id}
                  title={action.label}
                  {...(hit ? { value: hit } : {})}
                  {...(meta ? { meta } : {})}
                  ariaLabel={`${action.label}${spoken.length ? `, ${spoken.join(", ")}` : ""}. Open details`}
                  onOpen={() => onOpen({ kind: "action", action })}
                />
              );
            })}
          </ul>
        </SheetSection>
      ))}

      {groups.length === 0 ? (
        <SheetSection title="Actions">
          <p className="m2-muted">No actions can be shown yet. Use Edit character to finish the build.</p>
        </SheetSection>
      ) : null}

      {resources.length ? (
        <ResourceSection title="Resources" resources={resources} applyRuntime={applyRuntime} />
      ) : null}
    </>
  );
}

/**
 * A group of spendable resources.
 *
 * When every resource in the group recharges the same way — which is exactly
 * what a set of spell slots is — the recharge is said once, above the group,
 * rather than repeated verbatim on every row.
 */
function ResourceSection({
  title,
  resources,
  applyRuntime,
}: {
  title: string;
  resources: readonly DerivedResource[];
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
}) {
  const shared = commonRecharge(resources);
  const sharedLabel = shared ? rechargeLabel(shared) : "";
  return (
    <SheetSection title={title} {...(resources.length > 1 && sharedLabel ? { meta: sharedLabel } : {})}>
      <div className="sheet-resources">
        {resources.map(resource => (
          <ResourceRow
            key={resource.id}
            resource={resource}
            showRecharge={!(resources.length > 1 && sharedLabel)}
            applyRuntime={applyRuntime}
          />
        ))}
      </div>
    </SheetSection>
  );
}

function ResourceRow({
  resource,
  showRecharge = true,
  applyRuntime,
}: {
  resource: DerivedResource;
  showRecharge?: boolean;
  applyRuntime(operation: RuntimeOperation, describe: (runtime: CharacterRuntimeStateRecord) => string): Promise<void>;
}) {
  const empty = resource.current.value !== null && resource.current.value <= 0;
  const full =
    resource.current.value !== null && resource.maximum.value !== null && resource.current.value >= resource.maximum.value;
  const recharge = showRecharge ? rechargeLabel(resource.recharge) : "";
  return (
    <div className="sheet-resource">
      <span className="sheet-row-title">{resource.label}</span>
      <span className="sheet-resource-count">
        <DerivedNumber value={resource.current} label={`${resource.label} remaining`} /> /{" "}
        <DerivedNumber value={resource.maximum} label={`${resource.label} maximum`} />
      </span>
      <span className="sheet-resource-recharge">{recharge}</span>
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

/**
 * Spells: the casting numbers, the slots, then the repertoire by level.
 *
 * The repertoire is what a caster's sheet has that a martial's does not, and it
 * is the part that grows without limit: a level 1 caster has four spells and a
 * level 9 one can have thirty across six levels. The filter appears only when
 * there are enough spells for scrolling to have stopped working, and it is keyed
 * on that count alone — no rule here knows anything about any particular spell,
 * class or book.
 */
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
  const [filter, setFilter] = useState("");
  const filterId = useId();

  // Hooks run before the early return, so the panel's state is unconditional.
  const all = useMemo(() => casting?.spells ?? [], [casting]);
  const needle = filter.trim().toLowerCase();
  const visible = needle ? all.filter(spell => spell.label.toLowerCase().includes(needle)) : all;
  const levels = [...new Set(visible.map(spell => spell.level))].sort((left, right) => left - right);
  /*
   * Whether "granted" is a distinction on this sheet at all. It is only one when
   * the player also chose something; a class that grants its whole repertoire
   * would otherwise carry the same badge on every row.
   */
  const distinguishGranted = all.some(spell => spell.viaSelectionId !== undefined);

  if (!casting) return null;

  return (
    <>
      <SheetSection title="Casting" bare>
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
      </SheetSection>

      {slots.length ? <ResourceSection title="Spell slots" resources={slots} applyRuntime={applyRuntime} /> : null}

      {all.length > SPELL_FILTER_THRESHOLD ? (
        <div className="sheet-filter">
          <label htmlFor={filterId}>Find a spell</label>
          <input
            id={filterId}
            type="search"
            value={filter}
            placeholder={`${all.length} spells`}
            onChange={event => setFilter(event.target.value)}
          />
        </div>
      ) : null}

      {levels.map(level => {
        const inLevel = visible.filter(spell => spell.level === level);
        return (
          <SheetSection
            key={level}
            title={level === 0 ? "Cantrips" : `Level ${level}`}
            meta={inLevel.length > 3 ? `${inLevel.length}` : undefined}
          >
            <ul className="sheet-rows">
              {inLevel.map(spell => {
                const badges = [
                  spell.concentration ? "Concentration" : null,
                  spell.ritual ? "Ritual" : null,
                  spellStateBadge(spell, distinguishGranted),
                ].filter(Boolean) as string[];
                const spoken = [spell.castingTime, spell.range, ...badges.map(badge => badge.toLowerCase())].filter(
                  Boolean,
                ) as string[];
                const meta = [spell.castingTime, spell.range].filter(Boolean).join(" · ");
                return (
                  <SheetRow
                    key={spell.id}
                    title={spell.label}
                    badges={badges}
                    {...(meta ? { meta } : {})}
                    ariaLabel={`${spell.label}${spoken.length ? `, ${spoken.join(", ")}` : ""}. Open details`}
                    onOpen={() => onOpen({ kind: "spell", spell })}
                  />
                );
              })}
            </ul>
          </SheetSection>
        );
      })}

      {needle && !visible.length ? <p className="m2-muted">No spell matches “{filter.trim()}”.</p> : null}
    </>
  );
}

/**
 * Inventory: equipped gear first, then everything else carried.
 *
 * A row carries the name, the count and the facts that change how the item is
 * used — what it adds to armour class, whether it needs attunement, whether it
 * is magical. Its description is not on the row: a kit of a dozen items became a
 * dozen three-line paragraphs, 68 px each, and an inventory is a thing people
 * scan. The description is one tap away, in the item's own drawer.
 *
 * What is *not* here is deliberate: there is no equip, unequip, attune, consume
 * or quantity control. The runtime service has no operation for any of them and
 * the durable record stores equipment as the bundle choices that produced it, so
 * a control here would either write nothing or invent a second, private store of
 * item state. The IA is built for those controls; the capability is reported in
 * `docs/CURRENT.md` rather than faked.
 */
function InventoryPanel({ sheet, onOpen }: { sheet: DerivedCharacterSheet; onOpen(drawer: Drawer): void }) {
  const equipped = sheet.equipment.filter(item => item.status === "equipped");
  const carried = sheet.equipment.filter(item => item.status !== "equipped");

  if (!sheet.equipment.length)
    return (
      <SheetSection title="Inventory">
        <p className="m2-muted">Nothing is recorded yet. Use Edit character to change equipment.</p>
      </SheetSection>
    );

  const group = (title: string, items: readonly DerivedEquipmentItem[]) => (
    <SheetSection title={title} meta={items.length > 3 ? `${items.length}` : undefined}>
      <ul className="sheet-rows">
        {items.map(item => {
          const badges = [
            item.armorContribution !== undefined ? `AC ${item.armorContribution}` : null,
            item.attunementRequired ? "Attunement" : null,
            item.rarity ? capitalise(item.rarity) : null,
          ].filter(Boolean) as string[];
          return (
            <SheetRow
              key={item.itemId}
              title={item.label}
              badges={badges}
              {...(item.quantity > 1 ? { value: `×${item.quantity}` } : {})}
              ariaLabel={`${item.label}${item.quantity > 1 ? `, ${item.quantity}` : ""}${
                badges.length ? `, ${badges.join(", ")}` : ""
              }. Open details`}
              onOpen={() => onOpen({ kind: "item", item })}
            />
          );
        })}
      </ul>
    </SheetSection>
  );

  return (
    <>
      {equipped.length ? group("Equipped", equipped) : null}
      {carried.length ? group("Carried", carried) : null}
    </>
  );
}

const capitalise = (value: string) => (value ? `${value[0].toUpperCase()}${value.slice(1)}` : value);

/**
 * One collapsible group in the Character workspace.
 *
 * Collapsed, it states what is inside it. That is the whole point: a player
 * opening Character is usually looking for one thing, and a flat list of every
 * feature a twelfth-level character has is the thing they have to scroll past to
 * reach it. The header is a heading *and* a button, so it is both a landmark to
 * navigate by and a control to operate — and `aria-controls` names the panel
 * only while the panel exists, because a reference to an element that is not in
 * the document is one assistive technology cannot follow.
 */
function SheetGroup({
  title,
  summary,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary?: string;
  count?: number;
  open: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  const panelId = useId();
  const detail = [summary, count === undefined ? null : `${count} ${count === 1 ? "entry" : "entries"}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className={open ? "sheet-group sheet-group-open" : "sheet-group"}>
      <h3 className="sheet-group-head">
        <button
          type="button"
          aria-expanded={open}
          {...(open ? { "aria-controls": panelId } : {})}
          onClick={onToggle}
        >
          <span className="sheet-group-title">{title}</span>
          {detail ? <span className="sheet-group-summary">{detail}</span> : null}
          <ChevronDown aria-hidden="true" className="sheet-group-mark" />
        </button>
      </h3>
      {open ? (
        <div id={panelId} className="sheet-card sheet-group-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function FeatureList({ features, onOpen }: { features: readonly DerivedFeature[]; onOpen(drawer: Drawer): void }) {
  return (
    <ul className="sheet-rows">
      {features.map(feature => (
        <SheetRow
          key={feature.id}
          title={feature.label}
          {...(feature.summary ? { meta: feature.summary } : {})}
          ariaLabel={`${feature.label}. Open details`}
          onOpen={() => onOpen({ kind: "feature", feature })}
        />
      ))}
    </ul>
  );
}

/**
 * Character: who this character is, and the two controls that change it.
 *
 * Everything durable about the build lives here, grouped by the thing that owns
 * it and closed until asked for. Edit character and Level up sit under the
 * groups: discoverable on a screen that is one thumb-length long when nothing is
 * open, and visually secondary to the character they act on.
 */
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const toggle = (id: string) => setOpenGroup(current => (current === id ? null : id));

  const featuresIn = (group: DerivedFeature["group"]) => sheet.features.filter(feature => feature.group === group);
  const classFeatures = featuresIn("class");
  const speciesTraits = featuresIn("species");
  const backgroundFeatures = featuresIn("background");
  const feats = featuresIn("feat");
  const otherFeatures = sheet.features.filter(feature => !NAMED_FEATURE_GROUPS.has(feature.group));

  const proficiencyGroups: readonly { type: "armor" | "weapon" | "tool" | "language"; label: string }[] = [
    { type: "armor", label: "Armour" },
    { type: "weapon", label: "Weapons" },
    { type: "tool", label: "Tools" },
    { type: "language", label: "Languages" },
  ];

  /*
   * A collapsed group says what is *inside* it, not what the screen already
   * says. Class, level, subclass and species are all on the glance header a
   * thumb's width above this list, so restating them here adds a second copy of
   * the same sentence and nothing else — which is also what made "Vanguard 2"
   * ambiguous to anything reading the page. Hit dice is the one durable class
   * fact the header has no room for, so that is what this summary carries.
   * Background is not on the header at all, so its own name is real information.
   */
  const classSummary = sheet.hitDice.value === null ? undefined : `Hit dice ${sheet.hitDice.value}`;

  return (
    <>
      <div className="sheet-groups">
        <SheetGroup
          title="Class & subclass"
          {...(classSummary ? { summary: classSummary } : {})}
          count={classFeatures.length || undefined}
          open={openGroup === "class"}
          onToggle={() => toggle("class")}
        >
          {/*
           * Straight to the features. Class, subclass and level are on the
           * glance header and hit dice is on this group's own closed summary, so
           * a definition list restating all four here was four rows of the same
           * sentence — about 230 px — before the content anybody opened it for.
           */}
          {classFeatures.length ? (
            <FeatureList features={classFeatures} onOpen={onOpen} />
          ) : (
            <p className="m2-muted">This class grants no features at this level.</p>
          )}
        </SheetGroup>

        {sheet.speciesLabel || speciesTraits.length ? (
          <SheetGroup
            title="Species"
            count={speciesTraits.length || undefined}
            open={openGroup === "species"}
            onToggle={() => toggle("species")}
          >
            {speciesTraits.length ? (
              <FeatureList features={speciesTraits} onOpen={onOpen} />
            ) : (
              <p className="m2-muted">This origin grants no traits of its own.</p>
            )}
          </SheetGroup>
        ) : null}

        {sheet.backgroundLabel || backgroundFeatures.length ? (
          <SheetGroup
            title="Background"
            {...(sheet.backgroundLabel ? { summary: sheet.backgroundLabel } : {})}
            count={backgroundFeatures.length || undefined}
            open={openGroup === "background"}
            onToggle={() => toggle("background")}
          >
            {backgroundFeatures.length ? (
              <FeatureList features={backgroundFeatures} onOpen={onOpen} />
            ) : (
              <p className="m2-muted">This background grants nothing beyond its own training.</p>
            )}
          </SheetGroup>
        ) : null}

        {feats.length ? (
          <SheetGroup title="Feats" count={feats.length} open={openGroup === "feats"} onToggle={() => toggle("feats")}>
            <FeatureList features={feats} onOpen={onOpen} />
          </SheetGroup>
        ) : null}

        {otherFeatures.length ? (
          <SheetGroup
            title="Features & traits"
            count={otherFeatures.length}
            open={openGroup === "other"}
            onToggle={() => toggle("other")}
          >
            <FeatureList features={otherFeatures} onOpen={onOpen} />
          </SheetGroup>
        ) : null}

        {sheet.otherProficiencies.length ? (
          <SheetGroup
            title="Proficiencies & training"
            count={sheet.otherProficiencies.length}
            open={openGroup === "proficiencies"}
            onToggle={() => toggle("proficiencies")}
          >
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
          </SheetGroup>
        ) : null}
      </div>

      <section className="sheet-section sheet-manage" aria-labelledby="manage-heading">
        <h3 id="manage-heading" className="sheet-section-title">
          Manage
        </h3>
        <div className="sheet-card">
          <div className="sheet-row-actions">
            <button type="button" className="m2-button" onClick={onEdit}>
              <Pencil aria-hidden="true" />
              Edit character
            </button>
            <button type="button" className="m2-button" onClick={onLevelUp}>
              <BookMarked aria-hidden="true" />
              Level up
            </button>
          </div>
          <p className="sheet-quiet-note">{BUILD_BOUNDARY_SENTENCE}</p>
        </div>
      </section>

      {restorePoints.length ? (
        <section className="sheet-section" aria-labelledby="history-heading">
          <h3 id="history-heading" className="sheet-section-title">
            Restore points
          </h3>
          <div className="sheet-card">
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
          </div>
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
          {spell.ritual ? <IdentityFact label="Ritual">Can be cast as a ritual</IdentityFact> : null}
          {/*
           * The whole state, where there is room for it. The row shows the
           * strongest single fact; this says how the character came to have the
           * spell and what state it is in, in the projection's own terms and
           * without implying anything it does not say.
           */}
          <IdentityFact label="How you have it">{spell.granted ? "Granted by your build" : "Chosen by you"}</IdentityFact>
          <IdentityFact label="State">
            {spell.alwaysPrepared
              ? "Always prepared"
              : spell.prepared
                ? "Prepared"
                : spell.known
                  ? "Known"
                  : "Available"}
          </IdentityFact>
        </dl>
        {spell.summary ? <p>{spell.summary}</p> : null}
      </Dialog>
    );
  }

  if (drawer.kind === "item") {
    const item = drawer.item;
    return (
      <Dialog title={item.label} onClose={onClose} presentation="sheet">
        <dl className="sheet-facts">
          <IdentityFact label="Status">{item.status === "equipped" ? "Equipped" : "Carried"}</IdentityFact>
          {item.quantity > 1 ? <IdentityFact label="Quantity">{item.quantity}</IdentityFact> : null}
          {item.armorContribution !== undefined ? <IdentityFact label="Armour class">{item.armorContribution}</IdentityFact> : null}
          {item.rarity ? <IdentityFact label="Rarity">{capitalise(item.rarity)}</IdentityFact> : null}
          {item.attunementRequired ? <IdentityFact label="Attunement">Required</IdentityFact> : null}
          {item.weight !== undefined ? <IdentityFact label="Weight">{item.weight}</IdentityFact> : null}
        </dl>
        {item.summary ? <p>{item.summary}</p> : null}
        <p className="sheet-quiet-note">Adding, removing and equipping items is part of Edit character.</p>
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
              <SheetRow
                key={condition.id}
                title={condition.label}
                {...(condition.summary ? { meta: condition.summary } : {})}
                ariaLabel={`Add the ${condition.label} condition to ${sheet.name}`}
                onOpen={() => {
                  void applyRuntime({ kind: "condition-add", conditionId: condition.id }, () => `Added ${condition.label}.`);
                  onClose();
                }}
              />
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
