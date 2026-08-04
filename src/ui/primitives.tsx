"use client";

/**
 * Shared accessible primitives for the M2.1 character surfaces.
 *
 * Every modal surface traps focus and restores it on close; every derived value
 * renders `—` plus its recovery action when the resolver could not calculate it;
 * every state carries a text or icon indicator so colour is never the only
 * signal. Touch targets are at least 44 CSS px, and play actions are 48.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ClipboardCopy, TriangleAlert, X } from "lucide-react";
import type { DerivedValue, Contributor, RecoveryAction } from "@/src/services/derived-resolver";
import { UNKNOWN_DISPLAY } from "@/src/services/derived-resolver";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  /** Announced above the content when a submit produced errors. */
  errorSummary?: readonly { code: string; label: string }[];
  labelledBy?: string;
}

/** Modal surface with a focus trap and focus restoration. */
export function Dialog({ title, onClose, children, footer, errorSummary }: DialogProps) {
  const container = useRef<HTMLElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = container.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container.current)?.focus();
    return () => {
      // Focus returns to whatever opened the dialog.
      restoreTo.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (errorSummary?.length) summaryRef.current?.focus();
  }, [errorSummary]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(container.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
      element => element.offsetParent !== null,
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="m2-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <section
        className="m2-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={container}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="m2-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="m2-icon-button" onClick={onClose} aria-label={`Close ${title}`}>
            <X aria-hidden="true" />
          </button>
        </header>
        {errorSummary?.length ? (
          <div className="m2-error-summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <TriangleAlert aria-hidden="true" />
            <div>
              <strong>{errorSummary.length} issue{errorSummary.length === 1 ? "" : "s"} to resolve</strong>
              <ul>
                {errorSummary.map(issue => (
                  <li key={issue.code}>{issue.label}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
        {/* An intentional inner scroller must be labelled and keyboard reachable. */}
        <div className="m2-dialog-body" tabIndex={0} role="group" aria-label={`${title} details`}>
          {children}
        </div>
        {footer ? <footer className="m2-dialog-foot">{footer}</footer> : null}
      </section>
    </div>
  );
}

/** Renders a modifier with an explicit sign, so `+0` never reads as unknown. */
export const signed = (value: number) => (value >= 0 ? `+${value}` : String(value));

export function formatDerived(value: DerivedValue, style: "plain" | "signed" = "plain"): string {
  if (value.value === null) return UNKNOWN_DISPLAY;
  return style === "signed" ? signed(value.value) : String(value.value);
}

/**
 * Renders a derived value. An unknown value shows `—` with its recovery action
 * rather than a zero or a guess, and an override is always visibly marked.
 */
export function DerivedNumber({
  value,
  label,
  style = "plain",
  onRecover,
}: {
  value: DerivedValue;
  label: string;
  style?: "plain" | "signed";
  onRecover?(recovery: RecoveryAction): void;
}) {
  if (value.value === null) {
    return (
      <span className="m2-unknown">
        <span aria-hidden="true">{UNKNOWN_DISPLAY}</span>
        <span className="m2-visually-hidden">{label} cannot be calculated yet</span>
        {value.recovery ? (
          onRecover ? (
            <button type="button" className="m2-recovery" onClick={() => onRecover(value.recovery!)}>
              {value.recovery.action}
            </button>
          ) : (
            <span className="m2-recovery-note">{value.recovery.action}</span>
          )
        ) : null}
      </span>
    );
  }
  return (
    <span className="m2-value">
      {style === "signed" ? signed(value.value) : value.value}
      {value.override ? (
        <span className="m2-badge m2-badge-override" title="Manual override">
          {value.override.stale ? "Override · review" : "Override"}
        </span>
      ) : null}
    </span>
  );
}

/** Explanation trace: base inputs, applied contributors, and source provenance. */
export function ContributorList({ contributors }: { contributors: readonly Contributor[] }) {
  if (!contributors.length) return <p className="m2-muted">No contributors are available for this value.</p>;
  return (
    <ul className="m2-contributors">
      {contributors.map((contributor, index) => (
        <li key={`${contributor.label}-${index}`}>
          <span className="m2-contributor-kind">{contributor.kind}</span>
          <span>{contributor.label}</span>
          {contributor.amount !== undefined ? <b>{signed(contributor.amount)}</b> : null}
          {contributor.sourceId ? <small className="m2-muted">{contributor.sourceId}</small> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Copy expression. M2.1 has no Roll control, no random result and no roll
 * history: the expression itself is the actionable output (D-08).
 */
export function CopyExpression({ expression, label }: { expression: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(expression);
      setCopied(true);
    } catch {
      // Clipboard permission may be refused; the expression stays selectable.
      setCopied(false);
    }
  };

  return (
    <span className="m2-expression">
      <code>{expression}</code>
      <button type="button" className="m2-play-action" onClick={copy} aria-label={`Copy ${label} expression ${expression}`}>
        {copied ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
        <span>{copied ? "Copied" : "Copy expression"}</span>
      </button>
    </span>
  );
}

/** State chip that always pairs colour with a word. */
export function StateBadge({ state }: { state: "automatic" | "manual" | "incomplete" | "missing-source" }) {
  const label = {
    automatic: "Automatic",
    manual: "Manual",
    incomplete: "Incomplete",
    "missing-source": "Missing source",
  }[state];
  return <span className={`m2-badge m2-badge-${state}`}>{label}</span>;
}
