/**
 * Deterministic canonical serialization and hashing.
 *
 * `JSON.stringify(value, Object.keys(value).sort())` is not canonicalization.
 * The array form of the replacer is a property allow-list applied at every
 * depth, so nested keys that do not appear in the top-level key list are
 * dropped entirely. Applied to a character that silently erased ability scores,
 * class IDs, choice selections, equipment selections and manual values from the
 * fingerprint, which let a genuinely different character be reported as
 * "Already current".
 *
 * This module sorts object keys at every depth, preserves array order where the
 * domain treats order as meaningful, and normalizes order only where the domain
 * explicitly treats a list as a set.
 */

/** Lists whose order carries no meaning are sorted before hashing. */
export type OrderInsensitivePath = string;

export interface CanonicalOptions {
  /**
   * Dotted paths whose array values are sets. `*` matches one path segment, so
   * `choiceSelections.*` covers every choice ID.
   */
  readonly setPaths?: readonly OrderInsensitivePath[];
}

const matchesPath = (path: readonly string[], pattern: string): boolean => {
  const segments = pattern.split(".");
  if (segments.length !== path.length) return false;
  return segments.every((segment, index) => segment === "*" || segment === path[index]);
};

function canonicalizeValue(value: unknown, path: readonly string[], options: CanonicalOptions): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => canonicalizeValue(item, path, options));
    if (options.setPaths?.some(pattern => matchesPath(path, pattern))) {
      // Order is not meaningful here, so normalize it.
      return [...items].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return items;
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const child = source[key];
      // An absent property and an explicitly undefined one are the same state.
      if (child === undefined) continue;
      result[key] = canonicalizeValue(child, [...path, key], options);
    }
    return result;
  }
  return value;
}

/** Canonical JSON: keys sorted at every depth, declared set-like arrays sorted. */
export function canonicalJson(value: unknown, options: CanonicalOptions = {}): string {
  return JSON.stringify(canonicalizeValue(value, [], options)) ?? "null";
}

/** FNV-1a over the canonical form. Stable across runs and platforms. */
export function canonicalHash(value: unknown, options: CanonicalOptions = {}): string {
  const text = canonicalJson(value, options);
  let hash = 0x811c9dc5;
  for (const symbol of text) {
    hash ^= symbol.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Mix in the length so two different inputs that collide on the 32-bit hash
  // still differ unless they are also the same length.
  return `${(hash >>> 0).toString(16).padStart(8, "0")}${text.length.toString(16)}`;
}
