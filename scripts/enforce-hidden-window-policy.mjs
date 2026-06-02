import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const checks = [
  {
    file: path.join(root, "scripts"),
    recursive: true,
    include: (name) => name.endsWith(".mjs"),
    validate: validateNodeSpawn,
  },
  {
    file: path.join(root, "scripts", "audit-scheduled-tasks.ps1"),
    recursive: false,
    include: (name) => name.endsWith(".ps1"),
    validate: validatePowerShellStartProcess,
  },
  {
    file: path.join(root, "src-tauri", "src", "lib.rs"),
    recursive: false,
    include: (name) => name.endsWith(".rs"),
    validate: validateRustCommand,
  },
];

function lineNumberFromOffset(text, offset) {
  return text.slice(0, offset).split(/\r?\n/).length;
}

function validateNodeSpawn(filePath, content) {
  const issues = [];
  const regex = /spawnSync?\s*\(/g;
  for (const match of content.matchAll(regex)) {
    const offset = match.index ?? 0;
    const snippet = content.slice(offset, offset + 500);
    if (!snippet.includes("windowsHide")) {
      issues.push({
        filePath,
        line: lineNumberFromOffset(content, offset),
        message: "spawn/spawnSync 缺少 windowsHide",
      });
    }
  }
  return issues;
}

function validatePowerShellStartProcess(filePath, content) {
  const issues = [];
  const regex = /Start-Process\b/gi;
  for (const match of content.matchAll(regex)) {
    const offset = match.index ?? 0;
    const lineStart = content.lastIndexOf("\n", offset) + 1;
    const lineEnd = content.indexOf("\n", offset);
    const lineText = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (!/-WindowStyle\s+Hidden/i.test(lineText)) {
      issues.push({
        filePath,
        line: lineNumberFromOffset(content, offset),
        message: "Start-Process 缺少 -WindowStyle Hidden",
      });
    }
  }
  return issues;
}

function validateRustCommand(filePath, content) {
  const issues = [];
  const commandCount = (content.match(/Command::new\s*\(/g) ?? []).length;
  if (commandCount === 0) return issues;
  if (!/creation_flags\s*\(\s*CREATE_NO_WINDOW\s*\)/.test(content)) {
    issues.push({
      filePath,
      line: 1,
      message: "Rust Command::new 啟動流程缺少 creation_flags(CREATE_NO_WINDOW)",
    });
  }
  return issues;
}

async function collectFiles(basePath, recursive, include) {
  const entries = await fs.readdir(basePath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(basePath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...await collectFiles(full, recursive, include));
      }
      continue;
    }
    if (include(entry.name)) files.push(full);
  }
  return files;
}

async function main() {
  const issues = [];
  for (const check of checks) {
    const stats = await fs.stat(check.file).catch(() => null);
    if (!stats) continue;
    const targets = stats.isDirectory()
      ? await collectFiles(check.file, check.recursive, check.include)
      : [check.file];

    for (const target of targets) {
      const content = await fs.readFile(target, "utf8");
      issues.push(...check.validate(target, content));
    }
  }

  if (issues.length > 0) {
    console.error("Hidden-window policy violations:");
    for (const issue of issues) {
      console.error(`- ${issue.filePath}:${issue.line} ${issue.message}`);
    }
    process.exit(1);
  }

  console.log("Hidden-window policy check passed.");
}

await main();
