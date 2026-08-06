"use client";

/**
 * Shared accessible primitives for the M2.1 character surfaces.
 *
 * Every modal surface traps focus and restores it on close; every derived value
 * renders `—` plus its recovery action when the resolver could not calculate it;
 * every state carries a text or icon indicator so colour is never the only
 * signal. Touch targets are at least 44 CSS px, and play actions are 48.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { TriangleAlert, X } from "lucide-react";
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
  /**
   * `alertdialog` for a surface that interrupts to report a consequence, so a
   * screen reader announces the description rather than only the title.
   * Everything else about the surface — the trap, Escape, restoration — is the
   * same, because those are properties of being modal, not of the role.
   */
  role?: "dialog" | "alertdialog";
  /** Element describing the surface, for the roles that announce one. */
  describedBy?: string;
  /**
   * Where focus should land on open, when the first focusable control is not
   * the right one. A confirmation puts it on the safe action, so the
   * destructive path is never what Enter reaches by habit.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /**
   * `sheet` presents the surface as a bottom drawer on phones, which keeps a
   * details panel thumb-reachable. The modal contract — trap, Escape, focus
   * restoration — is identical; only the geometry changes.
   */
  presentation?: "center" | "sheet";
}

/** Modal surface with a focus trap and focus restoration. */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  errorSummary,
  role = "dialog",
  describedBy,
  initialFocusRef,
  presentation = "center",
}: DialogProps) {
  const container = useRef<HTMLElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const requested = initialFocusRef?.current;
    const first = container.current?.querySelector<HTMLElement>(FOCUSABLE);
    (requested ?? first ?? container.current)?.focus();
    return () => {
      // Focus returns to whatever opened the dialog.
      restoreTo.current?.focus();
    };
    // Intentionally once per mount: the surface owns focus for its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div
      className={presentation === "sheet" ? "m2-backdrop m2-backdrop-sheet" : "m2-backdrop"}
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <section
        className={presentation === "sheet" ? "m2-dialog m2-dialog-sheet" : "m2-dialog"}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
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

/**
 * Human-readable calculation breakdown for a details drawer.
 *
 * It names each input in plain words with its signed amount. Engine vocabulary
 * — contributor kinds, source IDs, target paths, expressions — never renders
 * here; the drawer explains a number the way a person would at the table.
 */
export function Breakdown({ contributors }: { contributors: readonly Contributor[] }) {
  const rows = contributors.filter(contributor => contributor.label);
  if (!rows.length) return <p className="m2-muted">There is nothing to break down for this value.</p>;
  return (
    <ul className="sheet-breakdown">
      {rows.map((contributor, index) => (
        <li key={`${contributor.label}-${index}`}>
          <span>{contributor.label}</span>
          {contributor.amount !== undefined ? <b>{signed(contributor.amount)}</b> : null}
        </li>
      ))}
    </ul>
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
