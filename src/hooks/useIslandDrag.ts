import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, PhysicalPosition } from "@tauri-apps/api/window";
import { useCallback, useRef } from "react";

const NO_DRAG_SELECTOR = 'button, a, input, [data-no-drag="true"]';
const ISLAND_POSITION_KEY = "mesh-island-position";
const ISLAND_DRAGGING_KEY = "mesh-island-dragging";

export type IslandPosition = {
  y: number;
};

type IslandDockResult = {
  x: number;
  y: number;
  dock: string;
};

export function readSavedPosition(): IslandPosition | null {
  const raw = localStorage.getItem(ISLAND_POSITION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { y?: number; x?: number; dock?: string };
    if (typeof parsed.y === "number" && Number.isFinite(parsed.y)) {
      return { y: parsed.y };
    }
  } catch {
    // ignore legacy formats
  }

  return null;
}

function savePosition(position: IslandPosition) {
  localStorage.setItem(ISLAND_POSITION_KEY, JSON.stringify(position));
}

export function isIslandDragging(): boolean {
  return sessionStorage.getItem(ISLAND_DRAGGING_KEY) === "1";
}

export async function applyIslandPosition(y: number): Promise<IslandPosition | null> {
  if (!isTauri()) return null;

  const result = await invoke<IslandDockResult>("apply_island_dock", { y });
  const position = { y: result.y };
  savePosition(position);
  return position;
}

export async function restoreIslandPosition(): Promise<IslandPosition | null> {
  const saved = readSavedPosition();
  if (!saved) {
    return applyIslandPosition(0);
  }
  return applyIslandPosition(saved.y);
}

export function useIslandDrag() {
  const draggingRef = useRef(false);

  const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!isTauri()) return;

    const target = event.target as HTMLElement;
    if (target.closest(NO_DRAG_SELECTOR)) return;

    event.preventDefault();
    draggingRef.current = true;
    sessionStorage.setItem(ISLAND_DRAGGING_KEY, "1");

    const startY = event.screenY;

    void (async () => {
      const win = getCurrentWindow();
      const position = await win.outerPosition();
      const originY = position.y;
      const originX = position.x;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) return;
        moveEvent.preventDefault();
        const nextY = originY + (moveEvent.screenY - startY);
        void win.setPosition(new PhysicalPosition(originX, nextY));
      };

      const onMouseUp = (upEvent: MouseEvent) => {
        draggingRef.current = false;
        sessionStorage.removeItem(ISLAND_DRAGGING_KEY);
        globalThis.window.removeEventListener("mousemove", onMouseMove);
        globalThis.window.removeEventListener("mouseup", onMouseUp);

        const nextY = originY + (upEvent.screenY - startY);
        void applyIslandPosition(nextY);
      };

      globalThis.window.addEventListener("mousemove", onMouseMove);
      globalThis.window.addEventListener("mouseup", onMouseUp);
    })();
  }, []);

  return { onMouseDown };
}
