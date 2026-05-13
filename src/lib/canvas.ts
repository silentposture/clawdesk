import type { CanvasBeginEvent, CanvasComponent, CanvasDataEvent, CanvasPatchEvent } from "./events";

export interface CanvasSurface {
  id: string;
  title: string;
  rootId?: string;
  components: Record<string, CanvasComponent>;
  data: Record<string, unknown>;
}

export interface CanvasState {
  activeSurfaceId?: string;
  surfaces: Record<string, CanvasSurface>;
}

export const initialCanvasState: CanvasState = {
  surfaces: {},
};

export type CanvasAction = CanvasBeginEvent | CanvasPatchEvent | CanvasDataEvent;

export function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  if (action.type === "canvas.begin") {
    return {
      activeSurfaceId: action.surfaceId,
      surfaces: {
        ...state.surfaces,
        [action.surfaceId]: {
          id: action.surfaceId,
          title: action.title,
          components: {},
          data: {},
        },
      },
    };
  }

  const current = state.surfaces[action.surfaceId] ?? {
    id: action.surfaceId,
    title: "Live Canvas",
    components: {},
    data: {},
  };

  if (action.type === "canvas.patch") {
    const components = { ...current.components };
    for (const component of action.components) {
      components[component.id] = component;
    }

    return {
      activeSurfaceId: action.surfaceId,
      surfaces: {
        ...state.surfaces,
        [action.surfaceId]: {
          ...current,
          rootId: action.rootId,
          components,
        },
      },
    };
  }

  return {
    activeSurfaceId: action.surfaceId,
    surfaces: {
      ...state.surfaces,
      [action.surfaceId]: {
        ...current,
        data: {
          ...current.data,
          ...action.data,
        },
      },
    },
  };
}

export function getActiveSurface(state: CanvasState): CanvasSurface | undefined {
  if (!state.activeSurfaceId) return undefined;
  return state.surfaces[state.activeSurfaceId];
}
