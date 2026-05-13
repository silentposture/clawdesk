export type ChangeKind = "read" | "write" | "delete" | "upload" | "internet" | "screen-vision";

export interface SandboxPolicy {
  projectFolder: string;
  backupFolder: string;
  requireApprovalOutsideProject: boolean;
  backupBeforeProjectChange: boolean;
  neverAutoDelete: boolean;
  allowInternet: boolean;
  allowScreenVision: boolean;
}

export interface ChangeRequest {
  kind: ChangeKind;
  target: string;
}

export interface PolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  requiresBackup: boolean;
  reason: string;
}

export const defaultSandboxPolicy: SandboxPolicy = {
  projectFolder: "~/ClawDesk Projects/桌面 GUI",
  backupFolder: "~/ClawDesk Projects/桌面 GUI/.clawdesk-backups",
  requireApprovalOutsideProject: true,
  backupBeforeProjectChange: true,
  neverAutoDelete: true,
  allowInternet: true,
  allowScreenVision: false,
};

export function normalizeUserPath(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

export function isInsideProject(target: string, projectFolder: string): boolean {
  const targetPath = normalizeUserPath(target);
  const projectPath = normalizeUserPath(projectFolder);
  return targetPath === projectPath || targetPath.startsWith(`${projectPath}/`);
}

export function decideChange(policy: SandboxPolicy, request: ChangeRequest): PolicyDecision {
  if (request.kind === "delete" && policy.neverAutoDelete) {
    return {
      allowed: false,
      requiresApproval: true,
      requiresBackup: false,
      reason: "不主動刪除原則：刪除動作一律需要人工確認，MVP 不自動執行。",
    };
  }

  if (request.kind === "internet" && !policy.allowInternet) {
    return {
      allowed: false,
      requiresApproval: true,
      requiresBackup: false,
      reason: "網際網路連線目前未啟用。",
    };
  }

  if (request.kind === "screen-vision" && !policy.allowScreenVision) {
    return {
      allowed: false,
      requiresApproval: true,
      requiresBackup: false,
      reason: "螢幕視覺辨識需要使用者明確啟用。",
    };
  }

  const insideProject = isInsideProject(request.target, policy.projectFolder);
  if (!insideProject && policy.requireApprovalOutsideProject) {
    return {
      allowed: false,
      requiresApproval: true,
      requiresBackup: false,
      reason: "目標超出專案資料夾，必須先由使用者授權。",
    };
  }

  const mutating = request.kind === "write" || request.kind === "upload";
  return {
    allowed: true,
    requiresApproval: false,
    requiresBackup: insideProject && mutating && policy.backupBeforeProjectChange,
    reason: insideProject ? "目標位於專案沙盒內。" : "動作不會修改本機檔案。",
  };
}
