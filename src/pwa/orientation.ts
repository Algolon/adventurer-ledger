/**
 * Portrait-first behaviour for the installed mobile app.
 *
 * Runefolio is a portrait product on a phone. The manifest states that for the
 * installed app, but a manifest only applies once installed and only on
 * platforms that honour it, so there are three layers and each one is allowed
 * to be absent:
 *
 *   1. `orientation: "portrait-primary"` in the manifest — Android, installed.
 *   2. `screen.orientation.lock()` at runtime — standalone display mode only,
 *      because every browser rejects it in a normal tab.
 *   3. The portrait guard, which covers the app when the device is landscape
 *      and neither of the above took effect. This is the only layer that is
 *      always available.
 *
 * Layers 1 and 2 are capabilities, not guarantees. A rejected lock is the
 * expected outcome on iOS, in every desktop browser and in any non-installed
 * tab; it is reported as `"unavailable"` and nothing is shown to the user.
 *
 * The environment is passed in rather than read from globals so the rules can
 * be tested without a browser.
 */

/** What a `screen.orientation.lock()` attempt actually did. */
export type PortraitLockOutcome =
  /** The platform accepted the lock. */
  | "locked"
  /** No API, or not running standalone. Expected on iOS and on desktop. */
  | "unavailable"
  /** The API exists and refused. Also expected; also not an error. */
  | "declined";

/**
 * The longest short-side, in CSS pixels, still treated as a phone.
 *
 * A phone in landscape is wide and short, so the *short* side is the stable
 * measure: a Pixel 7 reports 412x915 upright and 915x412 on its side, and 412
 * is the number that does not move. 540 sits above every mainstream phone and
 * below a 768 px tablet, which keeps the guard off tablets and desktops as the
 * contract requires.
 */
export const PHONE_MAX_SHORT_SIDE = 540;

/** The subset of `window` these rules read. */
export interface OrientationEnvironment {
  matchMedia(query: string): { matches: boolean };
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly screen?: {
    readonly orientation?: {
      lock?(orientation: string): Promise<void>;
    };
  };
}

/**
 * Whether this is a phone-shaped, touch-driven context.
 *
 * Both halves matter. A coarse pointer alone would include a touchscreen
 * laptop; a small viewport alone would include a narrow desktop window and a
 * desktop browser at 200% zoom, neither of which may ever see the guard.
 */
export function isPhoneContext(environment: OrientationEnvironment): boolean {
  if (!environment.matchMedia("(pointer: coarse)").matches) return false;
  return Math.min(environment.innerWidth, environment.innerHeight) <= PHONE_MAX_SHORT_SIDE;
}

/** Whether the viewport is currently wider than it is tall. */
export function isLandscape(environment: OrientationEnvironment): boolean {
  return environment.innerWidth > environment.innerHeight;
}

/**
 * Whether the app is running as an installed app rather than in a browser tab.
 *
 * Only the installed app may attempt an orientation lock: the API rejects the
 * call outright in a tab, and asking anyway would be a guaranteed rejection on
 * every page load.
 */
export function isStandalone(environment: OrientationEnvironment): boolean {
  return environment.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Asks the platform for portrait, once.
 *
 * Never throws and never reports a failure to the user. A missing API, a tab
 * rather than an installed app, and an outright refusal are all the same thing
 * from the product's point of view: this device will not lock, so the portrait
 * guard is what enforces the contract instead.
 *
 * Callers must invoke this at most once per session — see `usePortraitLock`,
 * which holds the attempt behind a ref. Retrying on every orientation change
 * would be a loop against an API that already said no.
 */
export async function requestPortraitLock(
  environment: OrientationEnvironment,
): Promise<PortraitLockOutcome> {
  if (!isPhoneContext(environment)) return "unavailable";
  if (!isStandalone(environment)) return "unavailable";
  const lock = environment.screen?.orientation?.lock;
  if (typeof lock !== "function") return "unavailable";
  try {
    await lock.call(environment.screen?.orientation, "portrait-primary");
    return "locked";
  } catch {
    return "declined";
  }
}
