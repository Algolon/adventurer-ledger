"use client";

/**
 * Shared accessible primitives for the M2.1 character surfaces.
 *
 * Every modal surface traps focus and restores it on close; every derived value
 * renders `—` plus its recovery action when the resolver could not calculate it;
 * every state carries a text or icon indicator so colour is never the only
 * signal. Touch targets are at least 44 CSS px, and play actions are 48.
 */
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
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

/**
 * How much room a floating surface leaves against each edge of the viewport.
 *
 * The bottom allowance clears the fixed navigation rail. A menu that is
 * technically inside the viewport but underneath the bar is not reachable, and
 * "inside the viewport" is not the property that matters — "visible and
 * tappable" is.
 */
const MENU_EDGE_GAP = 8;
const MENU_BOTTOM_RESERVE = 72;

/**
 * A menu anchored to a trigger, kept inside the viewport.
 *
 * The row menu used to be a plain absolutely-positioned list pinned to the
 * trigger's bottom-right corner. That is correct only when the trigger is near
 * the top-left of a roomy screen: on a phone the last row in a library opened a
 * menu that ran under the fixed bottom bar, and a long character name made the
 * items wide enough to reach the edge of the screen.
 *
 * Containment is measured, not assumed. The surface renders in its natural
 * position, is measured once, and is then translated the minimum distance that
 * brings it fully inside — flipping above the trigger when there is not enough
 * room below and more room above. Translation is used rather than a change of
 * layout box so that opening the menu moves nothing else on the page.
 *
 * Dismissal and focus are part of the primitive rather than of each caller,
 * because a menu that closes on Escape in one place and not another is a bug
 * with extra steps.
 */
export function AnchoredMenu({
  label,
  onClose,
  children,
}: {
  /** Names the menu for assistive technology, e.g. "Actions for <name>". */
  label: string;
  onClose(): void;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = surface.current;
    if (!element) return;
    // Measured from a known-neutral state so a re-run never compounds the
    // previous correction. This is what makes the placement idempotent.
    element.style.transform = "";
    element.dataset.placement = "bottom";

    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const rect = element.getBoundingClientRect();

    // Flip above the trigger only when below genuinely does not fit and above
    // is better. Flipping into an equally bad position helps nobody.
    const overflowsBottom = rect.bottom > viewportHeight - MENU_BOTTOM_RESERVE;
    const trigger = element.parentElement?.getBoundingClientRect();
    if (overflowsBottom && trigger && trigger.top > viewportHeight - trigger.bottom) {
      element.dataset.placement = "top";
    }

    const placed = element.getBoundingClientRect();
    let dx = 0;
    if (placed.right > viewportWidth - MENU_EDGE_GAP) dx = viewportWidth - MENU_EDGE_GAP - placed.right;
    // Left wins if both edges overflow: a surface wider than the viewport must
    // start on screen, and its own max-width keeps it from being wider at all.
    if (placed.left + dx < MENU_EDGE_GAP) dx = MENU_EDGE_GAP - placed.left;
    if (dx) element.style.transform = `translateX(${Math.round(dx)}px)`;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // `pointerdown` rather than `click`, so a press that begins outside the
    // menu dismisses it without also activating whatever is underneath.
    const onPointerDown = (event: PointerEvent) => {
      const element = surface.current;
      if (!element) return;
      const target = event.target;
      if (target instanceof Node && (element.contains(target) || element.parentElement?.contains(target))) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  /*
   * Deliberately a labelled group of buttons rather than `role="menu"`.
   *
   * The menu role carries a contract this widget does not honour: arrow-key
   * navigation between items, a roving tabindex, and typeahead. Declaring the
   * role without implementing the behaviour tells a screen-reader user to press
   * a key that does nothing, which is worse than the plain list of buttons that
   * Tab already reaches correctly.
   */
  return (
    <div className="m2-anchored-menu" data-placement="bottom" ref={surface}>
      <ul className="m2-row-menu" aria-label={label}>
        {children}
      </ul>
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
