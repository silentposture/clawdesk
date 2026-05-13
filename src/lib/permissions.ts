import type { PermissionRequestEvent } from "./events";

export type PermissionMode = "ask-before-acting" | "trusted-workspace";

export interface PermissionSettings {
  mode: PermissionMode;
  trustedWorkspaces: string[];
}

export interface PermissionDecision {
  requiresPrompt: boolean;
  allowed: boolean;
  reason: string;
}

const destructiveActions = new Set(["delete_file", "overwrite_file", "run_shell", "modify_settings"]);

export const defaultPermissionSettings: PermissionSettings = {
  mode: "ask-before-acting",
  trustedWorkspaces: [],
};

export function evaluatePermissionRequest(
  request: PermissionRequestEvent,
  settings: PermissionSettings,
): PermissionDecision {
  if (settings.mode === "ask-before-acting") {
    return {
      requiresPrompt: true,
      allowed: false,
      reason: "預設模式要求在執行動作前取得明確授權。",
    };
  }

  if (request.risk === "high" || destructiveActions.has(request.action)) {
    return {
      requiresPrompt: true,
      allowed: false,
      reason: "高風險或破壞性動作需要明確授權。",
    };
  }

  const trusted = settings.trustedWorkspaces.some((workspace) =>
    request.target === workspace || request.target.startsWith(`${workspace}/`),
  );

  if (!trusted) {
    return {
      requiresPrompt: true,
      allowed: false,
      reason: "目標位於受信任工作區之外。",
    };
  }

  return {
    requiresPrompt: false,
    allowed: true,
    reason: "低風險動作位於受信任工作區內。",
  };
}
