#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const pdf = args.get("--pdf"), manifestPath = args.get("--manifest"), output = args.get("--output");
if (!pdf || !manifestPath || !output || !isAbsolute(pdf) || !isAbsolute(manifestPath) || !isAbsolute(output)) throw new Error("Explicit absolute --pdf, --manifest and --output paths are required");
if (!output.endsWith(".private.json")) throw new Error("Private ingestion output must use the .private.json suffix");
const repository = realpathSync(resolve(import.meta.dirname, ".."));
if (resolve(output).startsWith(`${repository}/`)) throw new Error("Private ingestion output must remain outside the repository");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest || manifest.schemaVersion !== 2 || !Array.isArray(manifest.entries)) throw new Error("Private manifest must be a schema v2 content pack");
const extracted = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const pages = extracted.split("\f");
manifest.entries = manifest.entries.map((entry, index) => {
  const requested = entry.ingestion?.extractPdfPages;
  if (!Array.isArray(requested) || requested.length === 0 || !requested.every(page => Number.isInteger(page) && page > 0 && page <= pages.length)) throw new Error(`Entry at index ${index} has invalid PDF page locators`);
  const fullText = requested.map(page => pages[page - 1]?.trim()).filter(Boolean).join("\n\n");
  if (!fullText) throw new Error(`Entry at index ${index} extracted no text`);
  const { ingestion: _privateInstruction, ...record } = entry;
  return { ...record, fullText };
});
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`Private pack written with ${manifest.entries.length} entries; content was not printed.\n`);
