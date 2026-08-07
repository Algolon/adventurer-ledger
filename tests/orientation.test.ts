import { describe, expect, it, vi } from "vitest";
import {
  PHONE_MAX_SHORT_SIDE,
  isLandscape,
  isPhoneContext,
  isStandalone,
  requestPortraitLock,
  type OrientationEnvironment,
} from "@/src/pwa/orientation";

/**
 * The portrait rules, tested without a browser.
 *
 * The browser suite can prove the guard appears and that state survives a
 * rotation, but it cannot easily produce the cases that matter most here: a
 * platform with no Screen Orientation API at all, one that rejects the lock,
 * and a touchscreen laptop. Those are the shapes that decide whether a
 * capability gap is handled quietly or surfaces as an error the user cannot
 * act on.
 */

function environment(overrides: Partial<OrientationEnvironment> & { matches?: Record<string, boolean> } = {}) {
  const matches = overrides.matches ?? {};
  return {
    matchMedia: (query: string) => ({ matches: matches[query] ?? false }),
    innerWidth: 390,
    innerHeight: 844,
    ...overrides,
  } as OrientationEnvironment;
}

const PHONE = { "(pointer: coarse)": true };
const INSTALLED_PHONE = { "(pointer: coarse)": true, "(display-mode: standalone)": true };

describe("phone detection", () => {
  it("treats a coarse-pointer, phone-sized viewport as a phone", () => {
    expect(isPhoneContext(environment({ matches: PHONE, innerWidth: 390, innerHeight: 844 }))).toBe(true);
  });

  /** The short side is the stable measure: it does not move when the phone does. */
  it("still recognises the same phone once it is on its side", () => {
    expect(isPhoneContext(environment({ matches: PHONE, innerWidth: 844, innerHeight: 390 }))).toBe(true);
  });

  it("does not treat a narrow desktop window as a phone", () => {
    // Phone-sized, but a mouse. This is a desktop window, or a browser at 200%
    // zoom, and the contract says the guard must never appear on either.
    expect(isPhoneContext(environment({ matches: {}, innerWidth: 380, innerHeight: 700 }))).toBe(false);
  });

  it("does not treat a tablet as a phone even with a touch screen", () => {
    expect(isPhoneContext(environment({ matches: PHONE, innerWidth: 1024, innerHeight: 768 }))).toBe(false);
  });

  it("draws the line between the largest phone and the smallest tablet", () => {
    const shortSide = (value: number) => environment({ matches: PHONE, innerWidth: 900, innerHeight: value });
    expect(isPhoneContext(shortSide(PHONE_MAX_SHORT_SIDE))).toBe(true);
    expect(isPhoneContext(shortSide(PHONE_MAX_SHORT_SIDE + 1))).toBe(false);
  });
});

describe("orientation", () => {
  it("reads a wider-than-tall viewport as landscape", () => {
    expect(isLandscape(environment({ innerWidth: 844, innerHeight: 390 }))).toBe(true);
    expect(isLandscape(environment({ innerWidth: 390, innerHeight: 844 }))).toBe(false);
  });

  it("does not treat an exactly square viewport as landscape", () => {
    expect(isLandscape(environment({ innerWidth: 600, innerHeight: 600 }))).toBe(false);
  });

  it("recognises the installed app", () => {
    expect(isStandalone(environment({ matches: INSTALLED_PHONE }))).toBe(true);
    expect(isStandalone(environment({ matches: PHONE }))).toBe(false);
  });
});

describe("requesting a portrait lock", () => {
  it("locks an installed app on a phone", async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const result = await requestPortraitLock(
      environment({ matches: INSTALLED_PHONE, screen: { orientation: { lock } } }),
    );
    expect(result).toBe("locked");
    expect(lock).toHaveBeenCalledWith("portrait-primary");
  });

  /**
   * A browser tab always refuses. Asking anyway would be a guaranteed rejection
   * on every load, and on some platforms a console error with it.
   */
  it("does not ask at all in a browser tab", async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const result = await requestPortraitLock(environment({ matches: PHONE, screen: { orientation: { lock } } }));
    expect(result).toBe("unavailable");
    expect(lock).not.toHaveBeenCalled();
  });

  it("does not ask on a desktop window", async () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    const result = await requestPortraitLock(
      environment({
        matches: { "(display-mode: standalone)": true },
        innerWidth: 1440,
        innerHeight: 900,
        screen: { orientation: { lock } },
      }),
    );
    expect(result).toBe("unavailable");
    expect(lock).not.toHaveBeenCalled();
  });

  /** iOS Safari: the API is simply not there. Expected, and silent. */
  it("treats a missing Screen Orientation API as a capability gap", async () => {
    await expect(requestPortraitLock(environment({ matches: INSTALLED_PHONE }))).resolves.toBe("unavailable");
    await expect(
      requestPortraitLock(environment({ matches: INSTALLED_PHONE, screen: { orientation: {} } })),
    ).resolves.toBe("unavailable");
  });

  /**
   * The case that must not become an error toast.
   *
   * A platform that exposes the API and then refuses is the normal outcome on
   * several Android configurations. The promise rejects; the product treats it
   * as "this device will not lock" and says nothing, because there is no action
   * the user could take in response.
   */
  it("swallows a refusal instead of surfacing it", async () => {
    const lock = vi.fn().mockRejectedValue(new Error("NotSupportedError"));
    await expect(
      requestPortraitLock(environment({ matches: INSTALLED_PHONE, screen: { orientation: { lock } } })),
    ).resolves.toBe("declined");
  });

  it("never rejects, whatever the platform throws", async () => {
    const lock = vi.fn().mockImplementation(() => {
      throw new Error("synchronous failure");
    });
    await expect(
      requestPortraitLock(environment({ matches: INSTALLED_PHONE, screen: { orientation: { lock } } })),
    ).resolves.toBe("declined");
  });
});
