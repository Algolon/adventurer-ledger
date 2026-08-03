"use client";

/**
 * Wires the M2.1 application services for the React tree.
 *
 * This is the only place the UI touches the database handle, and it hands out
 * services rather than tables: no component below imports `db` or a Dexie
 * adapter. The synthetic slice content is seeded once on mount so a fresh device
 * has a ruleset to build against.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { db } from "@/src/storage/db";
import { createCharacterRepositories } from "@/src/storage/character-repositories";
import { seedSyntheticContent } from "@/src/content/seed-synthetic";
import {
  CharacterBuildCommitService,
  CharacterDraftService,
  CharacterQueryService,
  type ServiceContext,
} from "@/src/services/character-services";
import { CharacterRuntimeService } from "@/src/services/runtime-service";
import { CharacterLevelUpService } from "@/src/services/levelup-service";
import { CharacterTransferService } from "@/src/services/transfer-service";
import { CharacterLibraryService, CharacterOverrideService } from "@/src/services/character-services";

export interface CharacterServices {
  drafts: CharacterDraftService;
  commit: CharacterBuildCommitService;
  query: CharacterQueryService;
  runtime: CharacterRuntimeService;
  levelUp: CharacterLevelUpService;
  transfer: CharacterTransferService;
  overrides: CharacterOverrideService;
  library: CharacterLibraryService;
  ready: boolean;
  /** Bumped after any mutation so dependent reads refresh. */
  revision: number;
  refresh(): void;
}

const ServicesContext = createContext<CharacterServices | undefined>(undefined);

export function ServicesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);

  const services = useMemo(() => {
    const context: ServiceContext = { database: db, repositories: createCharacterRepositories(db) };
    return {
      drafts: new CharacterDraftService(context),
      commit: new CharacterBuildCommitService(context),
      query: new CharacterQueryService(context),
      runtime: new CharacterRuntimeService(context),
      levelUp: new CharacterLevelUpService(context),
      transfer: new CharacterTransferService(context),
      overrides: new CharacterOverrideService(context),
      library: new CharacterLibraryService(context),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    seedSyntheticContent(db)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // A failed seed must not blank the app; the library reports the empty state.
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<CharacterServices>(
    () => ({ ...services, ready, revision, refresh: () => setRevision(current => current + 1) }),
    [services, ready, revision],
  );
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): CharacterServices {
  const context = useContext(ServicesContext);
  if (!context) throw new Error("useServices requires ServicesProvider");
  return context;
}

export type AsyncState<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "failed" };

/** Reads through a service and re-reads whenever the services revision changes. */
export function useAsync<T>(read: () => Promise<T>, dependencies: readonly unknown[]): AsyncState<T> {
  const { ready, revision } = useServices();
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    read()
      .then(value => {
        if (!cancelled) setState({ status: "ready", value });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, revision, ...dependencies]);
  return state;
}
