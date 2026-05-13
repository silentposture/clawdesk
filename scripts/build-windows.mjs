import { spawnSync } from "node:child_process";

function cleanWindowsBuildEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.CARGO_BUILD_TARGET;
  delete env.RUSTFLAGS;
  return env;
}

function commandInvocation(command, args) {
  if (process.platform !== "win32") return { command, args };
  if (command.endsWith(".exe")) return { command, args };
  const cmdCommand = command.endsWith(".cmd") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", cmdCommand, ...args] };
}

function run(command, args, options = {}) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: false,
    env: cleanWindowsBuildEnv(options.env ?? {}),
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const production = process.argv.includes("--production");
const store = process.argv.includes("--store");

if (production) {
  run("npm", ["run", "release:guard:strict"], {
    env: { CLAWDESK_RELEASE_CHANNEL: "production" },
  });
}

run("npm", ["run", "icons"]);
run("npm", ["run", "legal:notices"]);

if (store) {
  run("npm", ["run", "release:configs:check", "--", "--store"]);
  run("npm", ["run", "sbom"]);
}

const buildArgs = store
  ? ["build", "--config", "src-tauri/tauri.microsoftstore.conf.json", "--bundles", "nsis"]
  : production
  ? ["build", "--config", "src-tauri/tauri.prod.conf.json", "--bundles", "nsis"]
  : ["build", "--bundles", "nsis"];

run("tauri", buildArgs, {
  env: production || store
    ? {
        CLAWDESK_RELEASE_CHANNEL: "production",
        CLAWDESK_BUILD_PROFILE: "production",
        CLAWDESK_RELEASE_TARGET: store ? "microsoft-store" : "direct-win",
      }
    : {},
});
