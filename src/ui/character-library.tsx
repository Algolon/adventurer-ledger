"use client";

/**
 * The character library.
 *
 * A fresh database shows a real empty state with the two safe starting actions;
 * it never renders a synthetic "active character" as if it were persisted. Each
 * row's primary activation goes to the most appropriate destination, and Edit,
 * Level up, Duplicate, Export/Transfer and Archive stay secondary.
 */
import { useRef, useState } from "react";
import { ChevronRight, Import, Plus, Swords } from "lucide-react";
import { useAsync, useServices } from "@/src/ui/services-context";
import { AnchoredMenu, StateBadge } from "@/src/ui/primitives";
import type { DraftCard, LibraryCard } from "@/src/services/character-services";
import { BUILDER_STEPS } from "@/src/services/builder-steps";

export type LibraryDestination =
  | { kind: "sheet"; characterId: string; readOnly?: boolean }
  | { kind: "build"; draftId: string }
  | { kind: "edit"; characterId: string }
  | { kind: "level-up"; characterId: string }
  | { kind: "transfer"; characterId?: string }
  | { kind: "duplicate"; characterId: string; revision: number }
  | { kind: "archive"; characterId: string; revision: number }
  | { kind: "delete"; characterId: string; name: string }
  /*
   * Discarding an unfinished build and deleting a committed character are named
   * apart on purpose. One throws away a build in progress; the other removes a
   * character with play state and history behind it, and reading "Delete" in
   * both places would make the smaller act look like the larger one.
   */
  | { kind: "discard"; draftId: string; name: string; revision: number }
  | { kind: "new" };

const relative = (iso: string) => {
  const elapsed = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(elapsed / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export function CharacterLibrary({ onNavigate }: { onNavigate(destination: LibraryDestination): void }) {
  const { query } = useServices();
  const state = useAsync(() => query.library(), []);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  if (state.status === "loading")
    return (
      <section className="m2-page" aria-busy="true">
        <h2 className="m2-page-title">Characters</h2>
        <p className="m2-muted" role="status">
          Reading your local library…
        </p>
      </section>
    );

  if (state.status === "failed")
    return (
      <section className="m2-page">
        <h2 className="m2-page-title">Characters</h2>
        <div className="m2-banner m2-banner-error" role="alert">
          <strong>The local library could not be read</strong>
          <p>Your saved characters are still on this device. Reload the app to try again.</p>
        </div>
      </section>
    );

  const { characters, drafts } = state.value;
  const empty = characters.length === 0 && drafts.length === 0;

  return (
    <section className="m2-page">
      <div className="m2-page-head">
        <h2 className="m2-page-title">Characters</h2>
        <button type="button" className="m2-button m2-button-primary" onClick={() => onNavigate({ kind: "new" })}>
          <Plus aria-hidden="true" />
          New character
        </button>
      </div>

      {empty ? (
        <div className="m2-empty">
          <Swords aria-hidden="true" className="m2-empty-icon" />
          <h3>No characters on this device yet</h3>
          <p>
            Characters live only in this browser. Build one here, or bring one across from another device with a
            transfer file.
          </p>
          <div className="m2-empty-actions">
            <button type="button" className="m2-button m2-button-primary" onClick={() => onNavigate({ kind: "new" })}>
              <Plus aria-hidden="true" />
              New character
            </button>
            <button type="button" className="m2-button" onClick={() => onNavigate({ kind: "transfer" })}>
              <Import aria-hidden="true" />
              Import from another device
            </button>
          </div>
        </div>
      ) : null}

      {drafts.length ? (
        <>
          <h3 className="m2-section-title">Unfinished builds</h3>
          <ul className="m2-list">
            {drafts.map(draft => (
              <DraftRow
                key={draft.draftId}
                draft={draft}
                menuOpen={menuFor === draft.draftId}
                onToggleMenu={() => setMenuFor(menuFor === draft.draftId ? null : draft.draftId)}
                onResume={() => onNavigate({ kind: "build", draftId: draft.draftId })}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </>
      ) : null}

      {characters.length ? (
        <>
          <h3 className="m2-section-title">Your characters</h3>
          <ul className="m2-list">
            {characters.map(card => (
              <CharacterRow
                key={card.characterId}
                card={card}
                menuOpen={menuFor === card.characterId}
                onToggleMenu={() => setMenuFor(menuFor === card.characterId ? null : card.characterId)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function DraftRow({
  draft,
  menuOpen,
  onToggleMenu,
  onResume,
  onNavigate,
}: {
  draft: DraftCard;
  menuOpen: boolean;
  onToggleMenu(): void;
  onResume(): void;
  onNavigate(destination: LibraryDestination): void;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const resumeLabel = BUILDER_STEPS.find(step => step.id === draft.resumeStepId)?.label;

  return (
    <li className="m2-row">
      <button type="button" className="m2-row-primary" onClick={onResume}>
        <span className="m2-monogram" aria-hidden="true">
          {draft.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="m2-row-text">
          <b>{draft.name}</b>
          <small>
            <StateBadge state="incomplete" /> {draft.issueCount} issue{draft.issueCount === 1 ? "" : "s"} · edited on this
            device {relative(draft.updatedAt)}
          </small>
          {/*
           * The step's own label, not its ID. This printed the raw identifier
           * with its hyphens swapped for spaces, so the user read "spells
           * resources" — the engine's vocabulary, in the one place the library
           * tells them where they left off.
           */}
          {resumeLabel ? <small className="m2-muted">Resume: {resumeLabel}</small> : null}
        </span>
        <ChevronRight aria-hidden="true" />
        <span className="m2-visually-hidden">Resume building {draft.name}</span>
      </button>
      {/*
       * Named as the *build*, not just by the character's name. A draft opened
       * to edit a committed character carries that character's name, so both
       * rows would otherwise offer a control called "More actions for Ada" and
       * nothing but row order would say which one discarded a build and which
       * one deleted a character.
       */}
      <button
        type="button"
        ref={moreRef}
        className="m2-row-more"
        aria-expanded={menuOpen}
        aria-label={`More actions for unfinished build ${draft.name}`}
        onClick={onToggleMenu}
      >
        <span aria-hidden="true">···</span>
      </button>
      {menuOpen ? (
        <AnchoredMenu label={`Actions for unfinished build ${draft.name}`} onClose={onToggleMenu}>
          <li>
            <button type="button" onClick={onResume}>
              Resume building {draft.name}
            </button>
          </li>
          {/* Destructive, and last. This tap asks the question; the
              confirmation answers it. */}
          <li>
            <button
              type="button"
              className="m2-menu-destructive"
              // Focus returns to the trigger before the dialog mounts, so
              // Cancel lands back on the control the user came from.
              onClick={() => {
                onToggleMenu();
                moreRef.current?.focus();
                onNavigate({ kind: "discard", draftId: draft.draftId, name: draft.name, revision: draft.revision });
              }}
            >
              Discard {draft.name}
            </button>
          </li>
        </AnchoredMenu>
      ) : null}
    </li>
  );
}

function CharacterRow({
  card,
  menuOpen,
  onToggleMenu,
  onNavigate,
}: {
  card: LibraryCard;
  menuOpen: boolean;
  onToggleMenu(): void;
  onNavigate(destination: LibraryDestination): void;
}) {
  const moreRef = useRef<HTMLButtonElement>(null);

  const open = () => {
    if (card.primaryDestination === "build") onNavigate({ kind: "edit", characterId: card.characterId });
    else onNavigate({ kind: "sheet", characterId: card.characterId, readOnly: card.primaryDestination === "read-only-sheet" });
  };

  return (
    <li className="m2-row">
      <button type="button" className="m2-row-primary" onClick={open}>
        <span className="m2-monogram" aria-hidden="true">
          {card.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="m2-row-text">
          <b>{card.name}</b>
          <small>
            {card.classLabel ? `${card.classLabel} ${card.level}` : `Level ${card.level}`}
            {/* A badge appears only when something needs attention or the sheet
                is hand-entered; the nominal state needs no label. */}
            {card.state !== "automatic" ? (
              <>
                {" "}
                · <StateBadge state={card.state} />
              </>
            ) : null}
          </small>
          <small className="m2-muted">Saved on this device · {relative(card.updatedAt)}</small>
        </span>
        <ChevronRight aria-hidden="true" />
        <span className="m2-visually-hidden">
          Open {card.name}, {card.primaryDestination === "sheet" ? "active sheet" : "recovery view"}
        </span>
      </button>
      <button
        type="button"
        ref={moreRef}
        className="m2-row-more"
        aria-expanded={menuOpen}
        aria-label={`More actions for ${card.name}`}
        onClick={onToggleMenu}
      >
        <span aria-hidden="true">···</span>
      </button>
      {menuOpen ? (
        <AnchoredMenu label={`Actions for ${card.name}`} onClose={onToggleMenu}>
          <li>
            <button type="button" onClick={() => onNavigate({ kind: "edit", characterId: card.characterId })}>
              Edit build for {card.name}
            </button>
          </li>
          <li>
            <button type="button" onClick={() => onNavigate({ kind: "level-up", characterId: card.characterId })}>
              Level up {card.name}
            </button>
          </li>
          <li>
            <button type="button" onClick={() => onNavigate({ kind: "transfer", characterId: card.characterId })}>
              Export or transfer {card.name}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => onNavigate({ kind: "duplicate", characterId: card.characterId, revision: card.revision })}
            >
              Duplicate {card.name}
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => onNavigate({ kind: "archive", characterId: card.characterId, revision: card.revision })}
            >
              Archive {card.name}
            </button>
          </li>
          {/*
           * Destructive, and last. Selecting it opens a confirmation: this tap
           * asks the question, it does not answer it, so no single press from
           * the row can delete anything.
           */}
          <li>
            <button
              type="button"
              className="m2-menu-destructive"
              /*
               * Close the menu and put focus back on the trigger *before* the
               * confirmation mounts. The dialog restores focus to whatever was
               * active when it opened, so this is what makes Cancel return to
               * the control the user came from rather than to a menu item that
               * no longer exists.
               */
              onClick={() => {
                onToggleMenu();
                moreRef.current?.focus();
                onNavigate({ kind: "delete", characterId: card.characterId, name: card.name });
              }}
            >
              Delete {card.name}
            </button>
          </li>
        </AnchoredMenu>
      ) : null}
    </li>
  );
}
