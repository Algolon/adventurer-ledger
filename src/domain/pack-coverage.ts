import type { PackCoverage } from "@/src/domain/model";

export const PACK_COVERAGE_PRESENTATION = {
  pilot: { label: "Pilot — incomplete source", completeSource: false, requiresWarning: true },
  partial: { label: "Partial — incomplete source", completeSource: false, requiresWarning: true },
  complete: { label: "Complete source", completeSource: true, requiresWarning: false },
} as const satisfies Record<PackCoverage, { label: string; completeSource: boolean; requiresWarning: boolean }>;

export const packCoveragePresentation = (coverage: PackCoverage) => PACK_COVERAGE_PRESENTATION[coverage];
