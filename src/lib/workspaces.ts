export type ProjectCategory = "全部" | "AI 代理" | "資料分析" | "文件工作" | "系統自動化";

export interface WorkspaceProject {
  id: string;
  name: string;
  category: Exclude<ProjectCategory, "全部">;
  description: string;
  pinned: boolean;
  updatedAt: string;
}

export interface WorkspaceState {
  projects: WorkspaceProject[];
  activeCategory: ProjectCategory;
  selectedProjectId: string;
  showPinnedOnly: boolean;
}

export type WorkspaceAction =
  | { type: "select-category"; category: ProjectCategory }
  | { type: "select-project"; projectId: string }
  | { type: "toggle-pin"; projectId: string }
  | { type: "toggle-pinned-filter" };

export const initialWorkspaceState: WorkspaceState = {
  activeCategory: "全部",
  selectedProjectId: "desktop-mvp",
  showPinnedOnly: false,
  projects: [
    {
      id: "desktop-mvp",
      name: "ClawDesk 商業桌面版",
      category: "AI 代理",
      description: "Windows 11 x64 優先的桌面代理主線。",
      pinned: true,
      updatedAt: "剛剛",
    },
    {
      id: "provider-settings",
      name: "模型連線設定",
      category: "系統自動化",
      description: "ChatGPT Pro 帳號狀態、OpenAI API、本機模型。",
      pinned: true,
      updatedAt: "今天",
    },
    {
      id: "live-canvas",
      name: "Live Canvas",
      category: "資料分析",
      description: "宣告式 UI、表格、指標與權限結果呈現。",
      pinned: false,
      updatedAt: "今天",
    },
    {
      id: "docs-brief",
      name: "文件整理",
      category: "文件工作",
      description: "PRD、測試紀錄與桌面端使用說明。",
      pinned: false,
      updatedAt: "昨天",
    },
  ],
};

export const projectCategories: ProjectCategory[] = ["全部", "AI 代理", "資料分析", "文件工作", "系統自動化"];

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  if (action.type === "select-category") {
    return { ...state, activeCategory: action.category, showPinnedOnly: false };
  }

  if (action.type === "select-project") {
    return { ...state, selectedProjectId: action.projectId };
  }

  if (action.type === "toggle-pinned-filter") {
    return { ...state, showPinnedOnly: !state.showPinnedOnly };
  }

  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === action.projectId ? { ...project, pinned: !project.pinned } : project,
    ),
  };
}

export function visibleProjects(state: WorkspaceState): WorkspaceProject[] {
  return state.projects
    .filter((project) => state.activeCategory === "全部" || project.category === state.activeCategory)
    .filter((project) => !state.showPinnedOnly || project.pinned)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, "zh-Hant"));
}

export function selectedProject(state: WorkspaceState): WorkspaceProject | undefined {
  return state.projects.find((project) => project.id === state.selectedProjectId);
}
