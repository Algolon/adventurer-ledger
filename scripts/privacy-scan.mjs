import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
const repository = new URL("..", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = /(^|\/)(private-content|private-backups|local-references|book-imports|imports|exports)(\/|$)|\.(?:pdf|private\.json|private\.enc|licensed\.json|local\.db|sqlite3?)$/i;
const sourceNames = /Monster Manual \(2024\)|Player_s Handbook \(2024\)|Dungeon Master_s Guide \(2024\)|Tasha's Cauldron of Everything|Xanathar's Guide to Everything/i;
const personalPath = /\/(?:Users|home)\/[^/\s"']+|[A-Z]:\\Users\\[^\\\s"']+/;
const secretValue = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,})/;
const violations = [];
for (const file of files) {
  if (forbidden.test(file) || sourceNames.test(file)) violations.push(file);
  else if (statSync(new URL(file, new URL("./", new URL(repository, "file:")))).size > 2 * 1024 * 1024) violations.push(`${file} (unexpectedly large)`);
  else if ((/^(?:app|src|schemas|scripts)\//.test(file) && file !== "scripts/privacy-scan.mjs") || file === "package.json") {
    const content = readFileSync(new URL(file, new URL("./", new URL(repository, "file:"))), "utf8");
    if (personalPath.test(content)) violations.push(`${file} (absolute personal path)`);
    if (secretValue.test(content)) violations.push(`${file} (secret-like value)`);
  }
}
if (violations.length) throw new Error(`Privacy boundary violation in ${violations.length} repository file(s): ${violations.join(", ")}`);
process.stdout.write(`Privacy scan passed for ${files.length} repository files.\n`);
