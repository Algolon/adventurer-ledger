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
import { defaultRulesetFor } from "@/src/services/ruleset-service";
import { useCallback, useRef, useState } from "react";
import { BookOpen, Settings, Swords, UserRound } from "lucide-react";
import { BrandMark } from "@/src/ui/brand-mark";
import { PwaIndicator } from "@/src/ui/pwa-status";
import { ContentWorkspace } from "@/src/ui/content-workspace";
import { ServicesProvider, useServices } from "@/src/ui/services-context";
import { CharacterLibrary, type LibraryDestination } from "@/src/ui/character-library";
import { CharacterBuilder } from "@/src/ui/character-builder";
import { PlaySheet } from "@/src/ui/play-sheet";
import { LevelUpDialog } from "@/src/ui/level-up-dialog";
import { SettingsView } from "@/src/ui/settings-view";
import { TransferPanel } from "@/src/ui/transfer-panel";
import "./m2.css";

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
  const { drafts, query, library, refresh } = useServices();
  const [view, setView] = useState<View>("characters");
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [builderDraftId, setBuilderDraftId] = useState<string | null>(null);
  const [levelUpFor, setLevelUpFor] = useState<string | null>(null);

  /** The ruleset a new build starts in: whichever profile is installed. */
  /**
   * Never `installed[0]`: that let whichever profile sorted first decide which
   * rules a new character used, so importing a pack could silently change the
   * default. `defaultRulesetFor` returns undefined when the choice is genuinely
   * ambiguous, and the builder's first step asks instead of guessing.
   */
  const lastUsedRulesetId = useRef<string | undefined>(undefined);
  const defaultRulesetId = useCallback(async () => {
    const selectable = await query.selectableRulesets();
    return defaultRulesetFor(selectable, lastUsedRulesetId.current);
  }, [query]);

  const startNewCharacter = useCallback(async () => {
    const rulesetProfileId = await defaultRulesetId();
    if (!rulesetProfileId) return;
    const draftId = `draft:${Date.now().toString(36)}`;
    lastUsedRulesetId.current = rulesetProfileId;
    const outcome = await drafts.create({ draftId, rulesetProfileId, level: 1, presentation: "guided" });
    if (outcome.status === "ok") {
      setBuilderDraftId(draftId);
      refresh();
    }
  }, [defaultRulesetId, drafts, refresh]);

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
          // Editing a committed character opens a draft bound to it, in that
          // character's own ruleset.
          const draftId = `draft:edit:${destination.characterId}`;
          void query.sheet(destination.characterId).then(async sheet => {
            const rulesetProfileId = sheet?.activeRulesetId ?? (await defaultRulesetId());
            if (!rulesetProfileId) return;
            await drafts.create({
              draftId,
              rulesetProfileId,
              level: 1,
              presentation: "guided",
              editingCharacterId: destination.characterId,
            });
            setBuilderDraftId(draftId);
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
    [defaultRulesetId, drafts, library, query, refresh, startNewCharacter],
  );

  // A modal task owns the whole surface and supplies its own task footer.
  const modalTask = builderDraftId !== null;

  return (
    <div className="m2-shell">
      <header className="m2-appbar">
        <div className="m2-appbar-brand">
          <BrandMark decorative variant="inverse" />
          <strong>Runefolio</strong>
        </div>
        <PwaIndicator />
        <button
          type="button"
          className={view === "settings" ? "m2-appbar-settings m2-active" : "m2-appbar-settings"}
          onClick={() => setView("settings")}
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
                onClick={() => setView(item.id)}
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
              onClick={() => setView("settings")}
            >
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </button>
          </li>
        </ul>
      </nav>

      <main className="m2-main" id="main">
        {modalTask && builderDraftId ? (
          <CharacterBuilder
            draftId={builderDraftId}
            onClose={() => {
              setBuilderDraftId(null);
              refresh();
            }}
            onFinished={characterId => {
              setBuilderDraftId(null);
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

      {levelUpFor ? (
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
  );
}
