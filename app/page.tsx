"use client";

/**
 * The Runefolio application shell.
 *
 * Mobile primary navigation is Characters, Sheet and Compendium in a persistent
 * bottom bar, with Settings always reachable from the top app bar. A modal task —
 * creation, level up or a transfer confirmation — replaces the bottom bar with a
 * task footer so the primary next action stays visible at 360 px. At an effective
 * 960 CSS px and above the same destinations become a compact persistent rail,
 * which falls back to the bottom bar under zoom or width pressure because the
 * query is expressed in CSS pixels.
 */
import { useCallback, useRef, useState } from "react";
import { BookOpen, Settings, Swords, UserRound } from "lucide-react";
import { BrandMark } from "@/src/ui/brand-mark";
import { PwaIndicator } from "@/src/ui/pwa-status";
import { ContentWorkspace } from "@/src/ui/content-workspace";
import { ServicesProvider, useServices } from "@/src/ui/services-context";
import { CharacterLibrary, type LibraryDestination } from "@/src/ui/character-library";
import { PortraitGuard, useMobileLandscape, usePortraitLock } from "@/src/ui/portrait-guard";
import { CharacterBuilder } from "@/src/ui/character-builder";
import { PlaySheet } from "@/src/ui/play-sheet";
import { LevelUpDialog } from "@/src/ui/level-up-dialog";
import { SettingsView } from "@/src/ui/settings-view";
import { TransferPanel } from "@/src/ui/transfer-panel";
import type { RulesetSelection } from "@/src/services/content-install-service";
import type { EditDraftRepairNote } from "@/src/services/edit-draft";
import "./m2.css";
import "./sheet.css";

type View = "characters" | "sheet" | "compendium" | "settings" | "transfer";

const PRIMARY_NAV: readonly { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "characters", label: "Characters", icon: <UserRound aria-hidden="true" /> },
  { id: "sheet", label: "Sheet", icon: <Swords aria-hidden="true" /> },
  { id: "compendium", label: "Compendium", icon: <BookOpen aria-hidden="true" /> },
];

export default function Home() {
  return (
    <ServicesProvider>
      <Shell />
    </ServicesProvider>
  );
}

function Shell() {
  const { drafts, library, install, refresh } = useServices();
  /*
   * Portrait-first, in two parts.
   *
   * The lock is asked for once, and only where it can succeed — an installed
   * app on a phone. Everywhere else it is a no-op, because a browser tab always
   * refuses and there is nothing useful to say about that.
   *
   * The guard is the part that always works. It is a sibling of the shell, not
   * a wrapper, so raising and lowering it never remounts the app: an
   * in-progress build, a half-typed field and the scroll position all survive a
   * rotation and are exactly where they were when the phone comes back upright.
   */
  usePortraitLock();
  const sideways = useMobileLandscape();
  const [view, setView] = useState<View>("characters");
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [builderDraftId, setBuilderDraftId] = useState<string | null>(null);
  const [levelUpFor, setLevelUpFor] = useState<string | null>(null);
  /** Set when more than one usable ruleset exists and none has been activated. */
  const [rulesetChoice, setRulesetChoice] = useState<RulesetSelection | null>(null);
  /** Saved values the installed content cannot confirm, reported by the hydration. */
  const [editRepairs, setEditRepairs] = useState<readonly EditDraftRepairNote[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  /** The character an Edit press is currently opening, so a second press is a no-op. */
  const openingEditRef = useRef<string | null>(null);

  const createDraft = useCallback(
    async (rulesetProfileId: string) => {
      const draftId = `draft:${Date.now().toString(36)}`;
      const outcome = await drafts.create({ draftId, rulesetProfileId, level: 1, presentation: "guided" });
      if (outcome.status === "ok") {
        setRulesetChoice(null);
        setBuilderDraftId(draftId);
        refresh();
      }
    },
    [drafts, refresh],
  );

  /**
   * Starting a build needs a ruleset, and there is no honest way to guess one.
   *
   * The service answers with an activated profile, the single usable profile, or
   * an explicit ambiguity. Taking the first row of a list instead would let
   * alphabetical order decide which content a character is built against — the
   * exact failure that left imported content unreachable.
   */
  const startNewCharacter = useCallback(async () => {
    const selection = await install.resolveStartingRuleset();
    if (selection.kind === "resolved") {
      await createDraft(selection.rulesetId);
      return;
    }
    setRulesetChoice(selection);
  }, [createDraft, install]);

  const navigate = useCallback(
    (destination: LibraryDestination) => {
      switch (destination.kind) {
        case "new":
          void startNewCharacter();
          return;
        case "build":
          setBuilderDraftId(destination.draftId);
          return;
        case "sheet":
          setActiveCharacterId(destination.characterId);
          setView("sheet");
          return;
        case "edit": {
          /*
           * One service call, and the ref is what makes a second press harmless.
           *
           * `openForCharacter` is already idempotent — it resumes the existing
           * edit draft rather than creating a second one — but the call is
           * asynchronous, and two presses dispatched before the first resolves
           * would both run. The guard is released only when the builder has the
           * draft, so the second press finds the door already open.
           */
          if (openingEditRef.current === destination.characterId) return;
          openingEditRef.current = destination.characterId;
          void drafts
            .openForCharacter(destination.characterId)
            .then(outcome => {
              if (outcome.status === "ok") {
                setEditRepairs(outcome.result.repairs);
                setBuilderDraftId(outcome.result.draft.id);
              } else {
                setEditError("That character could not be opened for editing on this device.");
              }
            })
            .finally(() => {
              openingEditRef.current = null;
            });
          return;
        }
        case "level-up":
          setLevelUpFor(destination.characterId);
          return;
        case "transfer":
          if (destination.characterId) setActiveCharacterId(destination.characterId);
          setView("transfer");
          return;
        case "duplicate":
          void library
            .duplicate(
              destination.characterId,
              `${destination.characterId}:copy:${Date.now().toString(36)}`,
              `ui:duplicate:${Date.now()}`,
            )
            .then(refresh);
          return;
        case "archive":
          void library
            .setArchived(destination.characterId, destination.revision, true, `ui:archive:${Date.now()}`)
            .then(refresh);
          return;
      }
    },
    [drafts, library, refresh, startNewCharacter],
  );

  // A modal task owns the whole surface and supplies its own task footer.
  const modalTask = builderDraftId !== null;

  /**
   * Leaves for another top-level view, closing any modal task first.
   *
   * The builder owns the whole surface while it is open, so a nav button that
   * only moved `view` changed nothing the user could see: the control was
   * visible, enabled, and dead, while `aria-current` moved to it and announced
   * a page that was not on screen. Closing the task is safe — every decision is
   * already autosaved, and the draft reappears under "Unfinished builds" with a
   * Resume control — so the honest response to "take me to Characters" is to go
   * there.
   */
  const leaveTo = (destination: View) => {
    setView(destination);
    setBuilderDraftId(null);
    setEditRepairs([]);
    setEditError(null);
  };

  return (
    <>
      {/*
       * `m2-shell-task` tells the layout that a modal task owns the surface.
       *
       * On mobile the primary navigation and the task's action row are both
       * pinned to the bottom edge, and the task row is painted over the top of
       * the navigation. The result was navigation that looked available,
       * announced itself as available, and could not be pressed at all. The task
       * now hides it rather than covering it, and supplies its own way out.
       *
       * `inert` while the portrait guard is up is what actually keeps the UI
       * underneath out of reach: it removes the whole subtree from the focus
       * order, from pointer events and from the accessibility tree, so a
       * keyboard, a screen reader and a stray tap all stop at the guard. Covering
       * it with an opaque layer alone would have left every control tabbable
       * behind the cover.
       */}
      <div className={modalTask ? "m2-shell m2-shell-task" : "m2-shell"} inert={sideways}>
        <header className="m2-appbar">
          <div className="m2-appbar-brand">
            <BrandMark decorative variant="inverse" />
            <strong>Runefolio</strong>
          </div>
          <PwaIndicator />
          <button
            type="button"
            className={view === "settings" ? "m2-appbar-settings m2-active" : "m2-appbar-settings"}
            onClick={() => leaveTo("settings")}
            aria-label="Open Settings"
            aria-current={view === "settings" ? "page" : undefined}
          >
            <Settings aria-hidden="true" />
            <span>Settings</span>
          </button>
        </header>

        <nav className="m2-rail" aria-label="Primary">
          <ul>
            {PRIMARY_NAV.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={view === item.id ? "m2-nav-button m2-active" : "m2-nav-button"}
                  aria-current={view === item.id ? "page" : undefined}
                  onClick={() => leaveTo(item.id)}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </li>
            ))}
            <li className="m2-rail-only">
              <button
                type="button"
                className={view === "settings" ? "m2-nav-button m2-active" : "m2-nav-button"}
                aria-current={view === "settings" ? "page" : undefined}
                onClick={() => leaveTo("settings")}
              >
                <Settings aria-hidden="true" />
                <span>Settings</span>
              </button>
            </li>
          </ul>
        </nav>

        <main className="m2-main" id="main">
          {editError && !modalTask ? (
            <div className="m2-banner m2-banner-error" role="alert">
              <strong>Edit character could not be opened</strong>
              <p>{editError}</p>
            </div>
          ) : null}
          {rulesetChoice ? (
            <RulesetChoice
              selection={rulesetChoice}
              onChoose={id => {
                void install.activate(id).then(() => createDraft(id));
              }}
              onCancel={() => setRulesetChoice(null)}
              onOpenCompendium={() => {
                setRulesetChoice(null);
                setView("compendium");
              }}
            />
          ) : modalTask && builderDraftId ? (
            <CharacterBuilder
              draftId={builderDraftId}
              repairs={editRepairs}
              onClose={() => {
                setBuilderDraftId(null);
                setEditRepairs([]);
                refresh();
              }}
              onFinished={characterId => {
                setBuilderDraftId(null);
                setEditRepairs([]);
                setActiveCharacterId(characterId);
                setView("sheet");
              }}
            />
          ) : view === "characters" ? (
            <CharacterLibrary onNavigate={navigate} />
          ) : view === "sheet" ? (
            activeCharacterId ? (
              <PlaySheet
                characterId={activeCharacterId}
                onLevelUp={() => setLevelUpFor(activeCharacterId)}
                onEdit={() => navigate({ kind: "edit", characterId: activeCharacterId })}
              />
            ) : (
              <section className="m2-page">
                <h2 className="m2-page-title">Sheet</h2>
                <div className="m2-empty">
                  <Swords aria-hidden="true" className="m2-empty-icon" />
                  <h3>No character is open</h3>
                  <p>Open one from Characters to start playing.</p>
                  <button type="button" className="m2-button m2-button-primary" onClick={() => setView("characters")}>
                    Go to Characters
                  </button>
                </div>
              </section>
            )
          ) : view === "compendium" ? (
            <ContentWorkspace view="Compendium" />
          ) : view === "transfer" ? (
            <TransferPanel
              {...(activeCharacterId ? { characterId: activeCharacterId } : {})}
              onImported={id => {
                setActiveCharacterId(id);
                setView("sheet");
              }}
            />
          ) : (
            <SettingsView
              onOpenCharacter={id => {
                setActiveCharacterId(id);
                setView("sheet");
              }}
            />
          )}
        </main>

        {levelUpFor && !rulesetChoice ? (
          <LevelUpDialog
            characterId={levelUpFor}
            onClose={() => setLevelUpFor(null)}
            onCommitted={() => {
              setActiveCharacterId(levelUpFor);
              setLevelUpFor(null);
              setView("sheet");
            }}
          />
        ) : null}
      </div>
      {sideways ? <PortraitGuard /> : null}
    </>
  );
}

/**
 * The explicit ruleset question.
 *
 * It appears only when the app genuinely cannot answer it: nothing installed, or
 * more than one usable ruleset with none activated. The chosen profile is
 * activated, so the question is asked once rather than at every new character.
 */
function RulesetChoice({
  selection,
  onChoose,
  onCancel,
  onOpenCompendium,
}: {
  selection: RulesetSelection;
  onChoose(rulesetId: string): void;
  onCancel(): void;
  onOpenCompendium(): void;
}) {
  if (selection.kind === "none")
    return (
      <section className="m2-page">
        <h2 className="m2-page-title">Choose a ruleset</h2>
        <div className="m2-empty">
          <BookOpen aria-hidden="true" className="m2-empty-icon" />
          <h3>No ruleset is installed</h3>
          <p>
            A character is built against a ruleset, which decides which classes, origins and equipment exist. Import a
            content pack and create its ruleset to start.
          </p>
          <button type="button" className="m2-button m2-button-primary" onClick={onOpenCompendium}>
            Go to Compendium
          </button>
          <button type="button" className="m2-button m2-button-secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </section>
    );

  const options = selection.kind === "ambiguous" ? selection.options : [];
  return (
    <section className="m2-page">
      <h2 className="m2-page-title">Choose a ruleset</h2>
      <p className="m2-muted">
        More than one ruleset is installed. Pick the one this character is built against; it stays selected for the
        next character too, and you can change it on the first step of any build.
      </p>
      <ul className="m2-options">
        {options.map(option => (
          <li key={option.id}>
            <button type="button" className="m2-option" onClick={() => onChoose(option.id)}>
              <span className="m2-option-mark" aria-hidden="true">
                ○
              </span>
              <span>
                <b>{option.name}</b>
                <small>
                  {option.entryCount} entries · levels 1–{option.maxSupportedLevel}
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="m2-button m2-button-secondary" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
