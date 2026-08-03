const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const BASE_PATH =
  configuredBasePath === "/"
    ? ""
    : configuredBasePath.replace(/\/+$/, "");

export function withBasePath(pathname: `/${string}`): string {
  return `${BASE_PATH}${pathname}`;
}

export const APP_ROOT = `${BASE_PATH}/`;

const cacheNamespace = BASE_PATH.slice(1).replace(/[^a-z0-9]+/gi, "-") || "root";
export const SHELL_CACHE_PREFIX = `adventurer-ledger-shell-${cacheNamespace}-`;
