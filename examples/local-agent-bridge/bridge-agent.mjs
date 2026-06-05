import { runHostBridgeAgent } from "../../src/bridge/host-bridge-agent.mjs";

async function main() {
  await runHostBridgeAgent(process.argv);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
