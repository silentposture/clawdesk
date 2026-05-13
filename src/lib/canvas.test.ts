import { describe, expect, it } from "vitest";
import { canvasReducer, getActiveSurface, initialCanvasState } from "./canvas";

describe("canvas reducer", () => {
  it("creates a surface and applies component patches", () => {
    const begun = canvasReducer(initialCanvasState, {
      type: "canvas.begin",
      surfaceId: "s1",
      title: "Demo",
    });

    const patched = canvasReducer(begun, {
      type: "canvas.patch",
      surfaceId: "s1",
      rootId: "root",
      components: [{ id: "root", type: "Panel", props: { title: "Root" }, children: ["text"] }],
    });

    expect(getActiveSurface(patched)?.rootId).toBe("root");
    expect(getActiveSurface(patched)?.components.root.type).toBe("Panel");
  });

  it("merges data updates without removing components", () => {
    const patched = canvasReducer(
      canvasReducer(initialCanvasState, { type: "canvas.begin", surfaceId: "s1", title: "Demo" }),
      {
        type: "canvas.patch",
        surfaceId: "s1",
        rootId: "root",
        components: [{ id: "root", type: "Metric", props: { label: "A", value: "1" } }],
      },
    );

    const updated = canvasReducer(patched, {
      type: "canvas.data",
      surfaceId: "s1",
      data: { score: 94 },
    });

    expect(getActiveSurface(updated)?.data.score).toBe(94);
    expect(getActiveSurface(updated)?.components.root.type).toBe("Metric");
  });
});
