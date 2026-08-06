import type { ChoiceDefinition, Effect, ID } from "@/src/domain/model";

export type ChoiceSelections = Readonly<Record<ID, readonly ID[]>>;
export interface ChoiceResolutionIssue {
  code: "CHOICE_REQUIRED" | "CHOICE_COUNT_INVALID" | "CHOICE_OPTION_INVALID" | "CHOICE_REPEAT_INVALID";
  choiceId: ID;
  severity: "error";
  message: string;
}
export interface ChoiceResolution {
  effects: Effect[];
  entryIds: Set<ID>;
  resolvedChoiceIds: Set<ID>;
  unresolvedChoiceIds: Set<ID>;
  issues: ChoiceResolutionIssue[];
}

/** Resolves nested declarative choices without interpreting labels or private text. */
export function resolveChoices(definitions: readonly ChoiceDefinition[], selections: ChoiceSelections): ChoiceResolution {
  const result: ChoiceResolution = { effects: [], entryIds: new Set(), resolvedChoiceIds: new Set(), unresolvedChoiceIds: new Set(), issues: [] };
  const visit = (choice: ChoiceDefinition) => {
    const selected = [...(selections[choice.id] ?? [])];
    /**
     * An empty required choice is one fact, not two.
     *
     * Reporting it as both "requires a selection" and "has an invalid selection
     * count" produced two diagnostics for a single unresolved choice, which the
     * builder then rendered twice. The count check now covers only a selection
     * that exists and is the wrong size.
     */
    if (!selected.length && choice.min > 0) {
      result.unresolvedChoiceIds.add(choice.id);
      result.issues.push({ code: "CHOICE_REQUIRED", choiceId: choice.id, severity: "error", message: `Choice ${choice.id} requires a selection` });
    } else if (selected.length < choice.min || selected.length > choice.max) {
      result.unresolvedChoiceIds.add(choice.id);
      result.issues.push({ code: "CHOICE_COUNT_INVALID", choiceId: choice.id, severity: "error", message: `Choice ${choice.id} has an invalid selection count` });
    }
    const counts = new Map<string, number>();
    for (const optionId of selected) counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    const repeatLimit = choice.maxRepeats;
    const exceedsRepeatLimit = repeatLimit === undefined ? false : [...counts.values()].some(count => count > repeatLimit);
    if ((!choice.repeatable && [...counts.values()].some(count => count > 1)) || exceedsRepeatLimit) {
      result.unresolvedChoiceIds.add(choice.id);
      result.issues.push({ code: "CHOICE_REPEAT_INVALID", choiceId: choice.id, severity: "error", message: `Choice ${choice.id} contains unsupported repetitions` });
    }
    const options = new Map(choice.options.map(option => [option.id, option]));
    for (const optionId of selected) {
      const option = options.get(optionId);
      if (!option) {
        result.unresolvedChoiceIds.add(choice.id);
        result.issues.push({ code: "CHOICE_OPTION_INVALID", choiceId: choice.id, severity: "error", message: `Choice ${choice.id} references an unavailable option` });
        continue;
      }
      if (option.entryId) result.entryIds.add(option.entryId);
      result.effects.push(...(option.effects ?? []));
      for (const child of option.childChoices ?? []) visit(child);
    }
    for (const child of choice.childChoices ?? []) visit(child);
    if (!result.unresolvedChoiceIds.has(choice.id)) result.resolvedChoiceIds.add(choice.id);
  };
  for (const definition of definitions) visit(definition);
  return result;
}
