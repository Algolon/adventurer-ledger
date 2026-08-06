/**
 * A review server the reviewer owns.
 *
 * `npm run review:local` builds the real Pages artifact and serves it on one
 * fixed localhost origin until Ctrl+C. It exists because a review server that
 * only lives as long as some other process does is not reviewable: the tab dies
 * mid-journey, and because IndexedDB is scoped to an origin, coming back on a
 * different port silently presents an empty device rather than the work in
 * progress.
 *
 * Two properties matter more than anything else here:
 *
 * 1. **One stable origin.** The port is fixed (4180 by default), so a restart
 *    returns to the same origin and every character, draft and imported ruleset
 *    is still there. `localhost` and `127.0.0.1` are *different* origins to the
 *    browser, so exactly one spelling is printed and it is the one to use.
 * 2. **The real export.** It builds with `NEXT_PUBLIC_BASE_PATH=/adventurer-ledger`
 *    and serves from that base path, so what is reviewed is the artifact that
 *    ships, not a `next dev` approximation that resolves paths differently.
 *
 * Development only, Node standard library only, localhost only. It reads no
 * private content, contacts no external service, and is not a production server.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./static-server.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE_PATH = "/adventurer-ledger";
const HOST = "127.0.0.1";
const DEFAULT_PORT = 4180;

const fail = (message, hint) => {
  process.stderr.write(`\nreview:local — ${message}\n`);
  if (hint) process.stderr.write(`${hint}\n`);
  process.exit(1);
};

/** The port to bind, from `REVIEW_PORT` or the documented default. */
function resolvePort() {
  const raw = process.env.REVIEW_PORT;
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    fail(
      `REVIEW_PORT is "${raw}", which is not a port number.`,
      "Set it to an integer between 1 and 65535, or unset it to use the default.",
    );
  return port;
}

/** Runs a command, streaming its output, and resolves with its exit code. */
const run = (command, args, env) =>
  new Promise(resolve => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    child.on("error", () =>
      fail(
        `Could not start \`${command}\`.`,
        "Check that Node and npm are installed and on PATH.",
      ),
    );
    child.on("close", code => resolve(code ?? 1));
  });

/** The commit being reviewed, or a clear stand-in when git cannot say. */
function currentCommit() {
  return new Promise(resolve => {
    const child = spawn("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
    let output = "";
    child.stdout?.on("data", chunk => {
      output += chunk;
    });
    child.on("error", () => resolve(undefined));
    child.on("close", code => resolve(code === 0 ? output.trim() : undefined));
  });
}

/** Whether anything already holds the port, so the reason can be specific. */
const portIsFree = port =>
  new Promise(resolve => {
    const probe = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port, HOST);
  });

async function main() {
  const port = resolvePort();
  const origin = `http://${HOST}:${port}`;
  const url = `${origin}${BASE_PATH}/`;
  const outDir = path.join(projectRoot, "out");
  const skipBuild = process.argv.includes("--no-build") || process.env.REVIEW_SKIP_BUILD === "1";

  /*
   * The port is checked before the build, not after. A build takes minutes and
   * failing at the end of it — for a reason that was knowable at the start — is
   * the difference between a clear message and a wasted wait.
   */
  if (!(await portIsFree(port)))
    fail(
      `Port ${port} on ${HOST} is already in use.`,
      [
        "Another review server may already be running — if so, open the URL it printed.",
        `Otherwise stop whatever holds the port, or choose another: REVIEW_PORT=4181 npm run review:local`,
        "Note that changing the port changes the browser origin, so the characters and",
        "imported rulesets stored under the old one will not be visible under the new one.",
      ].join("\n"),
    );

  if (skipBuild) process.stdout.write("review:local — skipping the build (--no-build).\n");
  else {
    process.stdout.write("review:local — building the production Pages artifact…\n\n");
    const code = await run("npm", ["run", "build:pages"]);
    if (code !== 0)
      fail(
        `The build failed (exit code ${code}).`,
        "The build output above says why. Fix it and run the command again.",
      );
  }

  if (!existsSync(path.join(outDir, "index.html")))
    fail(
      "The build produced no `out/index.html`, so there is nothing to serve.",
      skipBuild
        ? "Run without --no-build, or run `npm run build:pages` first."
        : "The build reported success but wrote no export. Try `rm -rf .next out` and run again.",
    );

  const commit = await currentCommit();
  const server = createStaticServer({ root: outDir, basePath: BASE_PATH });

  server.on("error", error =>
    fail(
      `The server stopped: ${error.code ?? error.message}.`,
      "Run the command again once whatever caused it is resolved.",
    ),
  );

  server.listen(port, HOST, () => {
    process.stdout.write(
      [
        "",
        "  Adventurer Ledger — local review server",
        "  ───────────────────────────────────────",
        `  Review URL   ${url}`,
        `  Commit       ${commit ?? "unknown (not a git checkout, or git is unavailable)"}`,
        `  Serving      out/ at base path ${BASE_PATH}`,
        "",
        `  Open the URL exactly as printed. The browser treats http://localhost:${port}`,
        `  and ${origin} as different origins, and your characters, drafts and`,
        "  imported rulesets are stored per origin — the other spelling looks like a new device.",
        "",
        "  This origin is stable across restarts, so stopping and starting this command",
        "  keeps everything you have already created.",
        "",
        "  To review on a clean device without touching any other browser data, open the",
        "  URL in a private/incognito window, or run:",
        "      REVIEW_PORT=4181 npm run review:local",
        "  which is a different origin and therefore starts empty.",
        "",
        "  Press Ctrl+C to stop.",
        "",
      ].join("\n"),
    );
  });

  /*
   * Ctrl+C closes the listener and lets the process end on its own. Calling
   * process.exit here would drop in-flight responses, which shows up as a
   * half-loaded page at exactly the moment the reviewer is trying to stop.
   */
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write("\nreview:local — stopping.\n");
    server.close();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

await main();
