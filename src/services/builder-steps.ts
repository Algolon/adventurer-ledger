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
  | "background"
  | "abilities"
  | "class-choices"
  | "spells-resources"
  | "equipment"
  | "identity"
  | "review";

/**
 * The step list is exactly this, in this order.
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
 *
 * `origin` is the same storage identity it has always been, now answering only
 * "what am I?". It kept its ID for exactly the reason stated above: every draft
 * written before the split holds `lastStepId: "origin"` and must resume on
 * Species without a migration or a reset. Splitting the background out is
 * therefore a relabel of `origin` plus a genuinely new `background` ID directly
 * after it — a draft that has never seen `background` simply has not reached it
 * yet, which is indistinguishable from any other unvisited step.
 *
 * One step, one question. `origin` carried species, background and every
 * decision either of them owned, so a user picked from two dropdowns and then
 * met a run of follow-up controls with nothing on screen explaining which
 * selection had produced them.
 */
export const BUILDER_STEPS: readonly { id: BuilderStepId; label: string }[] = [
  { id: "start", label: "Basics" },
  { id: "class", label: "Class & level" },
  { id: "origin", label: "Species" },
  { id: "background", label: "Background" },
  { id: "abilities", label: "Abilities" },
  { id: "class-choices", label: "Class choices" },
  { id: "spells-resources", label: "Spells & resources" },
  { id: "equipment", label: "Equipment" },
  { id: "identity", label: "Identity" },
  { id: "review", label: "Review" },
];

export const stepPosition = (id: BuilderStepId): number => BUILDER_STEPS.findIndex(step => step.id === id);
