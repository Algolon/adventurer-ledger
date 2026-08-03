import { spawnSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  fixtureRoot = path.join(projectRoot, ".playwright-update");

async function build(label) {
  const result = spawnSync("npm", ["run", "build:pages"], {
    cwd: projectRoot,
    env: { ...process.env, NEXT_PUBLIC_BUILD_LABEL: label },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`Could not build ${label} update fixture`);
  await cp(path.join(projectRoot, "out"), path.join(fixtureRoot, label), {
    recursive: true,
  });
}

await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(fixtureRoot, { recursive: true });
await build("old");
await build("new");
