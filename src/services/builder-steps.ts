/**
 * The builder's canonical step vocabulary.
 *
 * It lives in its own module because both the generic choice planner and the
 * build planner need it: the choice planner assigns every discovered choice to a
 * step, and the build planner assembles the step sequence. Importing one from
 * the other would make the dependency circular.
 */
export type BuilderStepId =
  | "start"
  | "class"
  | "origin"
  | "abilities"
  | "class-choices"
  | "spells-resources"
  | "equipment"
  | "identity"
  | "review";

/** The step list is exactly this, in this order (AC-03). */
export const BUILDER_STEPS: readonly { id: BuilderStepId; label: string }[] = [
  { id: "start", label: "Name, ruleset and level" },
  { id: "class", label: "Class" },
  { id: "origin", label: "Origin" },
  { id: "abilities", label: "Abilities" },
  { id: "class-choices", label: "Class choices" },
  { id: "spells-resources", label: "Spells & resources" },
  { id: "equipment", label: "Equipment" },
  { id: "identity", label: "Identity" },
  { id: "review", label: "Review" },
];

export const stepPosition = (id: BuilderStepId): number => BUILDER_STEPS.findIndex(step => step.id === id);
