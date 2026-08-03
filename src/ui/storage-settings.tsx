"use client";
import { Database, HardDrive, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
interface StorageState {
  usage?: number;
  quota?: number;
  persistent?: boolean;
  supported: boolean;
}
const bytes = (value?: number) =>
  value === undefined
    ? "Unknown"
    : new Intl.NumberFormat("en", {
        maximumFractionDigits: 1,
        style: "unit",
        unit: "megabyte",
      }).format(value / 1024 / 1024);
export function StorageSettings() {
  const [state, setState] = useState<StorageState>({ supported: false }),
    [message, setMessage] = useState("");
  const refresh = useCallback(async () => {
    if (!navigator.storage?.estimate) {
      setState({ supported: false });
      return;
    }
    const estimate = await navigator.storage.estimate(),
      persistent = await navigator.storage.persisted?.();
    setState({
      supported: true,
      usage: estimate.usage,
      quota: estimate.quota,
      persistent,
    });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const percentage =
    state.usage !== undefined && state.quota
      ? (state.usage / state.quota) * 100
      : undefined;
  const requestPersistence = async () => {
    if (!navigator.storage?.persist) {
      setMessage("This browser does not expose persistent-storage requests.");
      return;
    }
    const granted = await navigator.storage.persist();
    setMessage(
      granted
        ? "Persistent storage is enabled."
        : "The browser declined persistent storage. Keep current backups available.",
    );
    await refresh();
  };
  return (
    <section className="page">
      <div className="intro">
        <span>
          <HardDrive />
        </span>
        <div>
          <p className="eyebrow">Device-local storage</p>
          <h2>Settings</h2>
          <p>
            Monitor this browser profile without inspecting or transmitting
            private records.
          </p>
        </div>
      </div>
      <div className="card storage-card">
        <h3>
          <Database />
          Local storage
        </h3>
        {state.supported ? (
          <>
            <dl>
              <div>
                <dt>Estimated usage</dt>
                <dd>{bytes(state.usage)}</dd>
              </div>
              <div>
                <dt>Estimated quota</dt>
                <dd>{bytes(state.quota)}</dd>
              </div>
              <div>
                <dt>Used</dt>
                <dd>
                  {percentage === undefined
                    ? "Unknown"
                    : `${percentage.toFixed(1)}%`}
                </dd>
              </div>
              <div>
                <dt>Persistent storage</dt>
                <dd>{state.persistent ? "Enabled" : "Not enabled"}</dd>
              </div>
            </dl>
            {percentage !== undefined && percentage >= 80 && (
              <p className="storage-warning" role="alert">
                Storage pressure is high. Export a current backup before
                importing more content.
              </p>
            )}
            <button
              className="btn primary"
              disabled={state.persistent}
              onClick={requestPersistence}
            >
              <ShieldCheck />
              Request persistent storage
            </button>
            <p>
              Browsers may decline this request. Persistence reduces eviction
              risk but is not a backup.
            </p>
          </>
        ) : (
          <p>Storage estimates are not supported by this browser.</p>
        )}
        {message && (
          <p role="status" className="formmessage">
            {message}
          </p>
        )}
      </div>
      <div className="boundary">
        <ShieldCheck />
        <p>
          <b>Back up device-local data.</b> Each browser and phone has its own
          IndexedDB. Nothing synchronizes automatically.
        </p>
      </div>
    </section>
  );
}
