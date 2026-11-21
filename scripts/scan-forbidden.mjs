import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const excluded = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".git",
  "playwright-report",
  "test-results",
]);
const banned = [
  "Site" + "Doc",
  "AT" + "LAS",
  "SKY" + "LINE",
  "L" + "ENS",
  "Ops" + "Center",
  "One" + "Web",
  "Eutel" + "sat",
  "B" + "eam",
  "git." + "via" + "sat.com",
  "@" + "via" + "sat.com",
  "cé" + "dula",
];
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excluded.has(entry.name)) continue;
    if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else {
      const content = await readFile(file, "utf8").catch(() => "");
      const contentWithoutActionShas = content.replace(
        /uses:\s*[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}\b/gi,
        "",
      );
      for (const term of banned)
        if (content.toLowerCase().includes(term.toLowerCase()))
          violations.push(
            `${path.relative(root, file)} contains a restricted term`,
          );
      if (
        /(?<![\d.])\d{10,15}(?![\d.])/.test(contentWithoutActionShas) ||
        /(?:\+?\d{1,3}[ .-])?(?:\(\d{2,4}\)|\d{2,4})[ .-]\d{2,4}[ .-]\d{3,4}/.test(
          contentWithoutActionShas,
        )
      )
        violations.push(
          `${path.relative(root, file)} may contain a phone number`,
        );
    }
  }
}

await visit(root);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log("Forbidden-content scan passed.");
