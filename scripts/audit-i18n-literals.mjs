import fs from "node:fs/promises";
import path from "node:path";

const cwd = process.cwd();
const srcDir = path.join(cwd, "src");
const reportDir = path.join(cwd, "artifacts", "i18n-audit");

const strict = process.argv.includes("--strict");
const extensions = new Set([".tsx"]);
const ignoredFiles = new Set(["src/lib/i18n.tsx"]);
const ignoredPatterns = [
  /^\s*import\s/,
  /^\s*export\s+type\s/,
  /^\s*interface\s/,
  /^\s*type\s/,
  /^\s*const\s+\w+\s*:\s*Record/,
  /\bas\s+Record</,
];

function toRepoPath(filePath) {
  return path.relative(cwd, filePath).replace(/\\/g, "/");
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectIssues(repoPath, content) {
  if (ignoredFiles.has(repoPath)) return [];
  const issues = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (ignoredPatterns.some((pattern) => pattern.test(line))) return;
    const lineNo = index + 1;
    const hasJsxText = />[^<>{}]*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z][^<>{}]*</u.test(line);
    const hasLiteralAttr = /(aria-label|title|placeholder|text)=["'][^"']*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}][^"']*["']/u.test(line);
    const hasSetError = /\bset(Error|Message)\(["'][^"']*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line);
    const hasPrompt = /\b(window\.)?prompt\(["'][^"']*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(line);
    if (hasJsxText || hasLiteralAttr || hasSetError || hasPrompt) {
      issues.push({
        file: repoPath,
        line: lineNo,
        reason: hasJsxText ? "jsx-text" : hasLiteralAttr ? "literal-attribute" : hasSetError ? "state-message" : "prompt",
        snippet: line.trim().slice(0, 220),
      });
    }
  });
  return issues;
}

const files = await listFiles(srcDir);
const issues = [];
for (const file of files) {
  const repoPath = toRepoPath(file);
  const content = await fs.readFile(file, "utf8");
  issues.push(...collectIssues(repoPath, content));
}

const grouped = issues.reduce((acc, issue) => {
  acc[issue.file] = (acc[issue.file] ?? 0) + 1;
  return acc;
}, {});
const topFiles = Object.entries(grouped)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 20)
  .map(([file, count]) => ({ file, count }));

await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${new Date().toISOString().replace(/[:.]/g, "_")}-report.json`);
const report = {
  createdAt: new Date().toISOString(),
  result: issues.length === 0 ? "PASS" : strict ? "FAIL" : "WARN",
  issueCount: issues.length,
  topFiles,
  issues,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`i18n audit report: ${reportPath}`);
console.log(`Result: ${report.result}`);
console.log(`Hardcoded UI literal candidates: ${issues.length}`);
for (const item of topFiles.slice(0, 8)) {
  console.log(`- ${item.file}: ${item.count}`);
}

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
