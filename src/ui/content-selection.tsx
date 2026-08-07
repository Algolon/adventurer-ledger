"use client";
/**
 * The shared content-selection pattern for Class, Species and Background.
 *
 * All three steps ask the same question — choose one of these, then answer what
 * it turns out to require — so all three use this one component. The flow it
 * implements is scan, select, understand, decide, continue.
 *
 * Before selection every option is a compact row: its name, its own one-line
 * summary, and a few at-a-glance facts. The full rules payload of an option
 * nobody has chosen is not on screen, because a list where every entry is fully
 * expanded is a list nobody can scan.
 *
 * On selection that option expands in place, directly under the control that
 * selected it, and answers in order: what you get, what you still have to
 * decide, what your starting level actually reaches, and — behind a disclosure —
 * anything useful that is not needed to make this decision. The nested choices
 * live here, inside the thing that caused them, rather than on a later generic
 * screen where nothing explains where they came from.
 *
 * Exactly one option is expanded, because exactly one can be selected. There is
 * no separate expansion state to fall out of step with the selection.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, CircleHelp, TriangleAlert } from "lucide-react";
import type { SelectionGrant, SelectionOptionView } from "@/src/services/selection-presenter";
import type { Recommendation } from "@/src/services/build-planner";

/** What a disposition means to a player, in a player's vocabulary. */
const DISPOSITION_LABELS: Record<string, string> = {
  automatic: "Applied for you",
  "choice-driven": "You choose",
  "manual-adjudication": "Track at the table",
};

const DISPOSITION_CLASS: Record<string, string> = {
  automatic: "m2-badge m2-badge-automatic",
  "choice-driven": "m2-badge m2-badge-recommended",
  "manual-adjudication": "m2-badge m2-badge-manual",
};

function GrantList({ grants, showLevel }: { grants: readonly SelectionGrant[]; showLevel?: boolean }) {
  return (
    <ul className="m2-grant-list">
      {grants.map(grant => (
        <li key={grant.id} className="m2-grant">
          <span className="m2-grant-head">
            <b>{grant.label}</b>
            {showLevel && grant.level !== undefined ? (
              <span className="m2-grant-level">Level {grant.level}</span>
            ) : null}
            {/*
             * Automatic and manual benefits are told apart here, from the
             * entry's own typed effects. A trait the app cannot apply is the one
             * thing a player must not discover at the table.
             */}
            {grant.disposition ? (
              <span className={DISPOSITION_CLASS[grant.disposition]}>{DISPOSITION_LABELS[grant.disposition]}</span>
            ) : null}
          </span>
          {grant.detail ? <small>{grant.detail}</small> : null}
        </li>
      ))}
    </ul>
  );
}

export interface ContentSelectionProps {
  legend: string;
  /** One sentence naming the single question this step answers. */
  intro?: string;
  options: readonly SelectionOptionView[];
  selectedId?: string;
  recommendations: readonly Recommendation[];
  /**
   * The nested decisions the selected option owns, already filtered to this
   * step by the planner's typed activation routing.
   */
  choices?: React.ReactNode;
  /** Extra content for the expanded panel, above the standard sections. */
  extra?: React.ReactNode;
  emptyMessage: string;
  onSelect(id: string): void;
}

export function ContentSelection({
  legend,
  intro,
  options,
  selectedId,
  recommendations,
  choices,
  extra,
  emptyMessage,
  onSelect,
}: ContentSelectionProps) {
  /*
   * Selecting an option changes the height of the list above the row that was
   * clicked, because the previously expanded option collapses. Left alone the
   * page slides under the user's finger and the card they just chose is
   * somewhere else. The row's viewport position is recorded at the moment of the
   * click and restored after layout, so the thing that was touched stays exactly
   * where it was touched.
   */
  /** Which option's "Why this?" copy is open. Never affects the selection. */
  const [explaining, setExplaining] = useState<string | null>(null);
  /** Unique per instance, so two lists on one screen cannot collide. */
  const panelId = useId();
  const anchor = useRef<{ id: string; top: number; until: number } | null>(null);
  /** Set around our own scrolling, so it is not mistaken for the user's. */
  const selfScrolling = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);

  /** Puts the anchored row back where it was, if it has moved. */
  const restore = useCallback(() => {
    const pending = anchor.current;
    if (!pending || !listRef.current) return;
    /*
     * The anchor is a short-lived correction, not a scroll lock. It covers the
     * selection and the panel growth that follows it — the plan supplies the
     * nested decisions a moment later, so the surface grows twice — and then it
     * expires. An anchor that outlived that window would pull the page back the
     * next time anything re-rendered, long after the user had scrolled
     * somewhere else deliberately.
     */
    if (performance.now() > pending.until) {
      anchor.current = null;
      return;
    }
    const row = listRef.current.querySelector<HTMLElement>(`[data-option-id="${CSS.escape(pending.id)}"]`);
    if (!row) return;
    const delta = row.getBoundingClientRect().top - pending.top;
    if (Math.abs(delta) < 1) return;
    selfScrolling.current = true;
    window.scrollBy(0, delta);
    // Cleared on a task, after the scroll event this just produced has fired.
    setTimeout(() => {
      selfScrolling.current = false;
    }, 0);
  }, []);

  // Runs after every commit while an anchor is held, not only on the render
  // that changed the selection.
  useLayoutEffect(restore);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => restore());
    observer.observe(list);
    return () => observer.disconnect();
  }, [restore]);

  /* Any scroll this component did not cause is the user taking over. */
  useEffect(() => {
    const release = () => {
      if (!selfScrolling.current) anchor.current = null;
    };
    window.addEventListener("scroll", release, { passive: true });
    return () => window.removeEventListener("scroll", release);
  }, []);

  const select = (id: string, element: HTMLElement) => {
    anchor.current = { id, top: element.getBoundingClientRect().top, until: performance.now() + 1500 };
    onSelect(id);
  };

  if (!options.length)
    return (
      <fieldset className="m2-fieldset">
        <legend>{legend}</legend>
        <p className="m2-muted">{emptyMessage}</p>
      </fieldset>
    );

  return (
    <fieldset className="m2-fieldset">
      <legend>{legend}</legend>
      {intro ? <p className="m2-muted">{intro}</p> : null}
      <ul className="m2-options" ref={listRef}>
        {options.map(option => {
          const isSelected = option.id === selectedId;
          const recommendation = recommendations.find(item => item.optionId === option.id);
          return (
            <li key={option.id} className={isSelected ? "m2-select-card m2-select-card-open" : "m2-select-card"}>
              {/*
               * Both states, because the control genuinely has both: it selects
               * the option, and selecting it is what reveals the panel. They are
               * not independent — there is no way to expand without selecting —
               * so `aria-expanded` describes the consequence rather than
               * offering a second control that does not exist.
               */}
              <button
                type="button"
                data-option-id={option.id}
                className={isSelected ? "m2-option m2-option-selected" : "m2-option"}
                aria-pressed={isSelected}
                aria-expanded={isSelected}
                aria-controls={`${panelId}-${option.id}`}
                onClick={event => select(option.id, event.currentTarget)}
              >
                <span className="m2-option-mark" aria-hidden="true">
                  {isSelected ? <Check /> : "○"}
                </span>
                <span>
                  <b>{option.label}</b>
                  {option.tagline ? <small>{option.tagline}</small> : null}
                  {/*
                   * The at-a-glance facts. Few enough to read without deciding
                   * anything, and each one is read from typed content — a fact
                   * the content does not state simply is not here.
                   */}
                  {option.facts.length ? (
                    <span className="m2-facts">
                      {option.facts.map(fact => (
                        <span className="m2-fact" key={fact.label}>
                          <span className="m2-fact-label">{fact.label}</span>
                          <span className="m2-fact-value">{fact.value}</span>
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
                {recommendation ? <span className="m2-badge m2-badge-recommended">Recommended</span> : null}
              </button>

              {isSelected ? (
                <div
                  className="m2-select-panel"
                  id={`${panelId}-${option.id}`}
                  role="group"
                  aria-label={`${option.label} — what this gives you`}
                >
                  {extra}
                  {option.grants.length ? (
                    <section className="m2-select-section">
                      <h4>What you get</h4>
                      <GrantList grants={option.grants} />
                    </section>
                  ) : null}

                  {/*
                   * Rendered only when there is genuinely something to decide.
                   * A simple option with no nested choice shows no empty
                   * "Choices" heading, because an empty required-decisions
                   * section reads as a decision the user has failed to find.
                   */}
                  {choices ? (
                    <section className="m2-select-section">
                      <h4>Choices to make</h4>
                      {choices}
                    </section>
                  ) : null}

                  {option.atLevel.length ? (
                    <section className="m2-select-section">
                      <h4>At your starting level</h4>
                      <GrantList grants={option.atLevel} showLevel />
                    </section>
                  ) : null}

                  {option.details.length ? (
                    <details className="m2-select-more">
                      <summary>More details</summary>
                      <dl className="m2-detail-list">
                        {option.details.map(detail => (
                          <div key={detail.label}>
                            <dt>{detail.label}</dt>
                            <dd>{detail.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  ) : null}
                </div>
              ) : null}

              {/*
               * "Why this?" is its own control, and reading it selects
               * nothing. A recommendation is guidance the user may inspect and
               * still decline, so the explanation has to be reachable without
               * committing to the option — which is exactly what an inline
               * paragraph beside a selectable row cannot promise.
               */}
              {recommendation ? (
                <>
                  <button
                    type="button"
                    className="m2-why"
                    aria-expanded={explaining === option.id}
                    onClick={() => setExplaining(explaining === option.id ? null : option.id)}
                  >
                    <CircleHelp aria-hidden="true" />
                    Why this?
                    <span className="m2-visually-hidden"> {option.label}</span>
                  </button>
                  {explaining === option.id ? <p className="m2-why-copy">{recommendation.why}</p> : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** The count of still-unanswered decisions a selected option owns. */
export function PendingDecisions({ outstanding, total }: { outstanding: number; total: number }) {
  if (!total) return null;
  return outstanding ? (
    <p className="m2-inline-issue" role="status">
      <TriangleAlert aria-hidden="true" /> {outstanding} of {total} {total === 1 ? "decision" : "decisions"} still to
      make
    </p>
  ) : (
    <p className="m2-select-done" role="status">
      <Check aria-hidden="true" /> All {total === 1 ? "its decision is" : "its decisions are"} made
    </p>
  );
}
