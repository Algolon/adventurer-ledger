"use client";

/**
 * Settings is a destination you can come back from.
 *
 * On the pilot device the app is installed, so it has no browser chrome and no
 * URL bar: the system Back gesture is the only "back" there is. Settings was
 * pure React state with no history entry behind it, which meant Back from
 * Settings did not return to the screen the user had come from — it left the
 * app entirely. Opening Settings to check something and being thrown out of
 * Runefolio is the defect this module exists to remove.
 *
 * The model is deliberately small, and it is the whole model:
 *
 * - The root destinations — Characters, Sheet, Compendium — do **not** push
 *   history. Tabs are not pages. If they were, Back would walk backwards
 *   through every tab the user had ever touched before it ever left the app,
 *   which is worse than the problem being fixed.
 * - Entering Settings pushes exactly one entry, and records the destination it
 *   was entered from.
 * - Leaving Settings pops exactly that one entry, however it is left: by the
 *   system Back gesture, or by tapping another destination. The stack returns
 *   to the depth it had before, so Back from a root destination still exits the
 *   app the way an installed app is expected to.
 * - Entering Settings while already in Settings does nothing at all, and in
 *   particular does not push a second entry that would need two Back presses to
 *   unwind.
 *
 * Everything is expressed against `history.state`, never against the URL. The
 * app is a static export served from a base path, and inventing paths under it
 * would produce entries that 404 on a cold reload.
 */
import { useCallback, useEffect, useRef } from "react";

/** The destinations the bottom navigation offers. */
export type RootDestination = "characters" | "sheet" | "compendium";

/** What this module writes into `history.state`. Namespaced, so a state object
 * written by anything else is left alone rather than being misread as ours. */
interface RunefolioHistoryState {
  runefolio: { view: "settings"; from: RootDestination };
}

const readState = (value: unknown): RunefolioHistoryState["runefolio"] | null => {
  if (typeof value !== "object" || value === null) return null;
  const carried = (value as { runefolio?: unknown }).runefolio;
  if (typeof carried !== "object" || carried === null) return null;
  const candidate = carried as { view?: unknown; from?: unknown };
  if (candidate.view !== "settings") return null;
  if (candidate.from !== "characters" && candidate.from !== "sheet" && candidate.from !== "compendium") return null;
  return { view: "settings", from: candidate.from };
};

export interface SettingsNavigation {
  /** Enters Settings from `from`. A no-op when already there. */
  openSettings(from: RootDestination): void;
  /**
   * Leaves Settings for `destination`, unwinding the entry Settings pushed.
   * A no-op when not in Settings, so ordinary tab switching never touches
   * history.
   */
  leaveSettings(destination: RootDestination): void;
}

/**
 * Owns the Settings history entry.
 *
 * Whether Settings is open stays with the caller — it is one value of the
 * caller's own view state, and duplicating it here would create two records of
 * the same fact that could disagree. This hook is told the current answer and
 * owns only the history mechanics.
 *
 * `onRestore` is called with the destination to show whenever the entry is
 * unwound: by the system Back gesture, or by a tap on another destination.
 */
export function useSettingsHistory(
  inSettings: boolean,
  onRestore: (destination: RootDestination | "settings") => void,
): SettingsNavigation {
  /**
   * Where a tap on another destination wants to go.
   *
   * Leaving Settings by tapping "Compendium" has to do two things — unwind the
   * history entry and land on Compendium — and only the first is synchronous.
   * `history.back()` resolves as a `popstate` on a later task, so the intended
   * destination is parked here and read when that arrives. Without it, tapping
   * a destination from Settings would unwind to whatever Settings was *entered*
   * from, which is not where the user just asked to go.
   */
  const leavingTo = useRef<RootDestination | null>(null);
  /**
   * The destination the live Settings entry was opened from.
   *
   * `popstate` reports the state of the entry being moved *to*, not the one
   * being left, so the `from` recorded on the Settings entry is unreadable at
   * exactly the moment it is needed. It is mirrored here when the entry is
   * pushed.
   */
  const previousFrom = useRef<RootDestination | null>(null);
  /** The freshest restore callback, so the popstate listener is bound once. */
  const restore = useRef(onRestore);
  restore.current = onRestore;

  /**
   * A reload leaves the stack claiming something the app is not showing.
   *
   * An installed app can be reloaded, restored from the background, or opened
   * cold on whatever entry it was killed on — and it always starts at
   * Characters, because none of its state is in the URL. If that entry still
   * carries the Settings marker, the stack now holds a Settings entry the app
   * has no matching screen for, and the next `back()` lands on it: the handler
   * below sees a Settings entry, treats it as a forward navigation, and the
   * user is left on a screen that does not respond to Back at all.
   *
   * Replacing the marker on mount is what keeps the stack and the app the same
   * shape. It is a replace, not a push, so the depth is untouched.
   */
  useEffect(() => {
    if (readState(window.history.state)) window.history.replaceState(null, "");
  }, []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      /*
       * Landing *on* a Settings entry is the user going forward again, after a
       * Back that left it. The entry is still valid and still records where it
       * was entered from, so Settings is shown and Back keeps working.
       */
      if (readState(event.state)) {
        leavingTo.current = null;
        previousFrom.current = readState(event.state)?.from ?? null;
        restore.current("settings");
        return;
      }
      const parked = leavingTo.current;
      leavingTo.current = null;
      /*
       * With no parked destination this is the system Back gesture, and the
       * honest answer is the screen Settings was opened from. That value was
       * recorded on the entry being left rather than in component state,
       * because component state does not survive the reload that an installed
       * app can be killed and restored by.
       */
      restore.current(parked ?? previousFrom.current ?? "characters");
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openSettings = useCallback(
    (from: RootDestination) => {
      // Already there: no second entry, and nothing to announce.
      if (inSettings) return;
      const state: RunefolioHistoryState = { runefolio: { view: "settings", from } };
      previousFrom.current = from;
      window.history.pushState(state, "");
    },
    [inSettings],
  );

  const leaveSettings = useCallback(
    (destination: RootDestination) => {
      if (!inSettings) return;
      leavingTo.current = destination;
      /*
       * `back()` rather than `pushState` of the destination. Pushing would grow
       * the stack every time the user looked at Settings, so the number of Back
       * presses needed to leave the app would depend on how many times they had
       * opened it. Unwinding keeps the stack exactly as deep as it was.
       */
      window.history.back();
    },
    [inSettings],
  );

  return { openSettings, leaveSettings };
}
