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

/**
 * The step list is exactly this, in this order (AC-03).
 *
 * The IDs are storage identities: a saved draft's `lastStepId` holds one, so
 * they stay fixed even when the label changes. That is why moving the starting
 * level from the first step to the second is a relabel plus a change of issue
 * ownership, and not a data migration — every draft already written resumes at
 * the same step it was left on.
 *
 * The level lives with the class because only the class can validate it. A
 * level presented on the first step could not be judged until a class existed
 * two steps later, so the first step reported a problem the user could only
 * repair somewhere else.
 */
export const BUILDER_STEPS: readonly { id: BuilderStepId; label: string }[] = [
  { id: "start", label: "Basics" },
  { id: "class", label: "Class & level" },
  { id: "origin", label: "Origin" },
  { id: "abilities", label: "Abilities" },
  { id: "class-choices", label: "Class choices" },
  { id: "spells-resources", label: "Spells & resources" },
  { id: "equipment", label: "Equipment" },
  { id: "identity", label: "Identity" },
  { id: "review", label: "Review" },
];

export const stepPosition = (id: BuilderStepId): number => BUILDER_STEPS.findIndex(step => step.id === id);
