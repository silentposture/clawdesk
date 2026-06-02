import fs from "node:fs/promises";
import path from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readText(file) {
  return fs.readFile(path.join(process.cwd(), file), "utf8");
}

async function main() {
  const workflowFile = ".github/workflows/hidden-window-gate.yml";
  const contributingFile = "CONTRIBUTING.md";

  const workflow = await readText(workflowFile);
  const contributing = await readText(contributingFile);

  assert(workflow.includes("name: Hidden Window Gate"), "workflow name missing");
  assert(workflow.includes("runs-on: windows-latest"), "workflow runner must be windows-latest");
  assert(workflow.includes("npm run audit:tasks:hidden"), "workflow missing audit command");
  assert(workflow.includes("npm run preflight"), "workflow missing preflight command");
  assert(contributing.includes("Hidden Window Gate / hidden-window-and-preflight"), "CONTRIBUTING missing required status check name");

  console.log("PASS branch-protection readiness");
}

await main();
