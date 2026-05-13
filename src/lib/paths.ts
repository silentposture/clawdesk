export type PathKind = "project-root" | "uploads" | "backups" | "knowledge" | "memory" | "absolute" | "relative";

export interface PathResolution {
  input: string;
  kind: PathKind;
  absolutePath: string;
  insideProject: boolean;
  requiresApproval: boolean;
  requiresBackup: boolean;
  canDeleteAutomatically: false;
}

export interface PathGovernanceOptions {
  homeDir: string;
  projectRoot: string;
}

const namespaceFolders: Record<string, PathKind> = {
  uploads: "uploads",
  backups: "backups",
  knowledge: "knowledge",
  memory: "memory",
};

function cleanPath(path: string): string {
  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

export function resolveGovernedPath(input: string, options: PathGovernanceOptions, mutating = false): PathResolution {
  const raw = input.trim();
  const namespace = raw.match(/^([a-z]+):(.*)$/i);
  let kind: PathKind = raw.startsWith("/") ? "absolute" : "relative";
  let absolutePath = raw;

  if (raw === "." || raw === "project-root:") {
    kind = "project-root";
    absolutePath = options.projectRoot;
  } else if (namespace && namespaceFolders[namespace[1]]) {
    kind = namespaceFolders[namespace[1]];
    absolutePath = `${options.projectRoot}/${kind}/${namespace[2].replace(/^\/+/, "")}`;
  } else if (raw.startsWith("~/")) {
    absolutePath = `${options.homeDir}/${raw.slice(2)}`;
    kind = "absolute";
  } else if (!raw.startsWith("/")) {
    absolutePath = `${options.projectRoot}/${raw}`;
    kind = "relative";
  }

  absolutePath = cleanPath(absolutePath);
  const projectRoot = cleanPath(options.projectRoot);
  const insideProject = absolutePath === projectRoot || absolutePath.startsWith(`${projectRoot}/`);
  return {
    input,
    kind,
    absolutePath,
    insideProject,
    requiresApproval: !insideProject,
    requiresBackup: insideProject && mutating,
    canDeleteAutomatically: false,
  };
}
