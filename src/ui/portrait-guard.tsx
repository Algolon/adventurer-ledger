"use client";

/**
 * The portrait guard.
 *
 * Runefolio is portrait-only on a phone. Where the platform honours the
 * manifest or the Screen Orientation API, the guard never appears — the device
 * simply does not rotate. Where it does not (iOS, any browser tab, a device
 * with rotation forced on), turning the phone on its side would otherwise
 * expose a layout that was never designed for it, so the guard covers the app
 * and asks for the phone back upright.
 *
 * What it deliberately does *not* do:
 *
 *   - It does not rotate the app with a CSS transform. A transformed app has
 *     the wrong hit targets, the wrong scroll axis and unusable text selection,
 *     and it lies to the screen reader about the reading order.
 *   - It does not unmount the app. The tree below stays mounted, so an
 *     in-progress build, a half-typed name, an open drawer and the scroll
 *     position are all exactly where they were when portrait returns.
 *   - It does not appear on desktop or on tablets. See `isPhoneContext`.
 *
 * Accessibility tradeoff: this is a deliberate restriction, documented in
 * `docs/MOBILE_VISUAL_CONTRACT.md`. Someone whose phone is mounted, braced or
 * held in a fixed landscape position — which includes many users of switch
 * access, mounting arms and wheelchair-mounted holders — cannot reach the app
 * at all while the guard is up. The guard is therefore scoped to phones only,
 * never to tablets or desktop windows, where a landscape layout is supported.
 */

import { useEffect, useRef, useState } from "react";
import { RotateCcwSquare } from "lucide-react";
import {
  isLandscape,
  isPhoneContext,
  requestPortraitLock,
  type OrientationEnvironment,
} from "@/src/pwa/orientation";

/** Reads the live window. Split out so tests can drive the rules directly. */
function readWindow(): OrientationEnvironment | null {
  if (typeof window === "undefined") return null;
  return window as unknown as OrientationEnvironment;
}

/**
 * Whether the phone is currently sideways.
 *
 * Both `resize` and `orientationchange` are observed: Android fires the former
 * reliably, iOS Safari the latter, and neither alone covers a split-screen
 * resize. `visualViewport` is not used — it moves with the on-screen keyboard,
 * which is not a rotation.
 */
export function useMobileLandscape(): boolean {
  const [sideways, setSideways] = useState(false);

  useEffect(() => {
    const environment = readWindow();
    if (!environment) return;
    const evaluate = () => setSideways(isPhoneContext(environment) && isLandscape(environment));
    evaluate();
    window.addEventListener("resize", evaluate);
    window.addEventListener("orientationchange", evaluate);
    return () => {
      window.removeEventListener("resize", evaluate);
      window.removeEventListener("orientationchange", evaluate);
    };
  }, []);

  return sideways;
}

/**
 * Asks the platform to hold portrait, exactly once per mount.
 *
 * The ref is the point. Re-asking on every render or on every orientation
 * change would be a loop against an API that has already answered, and on the
 * platforms where it answers "no" it answers "no" every time.
 */
export function usePortraitLock(): void {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const environment = readWindow();
    if (!environment) return;
    // The outcome is deliberately unused: an unavailable or declined lock is a
    // capability gap, not a failure, and the user is told nothing about it.
    void requestPortraitLock(environment);
  }, []);
}

/**
 * The full-screen "turn your phone upright" cover.
 *
 * Rendered as a sibling of the app rather than a wrapper, so mounting and
 * unmounting it never remounts the app. The caller marks the app `inert` while
 * this is up, which is what stops focus, pointer events and the accessibility
 * tree from reaching the UI underneath.
 */
export function PortraitGuard() {
  return (
    <div className="portrait-guard" role="alert">
      <RotateCcwSquare aria-hidden="true" className="portrait-guard-icon" />
      <h2>Turn your phone upright</h2>
      <p>Runefolio is designed for portrait. Nothing has been lost — your place is kept.</p>
    </div>
  );
}
