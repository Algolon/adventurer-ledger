"use client";
import { RefreshCw } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  APP_ROOT,
  withBasePath,
} from "@/src/config/base-path";

type OfflineState = "preparing" | "ready" | "update" | "unavailable";
interface PwaContextValue {
  state: OfflineState;
  applyUpdate: () => void;
}
const PwaContext = createContext<PwaContextValue>({
  state: "preparing",
  applyUpdate: () => {},
});

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<OfflineState>("preparing"),
    [waiting, setWaiting] = useState<ServiceWorker>();
  const verifyActiveShell = useCallback(async (registration: ServiceWorkerRegistration) => {
    if (!registration.active) return false;
    return new Promise<boolean>((resolve) => {
      const channel = new MessageChannel(),
        timeout = window.setTimeout(() => resolve(false), 2000);
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        window.clearTimeout(timeout);
        resolve(
          typeof event.data === "object" &&
            event.data !== null &&
            "ready" in event.data &&
            event.data.ready === true,
        );
      };
      registration.active?.postMessage(
        { type: "GET_OFFLINE_STATUS" },
        [channel.port2],
      );
    });
  }, []);
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      setState("unavailable");
      return;
    }
    let disposed = false,
      checkForUpdate = () => {};
    const showWaiting = (worker: ServiceWorker) => {
      setWaiting(worker);
      setState("update");
    };
    navigator.serviceWorker
      .register(withBasePath("/sw.js"), {
        scope: APP_ROOT,
        updateViaCache: "none",
      })
      .then(async (registration) => {
        if (disposed) return;
        if (registration.waiting) showWaiting(registration.waiting);
        else {
          await navigator.serviceWorker.ready;
          if (!disposed)
            setState(
              (await verifyActiveShell(registration)) ? "ready" : "unavailable",
            );
        }
        checkForUpdate = () => void registration.update();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              showWaiting(worker);
          });
        });
        window.addEventListener("online", checkForUpdate);
      })
      .catch(() => {
        if (!disposed) setState("unavailable");
      });
    return () => {
      disposed = true;
      window.removeEventListener("online", checkForUpdate);
    };
  }, [verifyActiveShell]);
  /*
   * The same fact as a document attribute, for anything that has to wait for
   * the shell to be cached rather than show it to a person. It used to be read
   * off the app-bar indicator's text, which made a visual element load-bearing
   * for readiness and is why removing that element would otherwise have been a
   * breaking change.
   */
  useEffect(() => {
    document.documentElement.dataset["offlineState"] = state;
  }, [state]);
  const applyUpdate = () => {
    if (!waiting) return;
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => window.location.reload(),
      { once: true },
    );
    waiting.postMessage({ type: "SKIP_WAITING" });
  };
  return (
    <PwaContext.Provider value={{ state, applyUpdate }}>
      {children}
      {state === "update" && (
        <aside className="update-ready" role="status">
          <span>
            <b>Update ready</b>
            <small>
              Your local database will be migrated after a controlled reload.
            </small>
          </span>
          <button className="btn primary" onClick={applyUpdate}>
            <RefreshCw />
            Update now
          </button>
        </aside>
      )}
    </PwaContext.Provider>
  );
}

const labels: Record<OfflineState, string> = {
  preparing: "Preparing offline access…",
  ready: "Offline ready",
  update: "Update ready",
  unavailable: "Offline cache unavailable",
};

/**
 * Offline readiness, stated where it is explained.
 *
 * This used to live in the app bar, and on a phone it was a bare coloured dot:
 * the sentence beside it was hidden below 600 px because it would not fit, so
 * every handset showed a small isolated mark in the top-right with no label,
 * no affordance and nothing it could be read against. Once Settings moved to
 * the bottom navigation and took the gear out of the header, that dot was the
 * only thing left up there beside the wordmark, and the pilot read it as a
 * visual artefact — which, with its own label removed, is what it had become.
 *
 * It is not deleted, because offline readiness is a real fact about a
 * local-first app; it is moved to Settings · Offline, next to the paragraph
 * that says what offline means here. There it has room to be a sentence, so
 * the visible text and the accessible name are the same string at every width.
 *
 * Nothing consumes this as an ambient signal any more. Anything that needs to
 * know the shell is cached — including the tests — reads
 * `document.documentElement.dataset.offlineState`, which `PwaProvider` keeps
 * current and which cannot be confused with a piece of interface.
 */
export function PwaStatus() {
  const { state } = useContext(PwaContext);
  return (
    /*
     * The state travels as a data attribute rather than as a second class
     * name. A class assembled from a variable is invisible to the stylesheet
     * reachability check in `tests/theme.test.ts`, so `.ready` would have read
     * as a dead rule while being very much alive — which is the failure mode
     * that check exists to catch, arriving as a false positive.
     */
    <p className="offline" data-state={state} role="status">
      <span aria-hidden="true" className="offline-dot">
        ●
      </span>
      <span className="offline-label">{labels[state]}</span>
    </p>
  );
}
