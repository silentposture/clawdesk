import { spawnSync } from "node:child_process";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform !== "darwin") {
  throw new Error("macOS build must run on macOS with Apple signing/notarization tooling available.");
}

run("npm", ["run", "icons"]);
run("tauri", ["build", "--config", "src-tauri/tauri.macos.conf.json", "--bundles", "app,dmg"], {
  env: { CLAWDESK_RELEASE_CHANNEL: "production", CLAWDESK_BUILD_PROFILE: "production" },
});
