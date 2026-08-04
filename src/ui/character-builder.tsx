"use client";

/**
 * The character builder.
 *
 * One persisted draft backs both presentation modes: switching between guided
 * and flexible changes guidance only and never clears a selection. Every
 * accepted choice autosaves through CharacterDraftService with the expected
 * revision, so a reload, a closed tab or an offline session resumes at the last
 * committed step. Guided recommendations are ranked and explained but never
 * applied automatically.
 *
 * The first step is identity and intent: the name, the ruleset the build is
 * scoped to, and the level the character is being created at. Creating directly
 * at a higher level is a real target, not a level 1 character that is advanced
 * afterwards — the planner accumulates every level's progression into one build
 * and the commit writes that level directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, ListChecks, TriangleAlert } from "lucide-react";
import {
  BUILDER_STEPS,
  recommendationsFor,
  remainingArraySlots,
  type BuilderStepId,
  type PlannedStep,
  type RequiredChoice,
} from "@/src/services/build-planner";
import { ABILITIES, type CharacterDraftBuild } from "@/src/domain/character-record";
import type { Ability, ContentEntry } from "@/src/domain/model";
import { RULESET_PRIVACY_LABELS, selectedEquipmentFor, standardArrayFor } from "@/src/services/content-scope";
import { abilityModifier } from "@/src/rules/engine";
import { signed } from "@/src/ui/primitives";
import { useAsync, useServices } from "@/src/ui/services-context";
import type { DraftSnapshot } from "@/src/services/character-services";
import type { RulesetChangePreview } from "@/src/services/ruleset-change";
import type { InstalledRulesetView } from "@/src/services/content-install-service";

/** Origin categories the builder offers. `race` is the older spelling. */
const ORIGIN_CATEGORIES = new Set<ContentEntry["category"]>(["species", "race"]);

const ISSUE_LABELS: Record<string, string> = {
  CLASS_NOT_CHOSEN: "Choose a class",
  CLASS_SOURCE_MISSING: "The chosen class is no longer available",
  SPECIES_NOT_CHOSEN: "Choose an origin species",
  SPECIES_SOURCE_MISSING: "The chosen species is no longer available",
  BACKGROUND_NOT_CHOSEN: "Choose a background",
  BACKGROUND_SOURCE_MISSING: "The chosen background is no longer available",
  ABILITY_SCORE_MISSING: "Set every ability score",
  STANDARD_ARRAY_MISMATCH: "These scores do not match the standard array plus the origin increases",
  CHOICE_UNRESOLVED: "Resolve the outstanding choice",
  CHOICE_OPTION_INCOMPATIBLE: "A selected option does not meet its requirement",
  EQUIPMENT_CHOICE_REQUIRED: "Choose your starting equipment",
  NAME_NOT_SET: "Name the character (optional)",
  MANUAL_MINIMUM_NOT_MET: "A manual sheet needs abilities, hit points, armour class, initiative and one action",
  MANUAL_VALUE_MISSING: "Enter every required manual value",
  MANUAL_ACTION_MISSING: "Add at least one action",
  SUBCLASS_NOT_CHOSEN: "Choose a subclass",
  SUBCLASS_INVALID: "The stored subclass does not belong to this class",
  LEVEL_NOT_COVERED_BY_CLASS: "This class's content does not reach the chosen level. Lower the level or choose another class.",
  PROGRESSION_CHOICE_MISSING: "The class progression names a choice this content does not define",
  PROGRESSION_FEATURE_MISSING: "The class progression names a feature this content does not define",
  PROFICIENCY_DUPLICATE_SELECTION: "A selected option grants a proficiency you already have",
  ORIGIN_INCREASE_NOT_AVAILABLE:
    "An ability increase is not offered by your current origin. Place it again on the Abilities step.",
};

const labelFor = (code: string) => ISSUE_LABELS[code] ?? code;

const titleCase = (value: string) => value[0].toUpperCase() + value.slice(1);

/**
 * Where reopening a draft should land.
 *
 * A draft that has never been edited opens at the beginning. Otherwise it
 * resumes at whichever is further along: the step the user was last on, or the
 * next unresolved step the library card advertises. Taking the further of the
 * two keeps the resume point stable even if the final navigation autosave had
 * not flushed when the tab closed.
 */
export function resumeStepFor(snapshot: DraftSnapshot): BuilderStepId {
  const stored = snapshot.draft.lastStepId as BuilderStepId;
  if (snapshot.draft.revision <= 1) return stored;
  const position = (id: BuilderStepId) => BUILDER_STEPS.findIndex(step => step.id === id);
  const unresolved = snapshot.plan.nextUnresolvedStepId;
  return position(unresolved) > position(stored) ? unresolved : stored;
}

/**
 * A draft patch, or a function producing one from the freshest persisted build.
 * Anything derived from existing state must use the function form.
 */
export type DraftPatch =
  | Partial<CharacterDraftBuild>
  | ((current: CharacterDraftBuild) => Partial<CharacterDraftBuild>);

export function CharacterBuilder({
  draftId,
  onFinished,
  onClose,
}: {
  draftId: string;
  onFinished(characterId: string): void;
  onClose(): void;
}) {
  const { drafts, commit, query, install, refresh } = useServices();
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [stepId, setStepId] = useState<BuilderStepId>("start");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [commitErrors, setCommitErrors] = useState<{ code: string; label: string }[]>([]);
  const [showSteps, setShowSteps] = useState(false);
  /** A ruleset change that has been previewed and not yet answered. */
  const [rulesetChange, setRulesetChange] = useState<RulesetChangePreview | null>(null);
  const revisionRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  /** Freshest snapshot, readable after awaiting the save queue. */
  const snapshotRef = useRef<DraftSnapshot | null>(null);
  /** Focus moves here when a submit produces issues, so it is announced. */
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  /** Debounced free-text edits that have not reached the draft service yet. */
  const pendingRef = useRef<Partial<CharacterDraftBuild>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rulesetId = snapshot?.draft.rulesetProfileId;
  const entriesState = useAsync(
    () => (rulesetId ? query.contentForRuleset(rulesetId) : Promise.resolve([])),
    [rulesetId],
  );
  const entries = useMemo<ContentEntry[]>(() => (entriesState.status === "ready" ? entriesState.value : []), [entriesState]);
  const rulesetsState = useAsync(() => install.installedRulesets(), []);
  const rulesets = useMemo<InstalledRulesetView[]>(
    () => (rulesetsState.status === "ready" ? rulesetsState.value : []),
    [rulesetsState],
  );

  useEffect(() => {
    let cancelled = false;
    drafts.get(draftId).then(loaded => {
      if (cancelled || !loaded) return;
      revisionRef.current = loaded.revision;
      snapshotRef.current = loaded;
      setSnapshot(loaded);
      setStepId(resumeStepFor(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [draftId, drafts]);

  useEffect(() => {
    if (commitErrors.length) errorSummaryRef.current?.focus();
  }, [commitErrors]);

  /**
   * Autosaves are serialised through one queue and read the revision from a ref
   * rather than from rendered state. Two changes in quick succession — typing a
   * name and then pressing Continue — would otherwise both send the revision
   * that was current at the last render, and the second would be rejected as
   * stale even though nothing else touched the draft.
   */
  const save = useCallback(
    (patch: DraftPatch, nextStep?: BuilderStepId) => {
      const run = async () => {
        const latest = snapshotRef.current;
        if (revisionRef.current === null || !latest) return;
        // Resolved here, not at enqueue time: a patch derived from the build must
        // read the freshest build or it silently overwrites an earlier change.
        const resolved = typeof patch === "function" ? patch(latest.draft.build) : patch;
        const outcome = await drafts.update({
          draftId,
          expectedRevision: revisionRef.current,
          patch: resolved,
          ...(nextStep ? { lastStepId: nextStep } : {}),
        });
        if (outcome.status === "ok") {
          revisionRef.current = outcome.result.revision;
          snapshotRef.current = outcome.result;
          setSnapshot(outcome.result);
          setSaveError(null);
          return;
        }
        // The edit stays on screen and prior persisted state is intact.
        setSaveError(
          outcome.status === "stale"
            ? "This build changed in another tab. Reopen it to continue from the saved version."
            : "The last change could not be saved on this device.",
        );
      };
      queueRef.current = queueRef.current.then(run, run);
      return queueRef.current;
    },
    [draftId, drafts],
  );

  /**
   * Sends any debounced edit now.
   *
   * Every navigation, mode switch and commit goes through this first, so a name
   * typed a moment before pressing Continue is persisted rather than lost with
   * the unmounting step.
   */
  const flushPending = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(pending).length) return save(pending);
    return queueRef.current;
  }, [save]);

  /** Buffers a free-text edit and writes it shortly after typing stops. */
  const scheduleSave = useCallback(
    (patch: Partial<CharacterDraftBuild>) => {
      pendingRef.current = { ...pendingRef.current, ...patch };
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void flushPending(), 400);
    },
    [flushPending],
  );

  // A pending edit must not die with the component; the unmount flush is what
  // makes "type a name, close the tab" survive.
  useEffect(() => () => void flushPending(), [flushPending]);

  if (!snapshot)
    return (
      <div className="m2-builder" aria-busy="true">
        <p role="status">Opening the build…</p>
      </div>
    );

  const { draft, plan } = snapshot;
  const build = draft.build;
  const steps = plan.steps;
  const index = steps.findIndex(step => step.id === stepId);
  const current = steps[index] ?? steps[0];

  const goTo = (id: BuilderStepId) => {
    void flushPending();
    setStepId(id);
    setShowSteps(false);
    // The error summary describes one submission. Carrying it to another step
    // leaves it asserting a problem the user may have just repaired, which is
    // worse than showing nothing: the live per-step issues are still on screen.
    setCommitErrors([]);
    void save({}, id);
  };

  /**
   * Continue waits for queued autosaves and then judges the step against the
   * freshest plan. Reading the rendered plan instead would block the user on a
   * choice they had just made but whose save had not yet landed.
   */
  const advance = async () => {
    await flushPending();
    await queueRef.current;
    const latest = snapshotRef.current ?? snapshot;
    const latestSteps = latest.plan.steps;
    const position = latestSteps.findIndex(step => step.id === stepId);
    const step = latestSteps[position] ?? latestSteps[0];
    if (step.id === "review") return;
    if (latest.draft.presentation === "guided" && step.status === "incomplete") {
      // Guided mode keeps the user at the unresolved dependency.
      setCommitErrors(step.issues.filter(issue => issue.severity === "error").map(issue => ({ code: issue.code, label: labelFor(issue.code) })));
      return;
    }
    setCommitErrors([]);
    const next = latestSteps[position + 1];
    if (next) goTo(next.id);
  };

  const finish = async () => {
    // Let any in-flight autosave land so the commit sends the current revision.
    await flushPending();
    await queueRef.current;
    const fingerprint = await query.contentFingerprint(draft.rulesetProfileId);
    const characterId = draft.editingCharacterId ?? `character:${draftId.replace(/^draft:/, "")}`;
    const existing = draft.editingCharacterId ? await query.sheet(draft.editingCharacterId) : undefined;
    const outcome = await commit.commit({
      operationId: `commit:${draftId}:${revisionRef.current ?? snapshot.revision}`,
      draftId,
      expectedDraftRevision: revisionRef.current ?? snapshot.revision,
      characterId,
      ...(existing ? { expectedCharacterRevision: existing.characterRevision } : {}),
      intent: draft.editingCharacterId ? "edit" : build.manualSheet ? "manual-sheet" : "create",
      acknowledgedIssueCodes: [...build.acknowledgedIssueCodes],
      expectedContentFingerprint: fingerprint,
    });

    if (outcome.status === "ok") {
      setCommitErrors([]);
      refresh();
      onFinished(outcome.result.characterId);
      return;
    }
    if (outcome.status === "invalid")
      setCommitErrors(outcome.issues.map(issue => ({ code: issue.code, label: labelFor(issue.code) })));
    else if (outcome.status === "stale" || outcome.status === "conflict")
      setCommitErrors([{ code: "STALE_PREVIEW", label: "Your content changed since Review. Reopen Review to see the current values." }]);
  };

  const togglePresentation = async () => {
    await flushPending();
    await queueRef.current;
    const outcome = await drafts.changePresentation(
      draftId,
      revisionRef.current ?? snapshot.revision,
      draft.presentation === "guided" ? "flexible" : "guided",
    );
    if (outcome.status === "ok") {
      revisionRef.current = outcome.result.revision;
      snapshotRef.current = outcome.result;
      setSnapshot(outcome.result);
    }
  };

  /**
   * Asks what moving to another ruleset would cost, and writes nothing.
   *
   * Every queued autosave is flushed first, so the revision the preview reports
   * is the revision a confirmation can actually use, and the preview describes
   * the draft as it really is rather than as it was one keystroke ago.
   */
  const requestRulesetChange = async (nextRulesetId: string) => {
    await flushPending();
    await queueRef.current;
    const outcome = await drafts.previewRulesetChange(draftId, nextRulesetId);
    if (outcome.status !== "ok") {
      setSaveError("That ruleset could not be read on this device.");
      return;
    }
    if (outcome.result.noop) return;
    setRulesetChange(outcome.result);
  };

  /**
   * Applies exactly the previewed change.
   *
   * The preview's revision is sent rather than the current one. If anything
   * touched the draft between the preview and this confirmation, the write is
   * refused as stale and the user is re-shown a fresh preview — which is what
   * stops a late autosave reinstating a value the confirmed change had cleared.
   */
  const confirmRulesetChange = async (preview: RulesetChangePreview) => {
    await flushPending();
    await queueRef.current;
    const outcome = await drafts.changeRuleset(draftId, preview.expectedRevision, preview.proposedRulesetId);
    if (outcome.status === "stale") {
      setRulesetChange(null);
      setSaveError("This build changed while the ruleset switch was open. Choose the ruleset again to see the current effect.");
      return;
    }
    if (outcome.status !== "ok") {
      setRulesetChange(null);
      setSaveError("That ruleset could not be selected on this device.");
      return;
    }
    revisionRef.current = outcome.result.revision;
    snapshotRef.current = outcome.result;
    setSnapshot(outcome.result);
    setRulesetChange(null);
    setSaveError(null);
    // Deliberately no `install.activate` here. Which ruleset *this* build is in
    // is a property of this build; the device-wide default decides what future
    // characters start in. Repointing that from inside one builder made an
    // unrelated, unasked-for and unannounced change on every later New character,
    // so the default is now only changed from Settings, where it is the subject
    // of the action rather than a side effect of it.
    refresh();
  };

  return (
    <div className="m2-builder">
      <header className="m2-builder-head">
        <div>
          <p className="m2-eyebrow">
            Step {index + 1} of {steps.length}
          </p>
          <h2>{current.label}</h2>
        </div>
        <button
          type="button"
          className="m2-mode-toggle"
          onClick={togglePresentation}
          aria-pressed={draft.presentation === "flexible"}
        >
          {draft.presentation === "guided" ? "Guided mode" : "Flexible mode"}
        </button>
      </header>

      {/*
       * Progress lives with the content, not in the action row. Back and
       * Continue are the only two things in the footer, so neither competes
       * with a third control for the same visual weight.
       */}
      <div className="m2-builder-progress">
        <div
          className="m2-progress-track"
          role="progressbar"
          aria-label="Creation progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${steps.length}: ${current.label}`}
        >
          <span className="m2-progress-fill" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <div className="m2-progress-meta">
          <button
            type="button"
            className="m2-progress-steps"
            onClick={() => setShowSteps(value => !value)}
            aria-expanded={showSteps}
          >
            <ListChecks aria-hidden="true" />
            All steps
          </button>
          <span className="m2-issue-count" aria-live="polite">
            {plan.issueCount} issue{plan.issueCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {saveError ? (
        <div className="m2-banner m2-banner-error" role="alert">
          <strong>Save failed</strong>
          <p>{saveError}</p>
          <button type="button" className="m2-button" onClick={() => void save({})}>
            Retry save
          </button>
        </div>
      ) : null}

      {commitErrors.length ? (
        <div className="m2-error-summary" role="alert" tabIndex={-1} ref={errorSummaryRef}>
          <TriangleAlert aria-hidden="true" />
          <div>
            <strong>
              {commitErrors.length} issue{commitErrors.length === 1 ? "" : "s"} to resolve
            </strong>
            <ul>
              {commitErrors.map(issue => (
                <li key={issue.code}>{issue.label}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {showSteps ? (
        <nav className="m2-step-list" aria-label="Build steps">
          <ol>
            {steps.map((step, position) => (
              <li key={step.id}>
                <button type="button" onClick={() => goTo(step.id)} aria-current={step.id === stepId ? "step" : undefined}>
                  <span className="m2-step-number" aria-hidden="true">
                    {step.status === "complete" ? <Check /> : position + 1}
                  </span>
                  <span>
                    {step.label}
                    <small>{step.status === "complete" ? "Complete" : "Incomplete"}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="m2-builder-body">
        <StepContent
          step={current}
          build={build}
          entries={entries}
          rulesets={rulesets}
          activeRulesetId={draft.rulesetProfileId}
          presentation={draft.presentation}
          plan={snapshot.plan}
          onChange={save}
          onType={scheduleSave}
          onSelectRuleset={id => void requestRulesetChange(id)}
        />
      </div>

      {rulesetChange ? (
        <RulesetChangeConfirmation
          preview={rulesetChange}
          onCancel={() => setRulesetChange(null)}
          onConfirm={() => void confirmRulesetChange(rulesetChange)}
        />
      ) : null}

      {/* Exactly two actions, one row, equal height: Back secondary, Continue primary. */}
      <footer className="m2-task-footer">
        <button
          type="button"
          className="m2-button m2-button-secondary"
          onClick={() => {
            void flushPending();
            if (index > 0) goTo(steps[index - 1].id);
            else onClose();
          }}
        >
          <ArrowLeft aria-hidden="true" />
          Back
        </button>
        {current.id === "review" ? (
          <button type="button" className="m2-button m2-button-primary" onClick={() => void finish()}>
            Finish and open sheet
            <ArrowRight aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="m2-button m2-button-primary" onClick={() => void advance()}>
            Continue
            <ArrowRight aria-hidden="true" />
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * The ruleset-change confirmation.
 *
 * It states the whole effect before anything is written: what goes, what stays,
 * and what is recalculated. Cancel is the default action — it is focused on
 * open and bound to Escape — because the destructive path should never be the
 * one a user reaches by pressing Enter out of habit.
 *
 * `alertdialog` rather than `dialog`: this interrupts to report a consequence,
 * and the role is what makes a screen reader announce the description rather
 * than only the title.
 */
function RulesetChangeConfirmation({
  preview,
  onCancel,
  onConfirm,
}: {
  preview: RulesetChangePreview;
  onCancel(): void;
  onConfirm(): void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div
      className="m2-confirm-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ruleset-change-title"
      aria-describedby="ruleset-change-body"
      onKeyDown={event => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="m2-confirm-panel">
        <h3 id="ruleset-change-title">Switch to {preview.proposedRulesetName}?</h3>
        <div id="ruleset-change-body">
          <p className="m2-muted">
            This build is currently in {preview.currentRulesetName}. Nothing has been changed yet.
          </p>

          {preview.cleared.length ? (
            <>
              <h4>This will be cleared</h4>
              <ul className="m2-plain-list m2-issue-errors">
                {preview.cleared.map(field => (
                  <li key={field.fieldPath}>{field.label}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="m2-muted">Nothing in this build belongs to the current ruleset yet, so nothing is cleared.</p>
          )}

          {preview.recomputed.length ? (
            <>
              <h4>This will be recalculated</h4>
              <ul className="m2-plain-list">
                {preview.recomputed.map(field => (
                  <li key={field.fieldPath}>{field.label}</li>
                ))}
              </ul>
            </>
          ) : null}

          {preview.conflicts.length ? (
            <>
              <h4>This will need repairing</h4>
              <ul className="m2-plain-list m2-issue-errors">
                {preview.conflicts.map(field => (
                  <li key={field.fieldPath}>{field.label}</li>
                ))}
              </ul>
            </>
          ) : null}

          {preview.retained.length ? (
            <>
              <h4>This is kept</h4>
              <ul className="m2-plain-list">
                {preview.retained.map(field => (
                  <li key={field.fieldPath}>{field.label}</li>
                ))}
              </ul>
            </>
          ) : null}

          <p className="m2-muted">Your device&rsquo;s default ruleset for new characters is not changed.</p>
        </div>

        <div className="m2-confirm-actions">
          <button type="button" className="m2-button m2-button-secondary" ref={cancelRef} onClick={onCancel}>
            Keep current ruleset
          </button>
          <button type="button" className="m2-button m2-button-primary" onClick={onConfirm}>
            Switch ruleset
          </button>
        </div>
      </div>
    </div>
  );
}

interface StepProps {
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  plan: DraftSnapshot["plan"];
  onChange(patch: DraftPatch): void;
}

function StepContent({
  step,
  build,
  entries,
  rulesets,
  activeRulesetId,
  presentation,
  plan,
  onChange,
  onType,
  onSelectRuleset,
}: StepProps & {
  step: PlannedStep;
  rulesets: readonly InstalledRulesetView[];
  activeRulesetId: string;
  presentation: "guided" | "flexible";
  onType(patch: Partial<CharacterDraftBuild>): void;
  onSelectRuleset(id: string): void;
}) {
  // The plan is passed through, so guided recommendations describe the pass that
  // has already run rather than starting a second traversal on every render.
  const recommendations = presentation === "guided" ? recommendationsFor(step.id, build, entries, plan) : [];

  switch (step.id) {
    case "start":
      return (
        <StartStep
          build={build}
          plan={plan}
          rulesets={rulesets}
          activeRulesetId={activeRulesetId}
          onChange={onChange}
          onType={onType}
          onSelectRuleset={onSelectRuleset}
        />
      );

    case "class":
      return (
        <div className="m2-step">
          <OptionStep
            legend="Class"
            options={entries.filter(entry => entry.category === "class").map(entry => ({ id: entry.id, label: entry.name, summary: entry.summary }))}
            selected={build.manualSheet ? [] : build.classId ? [build.classId] : []}
            recommendations={recommendations}
            // A different class has a different subclass list, so the stored
            // subclass identity is dropped rather than left pointing elsewhere.
            onSelect={id => onChange({ classId: id, subclassId: undefined, manualSheet: false })}
          />
          <fieldset className="m2-fieldset">
            <legend>Or build a manual sheet</legend>
            <ul className="m2-options">
              <li>
                <button
                  type="button"
                  className={build.manualSheet ? "m2-option m2-option-selected" : "m2-option"}
                  aria-pressed={build.manualSheet === true}
                  onClick={() => onChange({ manualSheet: !build.manualSheet, classId: undefined, subclassId: undefined })}
                >
                  <span className="m2-option-mark" aria-hidden="true">
                    {build.manualSheet ? <Check /> : "○"}
                  </span>
                  <span>
                    <b>Manual character sheet</b>
                    <small>
                      Record values you worked out yourself. The sheet is clearly marked Manual and never claims to be
                      automatically rules-justified.
                    </small>
                  </span>
                </button>
              </li>
            </ul>
          </fieldset>
        </div>
      );

    case "origin":
      return (
        <div className="m2-step">
          <OptionStep
            legend="Species"
            // `race` is the older category for the same decision. A ruleset that
            // still uses it must remain selectable, not silently offer nothing.
            options={entries.filter(entry => ORIGIN_CATEGORIES.has(entry.category)).map(entry => ({ id: entry.id, label: entry.name, summary: entry.summary }))}
            selected={build.speciesId ? [build.speciesId] : []}
            recommendations={recommendations}
            onSelect={id => onChange({ speciesId: id })}
          />
          <OptionStep
            legend="Background"
            options={entries.filter(entry => entry.category === "background").map(entry => ({ id: entry.id, label: entry.name, summary: entry.summary }))}
            selected={build.backgroundId ? [build.backgroundId] : []}
            recommendations={recommendations}
            onSelect={id => onChange({ backgroundId: id })}
          />
          <ChoiceGroups build={build} plan={plan} stepId="origin" onChange={onChange} />
        </div>
      );

    case "abilities":
      return <AbilitiesStep build={build} entries={entries} recommendations={recommendations} onChange={onChange} />;

    case "class-choices":
      return build.manualSheet ? (
        <ManualSheetStep build={build} onChange={onChange} />
      ) : (
        <div className="m2-step">
          <SubclassStep plan={plan} build={build} onChange={onChange} />
          <ChoiceGroups build={build} plan={plan} stepId="class-choices" onChange={onChange} />
        </div>
      );

    case "equipment":
      return <EquipmentStep build={build} entries={entries} plan={plan} onChange={onChange} />;

    case "identity":
      return <IdentityStep build={build} onType={onType} />;

    case "review":
      return <ReviewStep build={build} entries={entries} plan={plan} presentation={presentation} />;

    default:
      return <div className="m2-step" />;
  }
}

/**
 * Name, ruleset and target level.
 *
 * These three decide what everything after them means: the name is the record's
 * identity, the ruleset fixes which content is even visible, and the level fixes
 * how much of each progression the build has to resolve. They belong together,
 * before any of it.
 */
function StartStep({
  build,
  plan,
  rulesets,
  activeRulesetId,
  onChange,
  onType,
  onSelectRuleset,
}: {
  build: CharacterDraftBuild;
  plan: DraftSnapshot["plan"];
  rulesets: readonly InstalledRulesetView[];
  activeRulesetId: string;
  onChange(patch: DraftPatch): void;
  onType(patch: Partial<CharacterDraftBuild>): void;
  onSelectRuleset(id: string): void;
}) {
  const [name, setName] = useState(build.name);
  /**
   * Once the user types, the field owns its own value.
   *
   * Autosave is debounced, so the persisted name always trails what is on
   * screen. Re-syncing the input from the draft while typing would rewind the
   * last few keystrokes; the value is re-read from the draft on the next mount,
   * which is exactly when the draft is authoritative again.
   */
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setName(build.name);
  }, [build.name]);

  /*
   * The selector offers exactly the levels the content supports.
   *
   * It used to offer `max(supported, stored)`, which quietly made the stored
   * level look supported: choosing a class that stops at 3 left a level 5 build
   * showing 5 as a perfectly ordinary option. The supported range is the
   * content's answer, and a stored level outside it is a conflict to resolve
   * rather than a range to widen.
   */
  const supportedLevels = Array.from({ length: plan.maxLevel }, (_, offset) => offset + 1);
  const levelUnsupported = build.level > plan.maxLevel;
  const active = rulesets.find(ruleset => ruleset.id === activeRulesetId);

  return (
    <div className="m2-step">
      <div className="m2-field">
        <label htmlFor="start-name">
          <span>Character name</span>
        </label>
        <input
          id="start-name"
          value={name}
          autoComplete="off"
          onChange={event => {
            typed.current = true;
            setName(event.target.value);
            onType({ name: event.target.value });
          }}
          onBlur={() => onChange({ name })}
        />
        <p className="m2-muted">Saved as you type. You can change it at any point before or after creation.</p>
      </div>

      <fieldset className="m2-fieldset">
        <legend>Ruleset</legend>
        <p className="m2-muted">
          The ruleset decides which classes, origins and equipment this build can use. Everything is stored on this
          device only.
        </p>
        {rulesets.length ? (
          <ul className="m2-options">
            {rulesets.map(ruleset => {
              const isSelected = ruleset.id === activeRulesetId;
              return (
                <li key={ruleset.id}>
                  <button
                    type="button"
                    className={isSelected ? "m2-option m2-option-selected" : "m2-option"}
                    aria-pressed={isSelected}
                    onClick={() => onSelectRuleset(ruleset.id)}
                  >
                    <span className="m2-option-mark" aria-hidden="true">
                      {isSelected ? <Check /> : "○"}
                    </span>
                    <span>
                      <b>{ruleset.name}</b>
                      <small>
                        {ruleset.entryCount} entries · levels 1–{ruleset.maxSupportedLevel}
                        {ruleset.usable ? "" : " · cannot create a character on its own"}
                      </small>
                      {/*
                       * Whether this profile reaches private or export-restricted
                       * content. Derived from record metadata, so it says which
                       * kind of content is in scope without quoting any of it.
                       */}
                      <small className="m2-ruleset-privacy">{RULESET_PRIVACY_LABELS[ruleset.privacy]}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m2-muted">No ruleset is installed. Import a content pack and create its ruleset first.</p>
        )}
        {rulesets.length > 1 ? (
          <p className="m2-muted">
            Changing the ruleset clears the class, origin and choices, because they belong to the ruleset that defined
            them. You are shown exactly what would change, and nothing is written until you confirm. The name, level and
            base ability scores are kept.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="m2-fieldset">
        <legend>Starting level</legend>
        <div className="m2-field">
          <label htmlFor="start-level">
            <span>Create this character at level</span>
          </label>
          <select
            id="start-level"
            value={levelUnsupported ? "" : build.level}
            aria-invalid={levelUnsupported || undefined}
            aria-describedby={levelUnsupported ? "start-level-conflict" : undefined}
            onChange={event => onChange({ level: Number(event.target.value) })}
          >
            {/*
             * The stored level stays visible so the conflict is legible, and
             * stays unselectable so it cannot be re-confirmed as if it were
             * supported. Choosing a supported level is the repair.
             */}
            {levelUnsupported ? (
              <option value="" disabled>
                {build.level} — not supported
              </option>
            ) : null}
            {supportedLevels.map(level => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <p className="m2-muted">
          {active
            ? `This ruleset's content covers levels 1 to ${active.maxSupportedLevel}.`
            : `The installed content covers levels 1 to ${plan.maxLevel}.`}{" "}
          Everything each level grants is resolved here, in one pass — the character is created at this level, not
          created at 1 and advanced afterwards.
        </p>
        {levelUnsupported || plan.levelCoverage === "not-covered" ? (
          <div className="m2-inline-issue" role="alert" id="start-level-conflict">
            <TriangleAlert aria-hidden="true" />
            <span>
              {labelFor("LEVEL_NOT_COVERED_BY_CLASS")}
              {plan.classProgressionMax === undefined ? "" : ` This class stops at level ${plan.classProgressionMax}.`}{" "}
              This build is set to level {build.level}.
              <button
                type="button"
                className="m2-button"
                onClick={() => onChange({ level: plan.maxLevel })}
              >
                Set the level to {plan.maxLevel}
              </button>
            </span>
          </div>
        ) : plan.levelCoverage === "no-class" && build.level > 1 ? (
          // Not an error: nothing is wrong yet. But the level is unverified
          // until a class exists, and saying so is better than implying it is fine.
          <p className="m2-inline-issue" role="status">
            <TriangleAlert aria-hidden="true" />
            Level {build.level} cannot be confirmed until a class is chosen, because coverage comes from the class&apos;s
            own progression.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}

/**
 * The explicit subclass decision.
 *
 * It is offered at the level the class itself declares, persists as its own
 * identity, and activates that subclass's progression and choices. Modelling it
 * as one more anonymous option would lose all four of those.
 */
function SubclassStep({
  plan,
  build,
  onChange,
}: {
  plan: DraftSnapshot["plan"];
  build: CharacterDraftBuild;
  onChange(patch: DraftPatch): void;
}) {
  const subclass = plan.subclass;
  if (!subclass || !subclass.options.length) return null;
  if (!subclass.reached)
    return (
      <p className="m2-muted">
        {subclass.classLabel} chooses a subclass at level {subclass.atLevel}. This build is level {build.level}.
      </p>
    );

  return (
    <fieldset className="m2-fieldset">
      <legend>
        Subclass
        <small className="m2-muted"> chosen at level {subclass.atLevel}</small>
      </legend>
      {subclass.unresolved ? (
        <p className="m2-inline-issue" role="status">
          <TriangleAlert aria-hidden="true" /> {labelFor("SUBCLASS_NOT_CHOSEN")}
        </p>
      ) : null}
      <ul className="m2-options">
        {subclass.options.map(option => {
          const isSelected = subclass.selectedId === option.id && subclass.valid;
          return (
            <li key={option.id}>
              <button
                type="button"
                className={isSelected ? "m2-option m2-option-selected" : "m2-option"}
                aria-pressed={isSelected}
                onClick={() => onChange({ subclassId: option.id })}
              >
                <span className="m2-option-mark" aria-hidden="true">
                  {isSelected ? <Check /> : "○"}
                </span>
                <span>
                  <b>{option.label}</b>
                  {option.summary ? <small>{option.summary}</small> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * Free-text identity.
 *
 * A nickname is identity only and feeds no calculation. Pronouns are no longer
 * collected here: the creation flow asks for what it needs, and a stored value
 * on an older character is preserved untouched rather than migrated away.
 */
function IdentityStep({
  build,
  onType,
}: {
  build: CharacterDraftBuild;
  onType(patch: Partial<CharacterDraftBuild>): void;
}) {
  const [nickname, setNickname] = useState(build.nickname ?? "");
  const typed = useRef(false);
  useEffect(() => {
    if (!typed.current) setNickname(build.nickname ?? "");
  }, [build.nickname]);

  return (
    <div className="m2-step">
      <h3>Identity</h3>
      <p className="m2-muted">Nothing here changes a calculation. A nickname is identity only.</p>
      <div className="m2-field">
        <label htmlFor="identity-nickname">
          <span>Nickname</span>
        </label>
        <input
          id="identity-nickname"
          value={nickname}
          onChange={event => {
            typed.current = true;
            setNickname(event.target.value);
            onType({ nickname: event.target.value });
          }}
        />
      </div>
      <p className="m2-muted">The character&apos;s name is set on the first step.</p>
    </div>
  );
}

function OptionStep({
  legend,
  options,
  selected,
  recommendations,
  onSelect,
  multiple,
}: {
  legend: string;
  options: readonly { id: string; label: string; summary?: string }[];
  selected: readonly string[];
  recommendations: readonly { optionId: string; why: string }[];
  onSelect(id: string): void;
  multiple?: boolean;
}) {
  const [explaining, setExplaining] = useState<string | null>(null);
  return (
    <fieldset className="m2-fieldset">
      <legend>{legend}</legend>
      <ul className="m2-options">
        {options.map(option => {
          const recommendation = recommendations.find(item => item.optionId === option.id);
          const isSelected = selected.includes(option.id);
          return (
            <li key={option.id}>
              <button
                type="button"
                className={isSelected ? "m2-option m2-option-selected" : "m2-option"}
                aria-pressed={isSelected}
                onClick={() => onSelect(option.id)}
              >
                <span className="m2-option-mark" aria-hidden="true">
                  {isSelected ? <Check /> : multiple ? "＋" : "○"}
                </span>
                <span>
                  <b>{option.label}</b>
                  {option.summary ? <small>{option.summary}</small> : null}
                </span>
                {recommendation ? <span className="m2-badge m2-badge-recommended">Recommended</span> : null}
              </button>
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

function ChoiceGroups({
  build,
  plan,
  stepId,
  onChange,
}: {
  build: CharacterDraftBuild;
  plan: DraftSnapshot["plan"];
  stepId: BuilderStepId;
  onChange(patch: DraftPatch): void;
}) {
  const groups = plan.requiredChoices.filter(choice => choice.stepId === stepId);
  if (!groups.length) return <p className="m2-muted">No choices are required here yet.</p>;

  const toggle = (choiceId: string, optionId: string, max: number) =>
    onChange(current => {
      const existing = current.choiceSelections[choiceId] ?? [];
      const next = existing.includes(optionId)
        ? existing.filter(item => item !== optionId)
        : max === 1
          ? [optionId]
          : [...existing, optionId].slice(-max);
      return { choiceSelections: { ...current.choiceSelections, [choiceId]: next } };
    });

  return (
    <div className="m2-step">
      {groups.map(choice => (
        <ChoiceGroup key={choice.choiceId} choice={choice} onToggle={toggle} />
      ))}
    </div>
  );
}

function ChoiceGroup({
  choice,
  onToggle,
}: {
  choice: RequiredChoice;
  onToggle(choiceId: string, optionId: string, max: number): void;
}) {
  return (
    <fieldset className="m2-fieldset">
      <legend>
        {choice.label}
        <small className="m2-muted">
          {" "}
          choose {choice.min === choice.max ? choice.min : `${choice.min}–${choice.max}`}
        </small>
      </legend>
      {/* Provenance stays visible: which entry asks for this, and from when. */}
      <p className="m2-muted">
        From {choice.sourceLabel}
        {choice.level === undefined ? "" : ` · level ${choice.level}`}
      </p>
      {!choice.resolved ? (
        <p className="m2-inline-issue" role="status">
          <TriangleAlert aria-hidden="true" /> {choice.selected.length} of {choice.min} chosen
        </p>
      ) : null}
      <ul className="m2-options">
        {choice.options.map(option => {
          const isSelected = choice.selected.includes(option.id);
          const incompatible = choice.incompatibleOptions.find(item => item.optionId === option.id);
          const redundant = option.alreadyGrantedBy;
          return (
            <li key={option.id}>
              <button
                type="button"
                className={isSelected ? "m2-option m2-option-selected" : "m2-option"}
                aria-pressed={isSelected}
                // An option that would grant nothing new is not a live choice.
                // It stays visible and explained, so the list still reads as the
                // rules wrote it, and the remaining options are the alternatives.
                disabled={Boolean(redundant) && !isSelected}
                onClick={() => onToggle(choice.choiceId, option.id, choice.max)}
              >
                <span className="m2-option-mark" aria-hidden="true">
                  {isSelected ? <Check /> : "○"}
                </span>
                <span>
                  <b>{option.label}</b>
                  {incompatible ? <small>Requires {incompatible.requirement}</small> : null}
                  {redundant ? <small>Already granted by {redundant.entryLabel}</small> : null}
                </span>
                {incompatible ? <span className="m2-badge m2-badge-incomplete">Incompatible</span> : null}
                {redundant ? <span className="m2-badge m2-badge-incomplete">Already granted</span> : null}
              </button>
              {incompatible && isSelected ? (
                <p className="m2-inline-issue" role="status">
                  <TriangleAlert aria-hidden="true" />
                  {option.label} does not meet {incompatible.requirement}. {incompatible.repair} Nothing has been
                  changed for you; switch to flexible mode to keep this choice with its issue recorded.
                </p>
              ) : null}
              {redundant && isSelected ? (
                <p className="m2-inline-issue" role="status">
                  <TriangleAlert aria-hidden="true" />
                  {option.label} is already granted by {redundant.entryLabel}, so choosing it here would leave you one
                  proficiency short. Pick a different option for {choice.label}.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * Ability entry.
 *
 * The model is the same in both methods: base scores plus origin increases give
 * the final scores. The numeric inputs of the manual method therefore edit the
 * base scores, not the finals — editing the finals would silently absorb the
 * origin increase into a number the user typed, and the origin's contribution
 * would stop being visible or removable.
 */
function AbilitiesStep({
  build,
  entries,
  recommendations,
  onChange,
}: {
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  recommendations: readonly { optionId: string; why: string }[];
  onChange(patch: DraftPatch): void;
}) {
  const background = build.backgroundId ? entries.find(entry => entry.id === build.backgroundId) : undefined;
  const choices = (background?.mechanics as { abilityScoreChoices?: { abilities?: string[]; increasePattern?: number[] } } | undefined)
    ?.abilityScoreChoices;
  const allowed = (choices?.abilities ?? []) as Ability[];
  const pattern = choices?.increasePattern ?? [];

  const withTotals = (base: Partial<Record<Ability, number>>, increases: Partial<Record<Ability, number>>) => {
    const final: Partial<Record<Ability, number>> = {};
    for (const ability of ABILITIES) {
      const baseScore = base[ability];
      if (typeof baseScore === "number") final[ability] = baseScore + (increases[ability] ?? 0);
    }
    return { abilityBaseScores: base, abilityIncreases: increases, abilityScores: final };
  };

  const assign = (ability: Ability, value: number | undefined) =>
    onChange(current => {
      const base = { ...current.abilityBaseScores };
      if (value === undefined) delete base[ability];
      else base[ability] = value;
      return withTotals(base, current.abilityIncreases);
    });

  /**
   * Increases are stored keyed by ability, so each slot is identified by its
   * amount. The accepted origin pattern is +2/+1, whose amounts are distinct; a
   * future pattern with repeated amounts would need a slot-keyed draft field.
   */
  const increaseIn = (source: Readonly<Partial<Record<Ability, number>>>, amount: number) =>
    (Object.entries(source).find(([, value]) => value === amount)?.[0] as Ability | undefined);
  const increaseFor = (amount: number) => increaseIn(build.abilityIncreases, amount);

  const setIncrease = (amount: number, ability: Ability | undefined) =>
    onChange(current => {
      const increases: Partial<Record<Ability, number>> = {};
      for (const patternAmount of pattern) {
        const target = patternAmount === amount ? ability : increaseIn(current.abilityIncreases, patternAmount);
        if (target) increases[target] = patternAmount;
      }
      return withTotals(current.abilityBaseScores, increases);
    });

  const remaining = remainingArraySlots(
    standardArrayFor(entries) ?? [],
    ABILITIES.map(ability => build.abilityBaseScores[ability]),
  );

  const originIncreases =
    pattern.length ? (
      <fieldset className="m2-fieldset">
        <legend>Origin increases</legend>
        <p className="m2-muted">
          These are added on top of the base scores, whichever method produced them. Base + origin = final.
        </p>
        <div className="m2-ability-grid">
          {pattern.map(amount => (
            <label key={amount} className="m2-field" htmlFor={`increase-${amount}`}>
              <span>+{amount} to</span>
              <select
                id={`increase-${amount}`}
                value={increaseFor(amount) ?? ""}
                onChange={event => setIncrease(amount, event.target.value ? (event.target.value as Ability) : undefined)}
              >
                <option value="">—</option>
                {allowed.map(ability => (
                  <option key={ability} value={ability}>
                    {titleCase(ability)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </fieldset>
    ) : null;

  const finalScores = (
    <div className="m2-ability-grid">
      {ABILITIES.map(ability => {
        const total = build.abilityScores[ability];
        const name = titleCase(ability);
        return (
          <div key={ability} className="m2-field">
            <span className="m2-static-label" id={`final-${ability}-label`}>
              {name} final
            </span>
            <output className="m2-ability-final" aria-labelledby={`final-${ability}-label`}>
              {typeof total === "number" ? total : "—"}
              {typeof total === "number" ? (
                <small className="m2-ability-modifier" aria-label={`${name} modifier`}>
                  {signed(abilityModifier(total))}
                </small>
              ) : null}
            </output>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="m2-step">
      <fieldset className="m2-fieldset">
        <legend>Method</legend>
        <ul className="m2-options">
          {(["standard-array", "manual"] as const).map(method => {
            const recommendation = recommendations.find(item => item.optionId === method);
            return (
              <li key={method}>
                <button
                  type="button"
                  className={build.abilityMethod === method ? "m2-option m2-option-selected" : "m2-option"}
                  aria-pressed={build.abilityMethod === method}
                  // Only the method changes. Base scores and the origin
                  // allocation are left exactly as they are, so switching to
                  // compare the two does not cost the user their placement.
                  onClick={() => onChange({ abilityMethod: method })}
                >
                  <span className="m2-option-mark" aria-hidden="true">
                    {build.abilityMethod === method ? <Check /> : "○"}
                  </span>
                  <span>
                    <b>{method === "standard-array" ? "Standard array" : "Enter scores manually"}</b>
                    {recommendation ? <small>{recommendation.why}</small> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      {build.abilityMethod === "standard-array" ? (
        <>
          {/*
           * Remaining values are shown as discrete chips, one per unassigned
           * slot. Slots, not distinct numbers: an array containing the same
           * number twice offers it twice and is consumed twice.
           */}
          <div className="m2-remaining" aria-live="polite">
            <span className="m2-remaining-label">Remaining values</span>
            {remaining.length ? (
              <ul className="m2-remaining-list">
                {remaining.map((value, slot) => (
                  <li key={`${value}-${slot}`} className="m2-remaining-chip">
                    {value}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m2-muted">All assigned.</p>
            )}
          </div>
          <div className="m2-ability-grid">
            {ABILITIES.map(ability => {
              const name = titleCase(ability);
              return (
                // The select and the computed total are associated explicitly:
                // wrapping both in one label would fold the total into the
                // select's accessible name.
                <div key={ability} className="m2-field">
                  <label htmlFor={`ability-${ability}`}>
                    <span>{name}</span>
                  </label>
                  <select
                    id={`ability-${ability}`}
                    value={build.abilityBaseScores[ability] ?? ""}
                    onChange={event => assign(ability, event.target.value ? Number(event.target.value) : undefined)}
                  >
                    <option value="">—</option>
                    {[...new Set([...remaining, build.abilityBaseScores[ability]].filter((v): v is number => typeof v === "number"))]
                      .sort((a, b) => b - a)
                      .map(value => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                  </select>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="m2-ability-grid">
          {ABILITIES.map(ability => {
            const name = titleCase(ability);
            return (
              <div key={ability} className="m2-field">
                <label htmlFor={`ability-${ability}`}>
                  <span>{name} base</span>
                </label>
                <input
                  id={`ability-${ability}`}
                  type="number"
                  min={1}
                  max={30}
                  value={build.abilityBaseScores[ability] ?? ""}
                  onChange={event => assign(ability, event.target.value ? Number(event.target.value) : undefined)}
                />
              </div>
            );
          })}
        </div>
      )}

      {originIncreases}

      <h4>Final scores</h4>
      <p className="m2-muted">Base score plus the origin increase. This is what the sheet uses.</p>
      {finalScores}
    </div>
  );
}

/**
 * Manual-sheet values.
 *
 * These are the explicit minimum from D-03. Nothing here is derived, and the
 * resulting sheet carries a Manual badge so it cannot be mistaken for an
 * automatically justified character.
 */
function ManualSheetStep({
  build,
  onChange,
}: {
  build: CharacterDraftBuild;
  onChange(patch: DraftPatch): void;
}) {
  const FIELDS: readonly [string, string][] = [
    ["hitPoints.maximum", "Maximum hit points"],
    ["hitPoints.current", "Current hit points"],
    ["armorClass", "Armour class"],
    ["initiative", "Initiative"],
    ["speed", "Speed (optional)"],
  ];

  const setValue = (path: string, raw: string) =>
    onChange(current => {
      const manualValues = { ...current.manualValues };
      if (raw === "") delete manualValues[path];
      else manualValues[path] = Number(raw);
      return { manualValues };
    });

  const addAction = () =>
    onChange(current => ({
      manualActions: [
        ...current.manualActions,
        { id: `manual-action:${current.manualActions.length + 1}`, label: "New action", expression: "" },
      ],
    }));

  return (
    <div className="m2-step">
      <h3>Manual values</h3>
      <p className="m2-muted">
        This character has no class, so nothing is calculated. Enter the values your table agreed.
      </p>
      <div className="m2-ability-grid">
        {FIELDS.map(([path, label]) => (
          <div className="m2-field" key={path}>
            <label htmlFor={`manual-${path}`}>
              <span>{label}</span>
            </label>
            <input
              id={`manual-${path}`}
              type="number"
              value={build.manualValues[path] ?? ""}
              onChange={event => setValue(path, event.target.value)}
            />
          </div>
        ))}
      </div>

      <fieldset className="m2-fieldset">
        <legend>Actions</legend>
        {build.manualActions.length ? (
          <ul className="m2-plain-list">
            {build.manualActions.map((action, index) => (
              <li key={action.id}>
                <div className="m2-field">
                  <label htmlFor={`manual-action-${action.id}`}>
                    <span>Action {index + 1}</span>
                  </label>
                  <input
                    id={`manual-action-${action.id}`}
                    value={action.label}
                    onChange={event =>
                      onChange(current => ({
                        manualActions: current.manualActions.map(item =>
                          item.id === action.id ? { ...item, label: event.target.value } : item,
                        ),
                      }))
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m2-muted">A manual sheet needs at least one action.</p>
        )}
        <button type="button" className="m2-button" onClick={addAction}>
          Add an action
        </button>
      </fieldset>
    </div>
  );
}

/**
 * Starting equipment.
 *
 * Every granting source is shown, not just the class: what is given
 * automatically, and what each selectable package actually contains before it is
 * chosen. A package presented only by its name asks the user to choose between
 * two labels they cannot read the contents of.
 */
function EquipmentStep({
  build,
  entries,
  plan,
  onChange,
}: {
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  plan: DraftSnapshot["plan"];
  onChange(patch: DraftPatch): void;
}) {
  const grants = plan.equipmentGrants;
  if (!grants.length)
    return <p className="m2-muted">Nothing in this build grants starting equipment.</p>;

  return (
    <div className="m2-step">
      {grants.map(grant => (
        <section key={grant.bundleId} className="m2-fieldset">
          <h3>{grant.bundleLabel}</h3>
          {/*
           * One bundle, every source that grants it. Two entries granting the
           * same kit is one kit with two reasons, not two kits.
           */}
          <p className="m2-muted">
            Granted by {grant.grantedBy.map(source => `${source.label} (${source.category})`).join(" and ")}
          </p>
          {grant.automatic.length ? (
            <>
              <h4>Included automatically</h4>
              <ul className="m2-plain-list">
                {grant.automatic.map(item => (
                  <li key={`${item.itemId}-${item.status}`}>
                    {item.label}
                    {item.quantity > 1 ? ` ×${item.quantity}` : ""} <small className="m2-muted">({item.status})</small>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {grant.choices.map(choice => {
            const selected = build.equipmentSelections[choice.choiceId] ?? [];
            return (
              <fieldset className="m2-fieldset" key={choice.choiceId}>
                <legend>
                  {choice.label}
                  <small className="m2-muted">
                    {" "}
                    choose {choice.min === choice.max ? choice.min : `${choice.min}–${choice.max}`}
                  </small>
                </legend>
                <ul className="m2-options">
                  {choice.options.map(option => (
                    <li key={option.id}>
                      <button
                        type="button"
                        className={selected.includes(option.id) ? "m2-option m2-option-selected" : "m2-option"}
                        aria-pressed={selected.includes(option.id)}
                        onClick={() =>
                          onChange(current => ({
                            equipmentSelections: { ...current.equipmentSelections, [choice.choiceId]: [option.id] },
                          }))
                        }
                      >
                        <span className="m2-option-mark" aria-hidden="true">
                          {selected.includes(option.id) ? <Check /> : "○"}
                        </span>
                        <span>
                          <b>{option.label}</b>
                          {/* The contents, before the decision, not after it. */}
                          <small>
                            {option.contents.length
                              ? option.contents
                                  .map(item => `${item.label}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`)
                                  .join(", ")
                              : "Nothing"}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </fieldset>
            );
          })}
        </section>
      ))}
      {entries.length ? null : <p className="m2-muted">This ruleset activates no content.</p>}
    </div>
  );
}

function ReviewStep({
  build,
  entries,
  plan,
  presentation,
}: {
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  plan: DraftSnapshot["plan"];
  presentation: "guided" | "flexible";
}) {
  const name = (id: string | undefined) => (id ? entries.find(entry => entry.id === id)?.name ?? id : "Not chosen");
  const errors = plan.issues.filter(issue => issue.severity === "error");
  const warnings = plan.issues.filter(issue => issue.severity !== "error");
  const equipment = selectedEquipmentFor(plan.equipmentGrants, build.equipmentSelections);

  /** Proficiencies grouped by the entry that grants them. */
  const bySource = new Map<string, { label: string; grants: typeof plan.proficiencies.grants }>();
  for (const grant of plan.proficiencies.grants) {
    const existing = bySource.get(grant.source.entryId);
    if (existing) bySource.set(grant.source.entryId, { label: existing.label, grants: [...existing.grants, grant] });
    else bySource.set(grant.source.entryId, { label: grant.source.entryLabel, grants: [grant] });
  }

  return (
    <div className="m2-step">
      <h3>Review</h3>

      {/*
       * The coverage conflict is stated here as well as on the first step,
       * because Review is where a build is committed from and this is the one
       * issue no mode may commit past. It names the problem and the repair.
       */}
      {plan.levelCoverage === "not-covered" ? (
        <div className="m2-banner m2-banner-error" role="alert">
          <strong>This level cannot be created</strong>
          <p>
            {build.name.trim() || "This character"} is set to level {build.level}, but{" "}
            {name(build.classId)}
            {plan.classProgressionMax === undefined
              ? " does not describe that level"
              : ` describes levels 1 to ${plan.classProgressionMax}`}
            . Go back to the first step and either lower the level to {plan.maxLevel} or choose a class whose content
            reaches level {build.level}. This cannot be saved in either mode, because the resulting sheet would take its
            hit dice from one level and its maximum hit points from another.
          </p>
        </div>
      ) : null}

      <dl className="m2-summary">
        <div>
          <dt>Name</dt>
          <dd>{build.name.trim() || "Unnamed character"}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>
            {name(build.classId)}
            {plan.subclass?.valid && build.subclassId ? ` · ${name(build.subclassId)}` : ""}
          </dd>
        </div>
        <div>
          <dt>Origin</dt>
          <dd>
            {name(build.speciesId)} · {name(build.backgroundId)}
          </dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd>Level {build.level}</dd>
        </div>
        <div>
          <dt>Abilities</dt>
          {/*
           * The planner's finals, which are the base scores plus only the origin
           * increases the current origin still authorises. Showing the stored
           * finals here would display a number the commit is not going to write.
           */}
          <dd>
            {ABILITIES.map(ability => `${ability.slice(0, 3).toUpperCase()} ${plan.abilities.final[ability] ?? "—"}`).join(" · ")}
          </dd>
        </div>
        {/*
         * Systems that contribute no choices are stated here rather than given
         * an empty step, so an omitted step reads as inapplicable rather than
         * forgotten.
         */}
        {plan.systemSummaries
          .filter(summary => !summary.applicable)
          .map(summary => (
            <div key={summary.id}>
              <dt>{summary.label}</dt>
              <dd className="m2-muted">{summary.value}</dd>
            </div>
          ))}
      </dl>
      <p className="m2-muted">
        Automatic values come from the active ruleset&apos;s content. Anything you entered yourself is listed as a manual
        value and is never described as rules-derived.
      </p>

      <h4>Choices by source</h4>
      <ul className="m2-plain-list">
        {plan.requiredChoices.map(choice => (
          <li key={choice.choiceId}>
            <b>{choice.label}</b> <small className="m2-muted">({choice.sourceLabel})</small>:{" "}
            {choice.selected.length
              ? choice.selected.map(id => choice.options.find(option => option.id === id)?.label ?? id).join(", ")
              : "Not chosen"}
          </li>
        ))}
      </ul>

      <h4>Proficiencies by source</h4>
      {bySource.size ? (
        <ul className="m2-plain-list">
          {[...bySource.entries()].map(([entryId, group]) => (
            <li key={entryId}>
              <b>{group.label}</b>
              <ul className="m2-plain-list">
                {group.grants.map(grant => (
                  <li key={`${grant.proficiencyId}-${grant.choiceId ?? "auto"}`}>
                    {grant.label} —{" "}
                    {grant.kind === "automatic" ? "automatic" : `chosen in ${grant.choiceLabel ?? grant.choiceId}`}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m2-muted">No proficiencies are granted yet.</p>
      )}

      <h4>Equipment</h4>
      {equipment.length ? (
        <ul className="m2-plain-list">
          {equipment.map(item => (
            <li key={`${item.itemId}-${item.status}`}>
              {item.label}
              {item.quantity > 1 ? ` ×${item.quantity}` : ""} <small className="m2-muted">({item.status})</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m2-muted">Nothing in this build grants starting equipment.</p>
      )}

      <h4>Issues by severity</h4>
      {errors.length ? (
        <ul className="m2-plain-list m2-issue-errors">
          {errors.map((issue, position) => (
            <li key={`${issue.code}-${position}`}>{labelFor(issue.code)}</li>
          ))}
        </ul>
      ) : (
        <p className="m2-muted">No blocking issues.</p>
      )}
      {warnings.length ? (
        <ul className="m2-plain-list m2-issue-warnings">
          {warnings.map((issue, position) => (
            <li key={`${issue.code}-${position}`}>{labelFor(issue.code)}</li>
          ))}
        </ul>
      ) : null}

      {presentation === "flexible" && errors.length ? (
        <p className="m2-not-needed">
          Flexible mode saves this build with its issues recorded. It does not describe these values as automatically
          rules-valid.
        </p>
      ) : null}
    </div>
  );
}
