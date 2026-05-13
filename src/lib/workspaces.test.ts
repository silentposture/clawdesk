import { describe, expect, it } from "vitest";
import { initialWorkspaceState, visibleProjects, workspaceReducer } from "./workspaces";

describe("workspace projects", () => {
  it("filters by category", () => {
    const state = workspaceReducer(initialWorkspaceState, { type: "select-category", category: "資料分析" });
    expect(visibleProjects(state).every((project) => project.category === "資料分析")).toBe(true);
  });

  it("toggles pinned projects and pinned-only filter", () => {
    const pinned = workspaceReducer(initialWorkspaceState, { type: "toggle-pin", projectId: "live-canvas" });
    expect(pinned.projects.find((project) => project.id === "live-canvas")?.pinned).toBe(true);

    const filtered = workspaceReducer(pinned, { type: "toggle-pinned-filter" });
    expect(visibleProjects(filtered).every((project) => project.pinned)).toBe(true);
  });
});
