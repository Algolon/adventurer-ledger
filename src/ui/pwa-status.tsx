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
 * Offline readiness, sized for the space it is actually in.
 *
 * In the app bar of a 360 px phone the full sentence wrapped onto a second
 * line, which pushed the bar past its own height and squeezed the wordmark down
 * to "Runef…". The dot is always shown and always labelled; the sentence is
 * revealed only where there is room for it, so the accessible name is identical
 * at every width and only the visible text changes.
 */
export function PwaIndicator() {
  const { state } = useContext(PwaContext);
  return (
    <span className={`offline ${state}`} role="status">
      <span aria-hidden="true" className="offline-dot">
        ●
      </span>
      <span className="offline-label">{labels[state]}</span>
      <span className="m2-visually-hidden">{labels[state]}</span>
    </span>
  );
}
