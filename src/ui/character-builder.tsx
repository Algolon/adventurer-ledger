"use client";

/**
 * The nine-step character builder.
 *
 * One persisted draft backs both presentation modes: switching between guided
 * and flexible changes guidance only and never clears a selection. Every
 * accepted choice autosaves through CharacterDraftService with the expected
 * revision, so a reload, a closed tab or an offline session resumes at the last
 * committed step. Guided recommendations are ranked and explained but never
 * applied automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, ListChecks, TriangleAlert } from "lucide-react";
import { BUILDER_STEPS, recommendationsFor, remainingArraySlots, type BuilderStepId, type PlannedStep } from "@/src/services/build-planner";
import { ABILITIES, type CharacterDraftBuild } from "@/src/domain/character-record";
import type { Ability, ContentEntry } from "@/src/domain/model";
import { standardArrayFor } from "@/src/services/content-scope";
import { abilityModifier } from "@/src/rules/engine";
import { signed } from "@/src/ui/primitives";
import { requiredEquipmentChoices } from "@/src/services/build-planner";
import { useAsync, useServices } from "@/src/ui/services-context";
import type { DraftSnapshot } from "@/src/services/character-services";

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
  EQUIPMENT_CHOICE_REQUIRED: "Choose your travelling gear",
  NAME_NOT_SET: "Name the character (optional)",
  MANUAL_MINIMUM_NOT_MET: "A manual sheet needs abilities, hit points, armour class, initiative and one action",
  MANUAL_VALUE_MISSING: "Enter every required manual value",
  MANUAL_ACTION_MISSING: "Add at least one action",
};

const labelFor = (code: string) => ISSUE_LABELS[code] ?? code;

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
  const { drafts, commit, query, refresh } = useServices();
  const [snapshot, setSnapshot] = useState<DraftSnapshot | null>(null);
  const [stepId, setStepId] = useState<BuilderStepId>("start");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [commitErrors, setCommitErrors] = useState<{ code: string; label: string }[]>([]);
  const [showSteps, setShowSteps] = useState(false);
  const revisionRef = useRef<number | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  /** Freshest snapshot, readable after awaiting the save queue. */
  const snapshotRef = useRef<DraftSnapshot | null>(null);
  /** Focus moves here when a submit produces issues, so it is announced. */
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const rulesetId = snapshot?.draft.rulesetProfileId;
  const entriesState = useAsync(
    () => (rulesetId ? query.contentForRuleset(rulesetId) : Promise.resolve([])),
    [rulesetId],
  );
  const entries = useMemo<ContentEntry[]>(() => (entriesState.status === "ready" ? entriesState.value : []), [entriesState]);

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

  /**
   * Autosaves are serialised through one queue and read the revision from a ref
   * rather than from rendered state. Two changes in quick succession — typing a
   * name and then pressing Continue — would otherwise both send the revision
   * that was current at the last render, and the second would be rejected as
   * stale even though nothing else touched the draft.
   */
  useEffect(() => {
    if (commitErrors.length) errorSummaryRef.current?.focus();
  }, [commitErrors]);

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

  if (!snapshot)
    return (
      <div className="m2-builder" aria-busy="true">
        <p role="status">Opening the build…</p>
      </div>
    );

  const { draft, plan } = snapshot;
  const rulesetLabel = draft.rulesetProfileId.replace(/^ruleset:/, "");
  const build = draft.build;
  const steps = plan.steps;
  const index = steps.findIndex(step => step.id === stepId);
  const current = steps[index] ?? steps[0];

  const goTo = (id: BuilderStepId) => {
    setStepId(id);
    setShowSteps(false);
    void save({}, id);
  };

  /**
   * Continue waits for queued autosaves and then judges the step against the
   * freshest plan. Reading the rendered plan instead would block the user on a
   * choice they had just made but whose save had not yet landed.
   */
  const advance = async () => {
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
          rulesetLabel={rulesetLabel}
          presentation={draft.presentation}
          plan={snapshot.plan}
          onChange={save}
        />
      </div>

      {/* Exactly two actions, one row, equal height: Back secondary, Continue primary. */}
      <footer className="m2-task-footer">
        <button
          type="button"
          className="m2-button m2-button-secondary"
          onClick={() => (index > 0 ? goTo(steps[index - 1].id) : onClose())}
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

function StepContent({
  step,
  build,
  entries,
  rulesetLabel,
  presentation,
  plan,
  onChange,
}: {
  step: PlannedStep;
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  rulesetLabel: string;
  presentation: "guided" | "flexible";
  plan: DraftSnapshot["plan"];
  onChange(patch: DraftPatch): void;
}) {
  const recommendations = presentation === "guided" ? recommendationsFor(step.id, build, entries) : [];


  switch (step.id) {
    case "start":
      return (
        <div className="m2-step">
          <h3>Ruleset</h3>
          <p className="m2-muted">
            This build uses <b>{rulesetLabel}</b>. Everything is stored on this device only.
          </p>
          {/*
           * Creation always starts at level 1; level 2 is reached through the
           * Level up flow. This was a readonly number input, which offered
           * spinner arrows and a focus stop for a value it would never accept.
           * A static value is the honest presentation of a fixed fact.
           */}
          <div className="m2-static-field">
            <span className="m2-static-label" id="starting-level-label">
              Starting level
            </span>
            <strong className="m2-static-value" aria-labelledby="starting-level-label">
              Level {build.level}
            </strong>
            <p className="m2-muted">Advance after creation through Level up.</p>
          </div>
        </div>
      );

    case "class":
      return (
        <div className="m2-step">
          <OptionStep
            legend="Class"
            options={entries.filter(entry => entry.category === "class").map(entry => ({ id: entry.id, label: entry.name, summary: entry.summary }))}
            selected={build.manualSheet ? [] : build.classId ? [build.classId] : []}
            recommendations={recommendations}
            onSelect={id => onChange({ classId: id, manualSheet: false })}
          />
          <fieldset className="m2-fieldset">
            <legend>Or build a manual sheet</legend>
            <ul className="m2-options">
              <li>
                <button
                  type="button"
                  className={build.manualSheet ? "m2-option m2-option-selected" : "m2-option"}
                  aria-pressed={build.manualSheet === true}
                  onClick={() => onChange({ manualSheet: !build.manualSheet, classId: undefined })}
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
            options={entries.filter(entry => entry.category === "species").map(entry => ({ id: entry.id, label: entry.name, summary: entry.summary }))}
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
        <ChoiceGroups build={build} plan={plan} stepId="class-choices" onChange={onChange} />
      );

    case "equipment":
      return <EquipmentStep build={build} entries={entries} onChange={onChange} />;

    case "identity":
      return <IdentityStep build={build} onChange={onChange} />;

    case "review":
      return <ReviewStep build={build} entries={entries} plan={plan} presentation={presentation} />;

    default:
      return <div className="m2-step" />;
  }
}

/**
 * Free-text identity fields.
 *
 * Keystrokes stay in component state and are submitted to the draft service on
 * blur, so a per-character write never reaches the transaction boundary. None of
 * these fields feeds a calculation: the nickname is identity only.
 */
function IdentityStep({
  build,
  onChange,
}: {
  build: CharacterDraftBuild;
  onChange(patch: DraftPatch): void;
}) {
  const [buffer, setBuffer] = useState({
    name: build.name,
    nickname: build.nickname ?? "",
    pronouns: build.pronouns ?? "",
  });

  const commitField = (field: keyof typeof buffer) => {
    const value = buffer[field];
    const persisted = field === "name" ? build.name : (build[field] ?? "");
    if (value !== persisted) onChange({ [field]: value } as Partial<CharacterDraftBuild>);
  };

  const field = (id: keyof typeof buffer, label: string) => (
    <div className="m2-field">
      <label htmlFor={`identity-${id}`}>
        <span>{label}</span>
      </label>
      <input
        id={`identity-${id}`}
        value={buffer[id]}
        onChange={event => setBuffer(current => ({ ...current, [id]: event.target.value }))}
        onBlur={() => commitField(id)}
      />
    </div>
  );

  return (
    <div className="m2-step">
      <h3>Identity</h3>
      <p className="m2-muted">Nothing here changes a calculation. A nickname is identity only.</p>
      {field("name", "Name")}
      {field("nickname", "Nickname")}
      {field("pronouns", "Pronouns")}
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
        <fieldset key={choice.choiceId} className="m2-fieldset">
          <legend>
            {choice.label}
            <small className="m2-muted">
              {" "}
              choose {choice.min === choice.max ? choice.min : `${choice.min}–${choice.max}`}
            </small>
          </legend>
          {!choice.resolved ? (
            <p className="m2-inline-issue" role="status">
              <TriangleAlert aria-hidden="true" /> {choice.selected.length} of {choice.min} chosen
            </p>
          ) : null}
          <ul className="m2-options">
            {choice.options.map(option => {
              const isSelected = choice.selected.includes(option.id);
              const incompatible = choice.incompatibleOptions.find(item => item.optionId === option.id);
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    className={isSelected ? "m2-option m2-option-selected" : "m2-option"}
                    aria-pressed={isSelected}
                    onClick={() => toggle(choice.choiceId, option.id, choice.max)}
                  >
                    <span className="m2-option-mark" aria-hidden="true">
                      {isSelected ? <Check /> : "○"}
                    </span>
                    <span>
                      <b>{option.label}</b>
                      {incompatible ? <small>Requires {incompatible.requirement}</small> : null}
                    </span>
                    {incompatible ? <span className="m2-badge m2-badge-incomplete">Incompatible</span> : null}
                  </button>
                  {incompatible && isSelected ? (
                    <p className="m2-inline-issue" role="status">
                      <TriangleAlert aria-hidden="true" />
                      {option.label} does not meet {incompatible.requirement}. {incompatible.repair} Nothing has been
                      changed for you; switch to flexible mode to keep this choice with its issue recorded.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

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

  return (
    <div className="m2-step">
      <fieldset className="m2-fieldset">
        <legend>Method</legend>
        <ul className="m2-options">
          {(["standard-array", "manual"] as const).map(method => {
            const recommendation = recommendations.find(item => item.optionId === (method === "standard-array" ? "standard-array" : "manual"));
            return (
              <li key={method}>
                <button
                  type="button"
                  className={build.abilityMethod === method ? "m2-option m2-option-selected" : "m2-option"}
                  aria-pressed={build.abilityMethod === method}
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
              const name = ability[0].toUpperCase() + ability.slice(1);
              const total = build.abilityScores[ability];
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
                  {/* Total and the modifier it produces, so the consequence of
                      an assignment is visible without leaving the step. */}
                  <output className="m2-ability-final" aria-label={`${name} total`}>
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
          {pattern.length ? (
            <fieldset className="m2-fieldset">
              <legend>Origin increases</legend>
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
                          {ability[0].toUpperCase() + ability.slice(1)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </>
      ) : (
        <div className="m2-ability-grid">
          {ABILITIES.map(ability => (
            <label key={ability} className="m2-field">
              <span>{ability[0].toUpperCase() + ability.slice(1)}</span>
              <input
                type="number"
                min={1}
                max={30}
                value={build.abilityScores[ability] ?? ""}
                onChange={event =>
                  onChange(current => ({
                    abilityScores: {
                      ...current.abilityScores,
                      [ability]: event.target.value ? Number(event.target.value) : undefined,
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      )}
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

function EquipmentStep({
  build,
  entries,
  onChange,
}: {
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  onChange(patch: DraftPatch): void;
}) {
  const choices = requiredEquipmentChoices(build, entries);
  const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
  const bundles = classEntry?.equipmentBundles ?? [];

  if (!classEntry) return <p className="m2-muted">Choose a class first to see its starting equipment.</p>;

  return (
    <div className="m2-step">
      {bundles.map(bundle => (
        <div key={bundle.id}>
          <h3>{bundle.label}</h3>
          <ul className="m2-plain-list">
            {bundle.entries
              .filter(node => node.type === "item")
              .map(node => (
                <li key={node.type === "item" ? node.itemId : ""}>
                  {node.type === "item" ? entries.find(entry => entry.id === node.itemId)?.name ?? node.itemId : null}
                </li>
              ))}
          </ul>
        </div>
      ))}
      {choices.map(choice => {
        const selected = build.equipmentSelections[choice.choiceId] ?? [];
        return (
          <fieldset className="m2-fieldset" key={choice.choiceId}>
            <legend>{choice.label}</legend>
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
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        );
      })}
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

  return (
    <div className="m2-step">
      <h3>Review</h3>
      <dl className="m2-summary">
        <div>
          <dt>Name</dt>
          <dd>{build.name.trim() || "Unnamed character"}</dd>
        </div>
        <div>
          <dt>Class</dt>
          <dd>{name(build.classId)}</dd>
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
          <dd>
            {ABILITIES.map(ability => `${ability.slice(0, 3).toUpperCase()} ${build.abilityScores[ability] ?? "—"}`).join(" · ")}
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

      <h4>Choices by step</h4>
      <ul className="m2-plain-list">
        {plan.requiredChoices.map(choice => (
          <li key={choice.choiceId}>
            <b>{choice.label}</b>:{" "}
            {choice.selected.length
              ? choice.selected.map(id => choice.options.find(option => option.id === id)?.label ?? id).join(", ")
              : "Not chosen"}
          </li>
        ))}
      </ul>

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
