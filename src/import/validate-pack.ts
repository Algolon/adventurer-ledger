import { contentPackSchema, type ContentPackDocument } from "@/src/domain/content-pack";
import { migrateContentPackToV2 } from "@/src/migrations/content-pack-v2";

export interface ValidationResult { success: boolean; data?: ContentPackDocument; errors: Array<{ path: string; message: string }>; warnings: string[] }
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const unsafeMarkup = /<\s*(?:script|iframe|object|embed|style|link|meta)\b|\bon[a-z]+\s*=|javascript\s*:/i;
function inspect(value: unknown, depth = 0): void {
  if (depth > 80) throw new Error("Import nesting is too deep");
  if (typeof value === "string" && unsafeMarkup.test(value)) throw new Error("Import contains unsafe markup");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error("Import contains a forbidden object key");
    inspect(child, depth + 1);
  }
}
const sanitizedMessage = (code: string) => ({
  invalid_type: "Value has the wrong type",
  invalid_literal: "Value is not the required schema literal",
  invalid_enum_value: "Value is not an allowed enum member",
  unrecognized_keys: "Object contains unsupported fields",
  too_big: "Value exceeds the allowed size or range",
  too_small: "Value is below the allowed size or range",
  invalid_string: "String does not match the required format",
  custom: "Value does not satisfy the schema constraint",
}[code] ?? "Value is invalid");

export function validateContentPackJson(json: string, maxBytes = 25 * 1024 * 1024): ValidationResult {
  if (new TextEncoder().encode(json).byteLength > maxBytes) return { success: false, errors: [{ path: "", message: "File exceeds the import size limit" }], warnings: [] };
  try {
    const parsed: unknown = JSON.parse(json);
    inspect(parsed);
    const migration = migrateContentPackToV2(parsed);
    const result = contentPackSchema.safeParse(migration.value);
    if (!result.success) return { success: false, errors: result.error.issues.map(issue => ({ path: issue.path.join("."), message: sanitizedMessage(issue.code) })), warnings: [] };
    return { success: true, data: result.data, errors: [], warnings: migration.migratedFrom === undefined ? [] : [`Schema version ${migration.migratedFrom} migrated to version 2`] };
  } catch (error) {
    const message = error instanceof SyntaxError ? "File is not valid JSON" : error instanceof Error ? error.message : "Import could not be parsed";
    return { success: false, errors: [{ path: "", message }], warnings: [] };
  }
}
