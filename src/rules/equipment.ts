import type { EquipmentBundleDefinition, EquipmentBundleNode, ID } from "@/src/domain/model";

export type EquipmentChoiceSelections = Readonly<Record<ID, readonly ID[]>>;
export interface ResolvedEquipmentItem { itemId: ID; quantity: number; status: "granted" | "carried" | "equipped"; sourceBundleId: ID }
export interface EquipmentResolutionIssue {
  code: "EQUIPMENT_BUNDLE_MISSING" | "EQUIPMENT_CHOICE_REQUIRED" | "EQUIPMENT_CHOICE_INVALID" | "EQUIPMENT_ITEM_MISSING";
  severity: "error";
  bundleId: ID;
  nodeId?: ID;
  message: string;
}
export interface EquipmentResolution { items: ResolvedEquipmentItem[]; issues: EquipmentResolutionIssue[]; unresolvedChoiceIds: Set<ID> }

export function resolveEquipmentBundles(
  requestedBundleIds: readonly ID[],
  definitions: readonly EquipmentBundleDefinition[],
  selections: EquipmentChoiceSelections,
  availableItemIds: ReadonlySet<ID>,
): EquipmentResolution {
  const byId = new Map(definitions.map(bundle => [bundle.id, bundle]));
  const result: EquipmentResolution = { items: [], issues: [], unresolvedChoiceIds: new Set() };
  const visit = (node: EquipmentBundleNode, bundleId: ID) => {
    if (node.type === "item") {
      const selectedItem = availableItemIds.has(node.itemId)
        ? node.itemId
        : node.alternativeItemIds?.find(itemId => availableItemIds.has(itemId));
      if (!selectedItem) {
        result.issues.push({ code: "EQUIPMENT_ITEM_MISSING", severity: "error", bundleId, message: `Equipment bundle ${bundleId} has an unresolved item reference` });
        return;
      }
      result.items.push({ itemId: selectedItem, quantity: node.quantity, status: node.status, sourceBundleId: bundleId });
      return;
    }
    if (node.type === "bundle") {
      for (const child of node.entries) visit(child, bundleId);
      return;
    }
    const selected = [...(selections[node.id] ?? [])];
    const options = new Map(node.options.map(option => [option.id, option]));
    if (selected.length < node.min || selected.length > node.max) {
      result.unresolvedChoiceIds.add(node.id);
      result.issues.push({ code: selected.length ? "EQUIPMENT_CHOICE_INVALID" : "EQUIPMENT_CHOICE_REQUIRED", severity: "error", bundleId, nodeId: node.id, message: `Equipment choice ${node.id} is unresolved` });
      return;
    }
    for (const optionId of selected) {
      const option = options.get(optionId);
      if (!option) {
        result.unresolvedChoiceIds.add(node.id);
        result.issues.push({ code: "EQUIPMENT_CHOICE_INVALID", severity: "error", bundleId, nodeId: node.id, message: `Equipment choice ${node.id} references an unavailable option` });
        continue;
      }
      for (const child of option.entries) visit(child, bundleId);
    }
  };
  for (const bundleId of requestedBundleIds) {
    const bundle = byId.get(bundleId);
    if (!bundle) {
      result.issues.push({ code: "EQUIPMENT_BUNDLE_MISSING", severity: "error", bundleId, message: `Equipment bundle ${bundleId} is unavailable` });
      continue;
    }
    for (const node of bundle.entries) visit(node, bundleId);
  }
  return result;
}
