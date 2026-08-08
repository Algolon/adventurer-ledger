"use client";

/**
 * The Runefolio application shell.
 *
 * Mobile primary navigation is Characters, Sheet, Compendium and Settings in a
 * persistent bottom bar. A modal task — creation, level up or a transfer
 * confirmation — replaces the bottom bar with a task footer so the primary next
 * action stays visible at 360 px. At an effective 960 CSS px and above the same
 * destinations become a compact persistent rail, which falls back to the bottom
 * bar under zoom or width pressure because the query is expressed in CSS pixels.
 *
 * Settings is one of those four destinations, and used to be a large gear in the
 * top-right of the app bar instead. Two things were wrong with that. Sitting in
 * the header — beside the wordmark, above the character's own screen — it read
 * as settings *for what is on screen*, when it configures the application. And
 * it had no history behind it, so on an installed phone with no browser chrome
 * the system Back gesture from Settings left Runefolio altogether rather than
 * returning to the screen the user came from. Both follow from where it lived,
 * so it has moved to where it belongs: labelled, global, and beside its peers.
 * The history model is in `settings-history.ts`.
 */
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { BookOpen, Settings, Swords, UserRound } from "lucide-react";
import { BrandMark } from "@/src/ui/brand-mark";
import { ContentWorkspace } from "@/src/ui/content-workspace";
import { ServicesProvider, useServices } from "@/src/ui/services-context";
import { CharacterLibrary, type LibraryDestination } from "@/src/ui/character-library";
import { PortraitGuard, useMobileLandscape, usePortraitLock } from "@/src/ui/portrait-guard";
import { CharacterBuilder } from "@/src/ui/character-builder";
import { PlaySheet } from "@/src/ui/play-sheet";
import { LevelUpDialog } from "@/src/ui/level-up-dialog";
import { Dialog } from "@/src/ui/primitives";
import { SettingsView } from "@/src/ui/settings-view";
import { useSettingsHistory, type RootDestination } from "@/src/ui/settings-history";
import { TransferPanel } from "@/src/ui/transfer-panel";
import type { RulesetSelection } from "@/src/services/content-install-service";
import type { EditDraftRepairNote } from "@/src/services/edit-draft";
import "./m2.css";
import "./sheet.css";

type View = "characters" | "sheet" | "compendium" | "settings" | "transfer";

/**
 * The four global destinations, in the bottom bar and in the wide rail alike.
 *
 * Settings is last and carries an ordinary cog. A cog is only ambiguous when it
 * is unlabelled and parked in a header next to the thing it is not configuring;
 * labelled and sitting beside Characters, Sheet and Compendium, it reads as
 * what it is.
 */
const PRIMARY_NAV: readonly { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "characters", label: "Characters", icon: <UserRound aria-hidden="true" /> },
  { id: "sheet", label: "Sheet", icon: <Swords aria-hidden="true" /> },
  { id: "compendium", label: "Compendium", icon: <BookOpen aria-hidden="true" /> },
  { id: "settings", label: "Settings", icon: <Settings aria-hidden="true" /> },
];

/** The destinations Settings can be entered from, and returned to. */
const ROOT_DESTINATIONS = new Set<View>(["characters", "sheet", "compendium"]);

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
  /** The character a delete confirmation is currently asking about. */
  const [deleteTarget, setDeleteTarget] = useState<{ characterId: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Guards a double-press: one confirmation must produce one delete. */
  const deletingRef = useRef<string | null>(null);
  /** The unfinished build a discard confirmation is currently asking about. */
  const [discardTarget, setDiscardTarget] = useState<{ draftId: string; name: string; revision: number } | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const discardingRef = useRef<string | null>(null);
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
        /*
         * Delete only asks. The menu item raises the question and the
         * confirmation answers it, so nothing is removed by the press that
         * opened the menu or by the press that chose the item.
         */
        case "delete":
          setDeleteTarget({ characterId: destination.characterId, name: destination.name });
          return;
        // Same contract for an unfinished build: the menu asks, the dialog answers.
        case "discard":
          setDiscardTarget({
            draftId: destination.draftId,
            name: destination.name,
            revision: destination.revision,
          });
          return;
      }
    },
    [drafts, library, refresh, startNewCharacter],
  );

  // A modal task owns the whole surface and supplies its own task footer.
  const modalTask = builderDraftId !== null;

  /**
   * Which workspace is on screen.
   *
   * Not the same thing as `view`: a modal task and the sheet of one particular
   * character are workspaces of their own, and moving between two characters'
   * sheets is a navigation even though `view` never changes. This string is the
   * identity of the surface, and a change in it is what the effect below treats
   * as arriving somewhere new.
   */
  const workspace = modalTask
    ? `task:${builderDraftId}`
    : view === "sheet"
      ? `sheet:${activeCharacterId ?? "none"}`
      : view;

  /**
   * A workspace change is a page change: the new surface is already at its top
   * the first time it is painted.
   *
   * The document scrolls, not an inner pane, so nothing about swapping `view`
   * moves the viewport — React replaced the content underneath a scrolled window
   * and left the offset exactly where it was. On the pilot's handset that made
   * committing a character from a part-scrolled Review open the sheet half way
   * down itself. It is the same defect PR #19 fixed *between creation steps*,
   * one level up: the builder reset the scroll on every step change, and then
   * handed the user to a different screen entirely without doing it again.
   *
   * The fix is deliberately the same shape as that one, for the same reasons.
   * `useLayoutEffect` runs after React has swapped the workspace into the DOM
   * and before the browser paints, so the offset is established in the frame
   * that first shows the new surface — a passive effect guarantees one painted
   * frame of the new screen at the old offset. And the scroll is instant, not
   * smooth: animating back to zero and then revealing the destination is travel
   * the user watches through content they have already left, which is exactly
   * what the second pilot reported about the first attempt at the step fix.
   *
   * Focus is untouched here. Each workspace already moves focus where it
   * belongs — the builder to its step heading, a dialog to its safe control —
   * and a second opinion from the shell would fight them.
   */
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [workspace]);

  /** Closes whatever modal task is open, leaving `view` to the caller. */
  const closeTask = useCallback(() => {
    setBuilderDraftId(null);
    setEditRepairs([]);
    setEditError(null);
  }, []);

  /**
   * Settings' history entry, and the way back out of it.
   *
   * The hook is told whether Settings is open rather than deciding it: `view`
   * is already the record of what is on screen, and a second copy of that fact
   * is a second thing that can be wrong.
   */
  const settingsHistory = useSettingsHistory(view === "settings", destination => {
    closeTask();
    setView(destination);
  });

  /**
   * Anything the app closes on its own has to leave Settings the same way a tap
   * would, or the pushed entry outlives the screen it belongs to.
   */
  const leaveSettingsFor = (destination: RootDestination) => {
    if (view === "settings") settingsHistory.leaveSettings(destination);
    else setView(destination);
  };

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
   *
   * Settings is the one destination with history behind it, so both directions
   * across that boundary are routed through the hook rather than by assigning
   * `view` directly: entering pushes one entry, leaving unwinds exactly that
   * entry, and doing neither is what keeps ordinary tab switching out of the
   * back stack entirely.
   */
  const leaveTo = (destination: View) => {
    /*
     * Tapping the destination already showing is a no-op — but only when it is
     * genuinely already showing. With a build open the task owns the surface,
     * so "Characters" while `view` is already `characters` is a real request to
     * leave the task and see the library, and the wide layout is where a user
     * can make it: the rail stays beside the task rather than under it.
     */
    if (destination === view && !modalTask) return;

    if (destination === "settings") {
      closeTask();
      const from = ROOT_DESTINATIONS.has(view) ? (view as RootDestination) : "characters";
      settingsHistory.openSettings(from);
      setView("settings");
      return;
    }

    if (view === "settings" && ROOT_DESTINATIONS.has(destination)) {
      /*
       * `leaveSettings` unwinds the pushed entry and the resulting popstate
       * lands the view, so nothing is assigned here — assigning as well would
       * paint the destination once now and once again a task later.
       */
      closeTask();
      settingsHistory.leaveSettings(destination as RootDestination);
      return;
    }

    closeTask();
    setView(destination);
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
        {/*
         * The wordmark, and nothing else.
         *
         * The header used to carry an offline-readiness dot on its trailing
         * edge. Below 600 px its label did not fit and was hidden, so on every
         * phone it was an unlabelled mark alone in the top-right — and once
         * Settings moved into the bottom navigation it was the only thing left
         * up there, which is why the pilot read it as an artefact rather than
         * as status. The fact still matters and still has a home: it is stated
         * in full under Settings · Offline, beside the paragraph that explains
         * what offline means for a local-first app.
         */}
        <header className="m2-appbar">
          <div className="m2-appbar-brand">
            <BrandMark decorative variant="inverse" />
            <strong>Runefolio</strong>
          </div>
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
                /*
                 * Opening a character *from* Settings is leaving Settings, so
                 * it unwinds the entry rather than abandoning it. Setting the
                 * view directly here would leave a Settings entry behind the
                 * sheet, and the next Back would return to a Settings screen
                 * the user had already left.
                 */
                leaveSettingsFor("sheet");
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

        {deleteTarget ? (
          <DeleteCharacterDialog
            name={deleteTarget.name}
            error={deleteError}
            onCancel={() => {
              setDeleteTarget(null);
              setDeleteError(null);
            }}
            onConfirm={() => {
              const { characterId } = deleteTarget;
              if (deletingRef.current === characterId) return;
              deletingRef.current = characterId;
              void library
                .delete(characterId)
                .then(outcome => {
                  /*
                   * `not-found` means it is already gone — a repeated confirm,
                   * or a delete from another tab. The user asked for it to not
                   * exist, and it does not, so that is success from here.
                   */
                  if (outcome.status !== "ok" && outcome.status !== "not-found") {
                    setDeleteError("That character could not be deleted on this device. Nothing has been changed.");
                    return;
                  }
                  setDeleteTarget(null);
                  setDeleteError(null);
                  // Whatever was open about that character is no longer a thing
                  // that can be shown, so the app returns to the library.
                  if (activeCharacterId === characterId) setActiveCharacterId(null);
                  if (levelUpFor === characterId) setLevelUpFor(null);
                  setBuilderDraftId(null);
                  setView("characters");
                  refresh();
                })
                .finally(() => {
                  deletingRef.current = null;
                });
            }}
          />
        ) : null}

        {discardTarget ? (
          <DiscardDraftDialog
            name={discardTarget.name}
            error={discardError}
            onCancel={() => {
              setDiscardTarget(null);
              setDiscardError(null);
            }}
            onConfirm={() => {
              const { draftId, revision } = discardTarget;
              if (discardingRef.current === draftId) return;
              discardingRef.current = draftId;
              void drafts
                .discard(draftId, revision)
                .then(outcome => {
                  /*
                   * `not-found` means the build is already gone — a repeated
                   * confirm, or a discard from another tab. The user asked for
                   * it not to exist, and it does not.
                   */
                  if (outcome.status !== "ok" && outcome.status !== "not-found") {
                    setDiscardError(
                      outcome.status === "stale"
                        ? "That build changed on this device while the question was open. Nothing has been discarded — open it again to see where it is now."
                        : "That build could not be discarded on this device. Nothing has been changed.",
                    );
                    return;
                  }
                  setDiscardTarget(null);
                  setDiscardError(null);
                  // The builder cannot stay open on a build that no longer exists.
                  if (builderDraftId === draftId) setBuilderDraftId(null);
                  setView("characters");
                  refresh();
                })
                .finally(() => {
                  discardingRef.current = null;
                });
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

/**
 * The one confirmation that stands between the menu and a permanent local
 * delete.
 *
 * `alertdialog` because it interrupts to report a consequence, so the
 * description is announced rather than only the title. Focus opens on Cancel:
 * the destructive action must never be what a habitual Enter reaches, and
 * Escape or Cancel returns focus to the control that opened the menu, which the
 * Dialog primitive already restores.
 *
 * One explicit confirmation is the whole friction. Nothing here asks the user
 * to retype the name — the product uses no such convention elsewhere, and
 * inventing one here would be ceremony rather than safety.
 */
/**
 * Discarding an unfinished build.
 *
 * Deliberately not the delete dialog with different words. There is no play
 * state, no history and no other device involved, so the copy says only what is
 * true — an unfinished build goes, and nothing else does — and the confirming
 * control says "Discard build" rather than borrowing "Delete character", which
 * would describe a larger act than the one being taken.
 */
function DiscardDraftDialog({
  name,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const describedBy = useId();
  return (
    <Dialog
      title={`Discard ${name}?`}
      role="alertdialog"
      describedBy={describedBy}
      // Cancel takes focus, so the safe answer is the one already under the thumb.
      initialFocusRef={cancelRef}
      onClose={onCancel}
      footer={
        <div className="m2-dialog-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            Discard build
          </button>
        </div>
      }
    >
      <p id={describedBy}>
        This throws away the unfinished build <b>{name}</b> and every choice made in it so far. It is stored only on this
        device, so there is no copy elsewhere to restore from.
      </p>
      <p className="m2-muted">Your content packs, rulesets and finished characters are not affected.</p>
      {error ? (
        <p className="m2-inline-issue" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

function DeleteCharacterDialog({
  name,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const describedBy = useId();
  return (
    <Dialog
      title={`Delete ${name}?`}
      role="alertdialog"
      describedBy={describedBy}
      initialFocusRef={cancelRef}
      onClose={onCancel}
      footer={
        <div className="m2-dialog-actions">
          <button type="button" className="btn" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            Delete character
          </button>
        </div>
      }
    >
      <p id={describedBy}>
        This permanently deletes <b>{name}</b> from this device, along with its build history, any unfinished edit and
        its play state. Nothing is synchronised, so there is no copy elsewhere to restore from.
      </p>
      <p className="m2-muted">Your content packs, rulesets and other characters are not affected.</p>
      {error ? (
        <p className="m2-inline-issue" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
