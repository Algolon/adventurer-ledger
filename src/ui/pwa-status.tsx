"use client";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

export function PwaStatus() {
  const [waiting, setWaiting] = useState<ServiceWorker>();
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    let disposed = false,
      checkForUpdate = () => {};
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (disposed) return;
        if (registration.waiting) setWaiting(registration.waiting);
        checkForUpdate = () => {
          void registration.update();
        };
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              setWaiting(worker);
          });
        });
        window.addEventListener("online", checkForUpdate);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      window.removeEventListener("online", checkForUpdate);
    };
  }, []);
  if (!waiting) return null;
  return (
    <aside className="update-ready" role="status">
      <span>
        <b>App update ready</b>
        <small>
          Your local database will be migrated after a controlled reload.
        </small>
      </span>
      <button
        className="btn primary"
        onClick={() => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            () => window.location.reload(),
            { once: true },
          );
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        <RefreshCw />
        Update now
      </button>
    </aside>
  );
}
