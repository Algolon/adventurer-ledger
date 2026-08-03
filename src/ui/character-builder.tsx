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
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleHelp, ListChecks, TriangleAlert } from "lucide-react";
import { BUILDER_STEPS, recommendationsFor, type BuilderStepId, type PlannedStep } from "@/src/services/build-planner";
import { ABILITIES, type CharacterDraftBuild } from "@/src/domain/character-record";
import type { Ability, ContentEntry } from "@/src/domain/model";
import { STANDARD_ARRAY, SYNTHETIC_EQUIPMENT_CHOICE, SYNTHETIC_RULESET_ID } from "@/src/content/runefolio-synthetic";
import { useAsync, useServices } from "@/src/ui/services-context";
import type { DraftSnapshot } from "@/src/services/character-services";
import { db } from "@/src/storage/db";

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
  EQUIPMENT_CHOICE_REQUIRED: "Choose your travelling gear",
  NAME_NOT_SET: "Name the character (optional)",
  MANUAL_MINIMUM_NOT_MET: "A manual sheet needs abilities, hit points, armour class, initiative and one action",
};

const labelFor = (code: string) => ISSUE_LABELS[code] ?? code;

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

  const entriesState = useAsync(() => db.contentEntries.toArray(), []);
  const entries = useMemo<ContentEntry[]>(() => (entriesState.status === "ready" ? entriesState.value : []), [entriesState]);

  useEffect(() => {
    let cancelled = false;
    drafts.get(draftId).then(loaded => {
      if (cancelled || !loaded) return;
      setSnapshot(loaded);
      // Resume at the last unresolved step rather than always at the start.
      setStepId(loaded.draft.lastStepId as BuilderStepId);
    });
    return () => {
      cancelled = true;
    };
  }, [draftId, drafts]);

  const save = useCallback(
    async (patch: Partial<CharacterDraftBuild>, nextStep?: BuilderStepId) => {
      if (!snapshot) return;
      const outcome = await drafts.update({
        draftId,
        expectedRevision: snapshot.revision,
        patch,
        ...(nextStep ? { lastStepId: nextStep } : {}),
      });
      if (outcome.status === "ok") {
        setSnapshot(outcome.result);
        setSaveError(null);
        return;
      }
      // The edit stays on screen; prior persisted state is intact.
      setSaveError(
        outcome.status === "stale"
          ? "This build changed in another tab. Reopen it to continue from the saved version."
          : "The last change could not be saved on this device.",
      );
    },
    [draftId, drafts, snapshot],
  );

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
    setStepId(id);
    setShowSteps(false);
    void save({}, id);
  };

  const advance = () => {
    if (current.id === "review") return;
    const next = steps[index + 1];
    if (draft.presentation === "guided" && current.status === "incomplete") {
      // Guided mode keeps the user at the unresolved dependency.
      setCommitErrors(current.issues.filter(i => i.severity === "error").map(i => ({ code: i.code, label: labelFor(i.code) })));
      return;
    }
    setCommitErrors([]);
    if (next) goTo(next.id);
  };

  const finish = async () => {
    const fingerprint = await query.contentFingerprint(draft.rulesetProfileId);
    const characterId = draft.editingCharacterId ?? `character:${draftId.replace(/^draft:/, "")}`;
    const existing = draft.editingCharacterId ? await query.sheet(draft.editingCharacterId) : undefined;
    const outcome = await commit.commit({
      operationId: `commit:${draftId}:${snapshot.revision}`,
      draftId,
      expectedDraftRevision: snapshot.revision,
      characterId,
      ...(existing ? { expectedCharacterRevision: existing.characterRevision } : {}),
      intent: draft.editingCharacterId ? "edit" : build.classId ? "create" : "manual-sheet",
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
    const outcome = await drafts.changePresentation(
      draftId,
      snapshot.revision,
      draft.presentation === "guided" ? "flexible" : "guided",
    );
    if (outcome.status === "ok") setSnapshot(outcome.result);
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
        <div className="m2-error-summary" role="alert" tabIndex={-1}>
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
                    <small>{step.status === "not-needed" ? step.note : step.status === "complete" ? "Complete" : "Incomplete"}</small>
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
          presentation={draft.presentation}
          plan={snapshot.plan}
          onChange={save}
        />
      </div>

      <footer className="m2-task-footer">
        <button type="button" className="m2-button" onClick={() => (index > 0 ? goTo(steps[index - 1].id) : onClose())}>
          <ArrowLeft aria-hidden="true" />
          Back
        </button>
        <button type="button" className="m2-button" onClick={() => setShowSteps(value => !value)} aria-expanded={showSteps}>
          <ListChecks aria-hidden="true" />
          Steps
        </button>
        <span className="m2-issue-count" aria-live="polite">
          {plan.issueCount} issue{plan.issueCount === 1 ? "" : "s"}
        </span>
        {current.id === "review" ? (
          <button type="button" className="m2-button m2-button-primary" onClick={() => void finish()}>
            Finish and open sheet
            <ArrowRight aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="m2-button m2-button-primary" onClick={advance}>
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
  presentation,
  plan,
  onChange,
}: {
  step: PlannedStep;
  build: CharacterDraftBuild;
  entries: readonly ContentEntry[];
  presentation: "guided" | "flexible";
  plan: DraftSnapshot["plan"];
  onChange(patch: Partial<CharacterDraftBuild>): void;
}) {
  const recommendations = presentation === "guided" ? recommendationsFor(step.id, build, entries) : [];

  if (step.status === "not-needed")
    return (
      <div className="m2-step">
        <p className="m2-not-needed">{step.note}</p>
        <p className="m2-muted">
          Resource tracking still appears on the sheet. Nothing on this step is required for this build.
        </p>
      </div>
    );

  switch (step.id) {
    case "start":
      return (
        <div className="m2-step">
          <h3>Ruleset</h3>
          <p className="m2-muted">
            This build uses <b>{SYNTHETIC_RULESET_ID.replace("ruleset:", "")}</b>. Everything is stored on this device only.
          </p>
          <label className="m2-field">
            <span>Starting level</span>
            <input type="number" min={1} max={2} value={build.level} readOnly aria-describedby="level-note" />
          </label>
          <p id="level-note" className="m2-muted">
            This slice creates a level 1 character and advances it to level 2.
          </p>
        </div>
      );

    case "class":
      return (
        <OptionStep
          legend="Class"
          options={entries.filter(entry => entry.category === "class").map(entry => ({ id: entry.id, label: entry.name, summary: entry.summary }))}
          selected={build.classId ? [build.classId] : []}
          recommendations={recommendations}
          onSelect={id => onChange({ classId: id })}
        />
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
      return <ChoiceGroups build={build} plan={plan} stepId="class-choices" onChange={onChange} />;

    case "equipment":
      return <EquipmentStep build={build} entries={entries} onChange={onChange} />;

    case "identity":
      return (
        <div className="m2-step">
          <h3>Identity</h3>
          <p className="m2-muted">Nothing here changes a calculation. A nickname is identity only.</p>
          <label className="m2-field">
            <span>Name</span>
            <input value={build.name} onChange={event => onChange({ name: event.target.value })} />
          </label>
          <label className="m2-field">
            <span>Nickname</span>
            <input value={build.nickname ?? ""} onChange={event => onChange({ nickname: event.target.value })} />
          </label>
          <label className="m2-field">
            <span>Pronouns</span>
            <input value={build.pronouns ?? ""} onChange={event => onChange({ pronouns: event.target.value })} />
          </label>
        </div>
      );

    case "review":
      return <ReviewStep build={build} entries={entries} plan={plan} presentation={presentation} />;

    default:
      return <div className="m2-step" />;
  }
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
  onChange(patch: Partial<CharacterDraftBuild>): void;
}) {
  const groups = plan.requiredChoices.filter(choice => choice.stepId === stepId);
  if (!groups.length) return <p className="m2-muted">No choices are required here yet.</p>;

  const toggle = (choiceId: string, optionId: string, max: number) => {
    const existing = build.choiceSelections[choiceId] ?? [];
    const next = existing.includes(optionId)
      ? existing.filter(item => item !== optionId)
      : max === 1
        ? [optionId]
        : [...existing, optionId].slice(-max);
    onChange({ choiceSelections: { ...build.choiceSelections, [choiceId]: next } });
  };

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
                    </span>
                  </button>
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
  onChange(patch: Partial<CharacterDraftBuild>): void;
}) {
  const background = build.backgroundId ? entries.find(entry => entry.id === build.backgroundId) : undefined;
  const choices = (background?.mechanics as { abilityScoreChoices?: { abilities?: string[]; increasePattern?: number[] } } | undefined)
    ?.abilityScoreChoices;
  const allowed = (choices?.abilities ?? []) as Ability[];
  const pattern = choices?.increasePattern ?? [];

  const commit = (base: Partial<Record<Ability, number>>, increases: Partial<Record<Ability, number>>) => {
    const final: Partial<Record<Ability, number>> = {};
    for (const ability of ABILITIES) {
      const baseScore = base[ability];
      if (typeof baseScore === "number") final[ability] = baseScore + (increases[ability] ?? 0);
    }
    onChange({ abilityBaseScores: base, abilityIncreases: increases, abilityScores: final });
  };

  const assign = (ability: Ability, value: number | undefined) => {
    const base = { ...build.abilityBaseScores };
    if (value === undefined) delete base[ability];
    else base[ability] = value;
    commit(base, build.abilityIncreases);
  };

  const setIncrease = (slot: number, ability: Ability | undefined) => {
    const increases: Partial<Record<Ability, number>> = {};
    const current = Object.entries(build.abilityIncreases) as [Ability, number][];
    const bySlot = pattern.map((amount, index) => current.find(([, value]) => value === amount && index === current.findIndex(([, v]) => v === amount))?.[0]);
    bySlot[slot] = ability;
    bySlot.forEach((target, index) => {
      if (target) increases[target] = pattern[index];
    });
    commit(build.abilityBaseScores, increases);
  };

  const used = ABILITIES.map(ability => build.abilityBaseScores[ability]).filter((value): value is number => typeof value === "number");
  const remaining = [...STANDARD_ARRAY];
  for (const value of used) {
    const at = remaining.indexOf(value);
    if (at >= 0) remaining.splice(at, 1);
  }

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
          <p className="m2-muted">
            Remaining values: {remaining.length ? remaining.join(", ") : "all assigned"}
          </p>
          <div className="m2-ability-grid">
            {ABILITIES.map(ability => (
              <label key={ability} className="m2-field">
                <span>{ability[0].toUpperCase() + ability.slice(1)}</span>
                <select
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
                <output className="m2-ability-final">
                  {typeof build.abilityScores[ability] === "number" ? build.abilityScores[ability] : "—"}
                </output>
              </label>
            ))}
          </div>
          {pattern.length ? (
            <fieldset className="m2-fieldset">
              <legend>Origin increases</legend>
              <div className="m2-ability-grid">
                {pattern.map((amount, slot) => (
                  <label key={slot} className="m2-field">
                    <span>+{amount} to</span>
                    <select
                      value={(Object.entries(build.abilityIncreases).find(([, value]) => value === amount)?.[0] as Ability) ?? ""}
                      onChange={event => setIncrease(slot, event.target.value ? (event.target.value as Ability) : undefined)}
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
                  onChange({
                    abilityScores: {
                      ...build.abilityScores,
                      [ability]: event.target.value ? Number(event.target.value) : undefined,
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
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
  onChange(patch: Partial<CharacterDraftBuild>): void;
}) {
  const classEntry = build.classId ? entries.find(entry => entry.id === build.classId) : undefined;
  const bundle = classEntry?.equipmentBundles?.[0];
  const choiceNode = bundle?.entries.find(node => node.type === "choice");
  const selected = build.equipmentSelections[SYNTHETIC_EQUIPMENT_CHOICE] ?? [];

  if (!bundle) return <p className="m2-muted">Choose a class first to see its starting equipment.</p>;

  return (
    <div className="m2-step">
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
      {choiceNode && choiceNode.type === "choice" ? (
        <fieldset className="m2-fieldset">
          <legend>{choiceNode.label}</legend>
          <ul className="m2-options">
            {choiceNode.options.map(option => (
              <li key={option.id}>
                <button
                  type="button"
                  className={selected.includes(option.id) ? "m2-option m2-option-selected" : "m2-option"}
                  aria-pressed={selected.includes(option.id)}
                  onClick={() =>
                    onChange({ equipmentSelections: { ...build.equipmentSelections, [SYNTHETIC_EQUIPMENT_CHOICE]: [option.id] } })
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
      ) : null}
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
          <dt>Abilities</dt>
          <dd>
            {ABILITIES.map(ability => `${ability.slice(0, 3).toUpperCase()} ${build.abilityScores[ability] ?? "—"}`).join(" · ")}
          </dd>
        </div>
      </dl>

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
