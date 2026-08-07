"use client";

/**
 * Settings, grouped by the job the user is doing rather than by storage table.
 *
 * Packs, sources, rulesets, imports, exports, transfer, backups, storage,
 * offline readiness and updates all live here so they stop competing with
 * Characters in primary navigation. The same labels and state appear on desktop
 * through the persistent rail.
 */
import { useState } from "react";
import { Archive, Download, FolderLock, HardDrive, Import, RefreshCw, ScrollText, ShieldCheck, WifiOff } from "lucide-react";
import { RULESET_PRIVACY_LABELS } from "@/src/services/content-scope";
import { ContentWorkspace } from "@/src/ui/content-workspace";
import { StorageSettings } from "@/src/ui/storage-settings";
import { TransferPanel } from "@/src/ui/transfer-panel";
import { useAsync, useServices } from "@/src/ui/services-context";

type SettingsPage =
  | "overview"
  | "packs"
  | "sources"
  | "rulesets"
  | "transfer"
  | "imports-exports"
  | "backups"
  | "storage"
  | "offline"
  | "updates";

const GROUPS: readonly { group: string; items: readonly { id: SettingsPage; label: string; icon: React.ReactNode }[] }[] = [
  {
    group: "Content",
    items: [
      { id: "packs", label: "Content packs", icon: <Archive aria-hidden="true" /> },
      { id: "sources", label: "Sources", icon: <ScrollText aria-hidden="true" /> },
    ],
  },
  {
    group: "Rules",
    items: [{ id: "rulesets", label: "Rulesets", icon: <ShieldCheck aria-hidden="true" /> }],
  },
  {
    group: "Data & transfer",
    items: [
      { id: "transfer", label: "Transfer", icon: <Import aria-hidden="true" /> },
      { id: "imports-exports", label: "Imports and exports", icon: <Download aria-hidden="true" /> },
      { id: "backups", label: "Backups", icon: <FolderLock aria-hidden="true" /> },
    ],
  },
  {
    group: "Device & app",
    items: [
      { id: "storage", label: "Storage", icon: <HardDrive aria-hidden="true" /> },
      { id: "offline", label: "Offline", icon: <WifiOff aria-hidden="true" /> },
      { id: "updates", label: "Updates", icon: <RefreshCw aria-hidden="true" /> },
    ],
  },
];

export function SettingsView({ onOpenCharacter }: { onOpenCharacter(id: string): void }) {
  const [page, setPage] = useState<SettingsPage>("overview");

  if (page !== "overview")
    return (
      <section className="m2-page">
        <button type="button" className="m2-button" onClick={() => setPage("overview")}>
          Back to Settings
        </button>
        <SettingsPageBody page={page} onOpenCharacter={onOpenCharacter} />
      </section>
    );

  return (
    <section className="m2-page">
      <h2 className="m2-page-title">Settings</h2>
      {GROUPS.map(group => (
        <section key={group.group} aria-labelledby={`group-${group.group}`}>
          <h3 className="m2-section-title" id={`group-${group.group}`}>
            {group.group}
          </h3>
          <ul className="m2-list">
            {group.items.map(item => (
              <li key={item.id} className="m2-row">
                <button type="button" className="m2-row-primary" onClick={() => setPage(item.id)}>
                  <span className="m2-monogram" aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className="m2-row-text">
                    <b>{item.label}</b>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="m2-muted">
        Every character, pack and source stays in this browser profile. There is no account, sync API or upload endpoint.
      </p>
    </section>
  );
}

/**
 * Installed rulesets, and the packs that could still become one.
 *
 * An imported pack with no profile is installed and unreachable, so the offer to
 * create its profile belongs here as well as at the import boundary. Activation
 * is explicit: the active ruleset is the one a new build starts in, and nothing
 * picks it from the order of this list.
 *
 * Inspecting the list also repairs it. A device that updated a pack before the
 * install transaction carried the profile with it holds a ruleset still scoped
 * to the older, smaller membership, and the only visible symptom is a count that
 * disagrees with the pack. The repair replaces a pack-derived membership with
 * that same pack's current one and changes nothing else, so it is done on the
 * way in and then said plainly rather than left as a button the user has to know
 * to press.
 */
function RulesetsPage() {
  const { install, refresh } = useServices();
  const installedState = useAsync(() => install.inspectInstalledRulesets(), []);
  const pendingState = useAsync(() => install.pendingOffers(), []);
  const activeState = useAsync(() => install.activeRulesetId(), []);
  const rulesets = installedState.status === "ready" ? installedState.value.views : [];
  const repaired = installedState.status === "ready" ? installedState.value.repaired : [];
  const pending = pendingState.status === "ready" ? pendingState.value : [];
  const active = activeState.status === "ready" ? activeState.value : undefined;

  return (
    <div className="m2-step">
      <h2 className="m2-page-title">Rulesets</h2>
      {repaired.length ? (
        <p className="m2-muted" role="status">
          {repaired.length === 1
            ? `1 ruleset was updated to match its installed content pack, and now activates ${repaired[0].entryCount} entries.`
            : `${repaired.length} rulesets were updated to match their installed content packs.`}
        </p>
      ) : null}
      {rulesets.length ? (
        rulesets.map(ruleset => (
          <div className="m2-card" key={ruleset.id}>
            <div className="m2-card-head">
              <h3>{ruleset.name}</h3>
              <span className="m2-badge">{ruleset.id === active ? "Active" : "Installed"}</span>
            </div>
            <p className="m2-muted">
              {ruleset.entryCount} entries · creation levels 1 to {ruleset.maxSupportedLevel}
              {ruleset.usable ? "" : ` · missing ${ruleset.missingCategories.join(", ")}`}
            </p>
            {/*
             * Whether this profile reaches private or export-restricted content,
             * classified from record metadata. Private content stays local; this
             * says that it is in scope without reproducing any of it.
             */}
            <p className="m2-muted m2-ruleset-privacy">{RULESET_PRIVACY_LABELS[ruleset.privacy]}</p>
            <p className="m2-muted">Active sources: {ruleset.activeSourceIds.join(", ")}</p>
            {ruleset.id === active ? null : (
              <button
                type="button"
                className="m2-button"
                onClick={() => void install.activate(ruleset.id).then(refresh)}
              >
                Use this ruleset for new characters
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="m2-muted">No ruleset profiles are installed on this device.</p>
      )}

      {pending.length ? (
        <>
          <h3 className="m2-section-title">Installed packs with no ruleset</h3>
          <p className="m2-muted">
            Content is only reachable through a ruleset. These packs are installed but nothing activates them yet.
          </p>
          {pending.map(offer => (
            <div className="m2-card" key={offer.packId}>
              <div className="m2-card-head">
                <h3>{offer.name}</h3>
                <span className="m2-badge">{offer.entryCount} entries</span>
              </div>
              {offer.usable ? (
                <button
                  type="button"
                  className="m2-button m2-button-primary"
                  onClick={() => void install.createRulesetForPack(offer.packId).then(refresh)}
                >
                  Create its ruleset
                </button>
              ) : (
                <p className="m2-muted">
                  This pack cannot stand as a ruleset on its own: it supplies no {offer.missingCategories.join(", ")}.
                </p>
              )}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function SettingsPageBody({ page, onOpenCharacter }: { page: SettingsPage; onOpenCharacter(id: string): void }) {
  switch (page) {
    case "packs":
      return <ContentWorkspace view="Content packs" />;
    case "sources":
      return <ContentWorkspace view="Sources" />;
    case "imports-exports":
      return <ContentWorkspace view="Imports & exports" />;
    case "transfer":
      return <TransferPanel onImported={onOpenCharacter} />;
    case "storage":
      return <StorageSettings />;
    case "rulesets":
      return <RulesetsPage />;
    case "backups":
      return (
        <div className="m2-step">
          <h2 className="m2-page-title">Backups</h2>
          <p className="m2-muted">
            A character transfer file is the supported way to move or keep a copy of one character in M2.1. Full encrypted
            vault backups are a later increment; nothing here creates one yet.
          </p>
        </div>
      );
    case "offline":
      return (
        <div className="m2-step">
          <h2 className="m2-page-title">Offline</h2>
          <p className="m2-muted">
            After one successful online load, the app shell is cached. The library, active sheet, explanations backed by
            local content, play actions and local history all work with no network.
          </p>
        </div>
      );
    case "updates":
      return (
        <div className="m2-step">
          <h2 className="m2-page-title">Updates</h2>
          <p className="m2-muted">
            Updates wait for your explicit action and never reload during creation or play. Storage details are under
            Settings, Storage.
          </p>
        </div>
      );
    default:
      return null;
  }
}
