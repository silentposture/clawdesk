import { createMockAdapters } from "./mock.mjs";
import { createProductionAdapters } from "./production.mjs";

export const BACKEND_ADAPTER_MODES = ["mock", "production"];

export function normalizeBackendAdapterMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  return BACKEND_ADAPTER_MODES.includes(mode) ? mode : "mock";
}

export function createBackendAdapters({ env = process.env } = {}) {
  const mode = normalizeBackendAdapterMode(env.CLAWDESK_BACKEND_ADAPTER_MODE);
  return mode === "production" ? createProductionAdapters({ env }) : createMockAdapters({ env });
}
