import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
const repository = new URL("..", import.meta.url).pathname;
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repository, encoding: "utf8" }).split("\0").filter(Boolean);
const forbidden = /(^|\/)(private-content|private-backups|local-references|book-imports|imports|exports)(\/|$)|\.(?:pdf|private\.json|private\.enc|licensed\.json|local\.db|sqlite3?)$/i;
const sourceNames = /Monster Manual \(2024\)|Player_s Handbook \(2024\)|Dungeon Master_s Guide \(2024\)|Tasha's Cauldron of Everything|Xanathar's Guide to Everything/i;
const violations = [];
for (const file of files) {
  if (forbidden.test(file) || sourceNames.test(file)) violations.push(file);
  else if (statSync(new URL(file, new URL("./", new URL(repository, "file:")))).size > 2 * 1024 * 1024) violations.push(`${file} (unexpectedly large)`);
}
if (violations.length) throw new Error(`Privacy boundary violation in ${violations.length} repository file(s): ${violations.join(", ")}`);
process.stdout.write(`Privacy scan passed for ${files.length} repository files.\n`);
