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
import { ContentWorkspace } from "@/src/ui/content-workspace";
import { StorageSettings } from "@/src/ui/storage-settings";
import { TransferPanel } from "@/src/ui/transfer-panel";
import { SYNTHETIC_RULESET } from "@/src/content/runefolio-synthetic";

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
      return (
        <div className="m2-step">
          <h2 className="m2-page-title">Rulesets</h2>
          <div className="m2-card">
            <div className="m2-card-head">
              <h3>{SYNTHETIC_RULESET.name}</h3>
              <span className="m2-badge">Active</span>
            </div>
            <p className="m2-muted">
              Conflict resolution: {SYNTHETIC_RULESET.conflictResolution} · requirement enforcement:{" "}
              {SYNTHETIC_RULESET.requirementEnforcement} · legacy content {SYNTHETIC_RULESET.allowLegacy ? "allowed" : "not allowed"}.
            </p>
            <p className="m2-muted">Active sources: {SYNTHETIC_RULESET.activeSourceIds.join(", ")}</p>
          </div>
        </div>
      );
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
