import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import {
  applyIslandPosition,
  readSavedPosition,
  restoreIslandPosition,
} from "../hooks/useIslandDrag";

export const ISLAND_WIDTH = 56;
const BASE_HEIGHT = 160;
const ROW_HEIGHT = 44;
const MAX_HEIGHT = 720;

export function useIslandLayout(processCount: number) {
  const heightRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    void restoreIslandPosition();
  }, []);

  useEffect(() => {
    void (async () => {
      const window = getCurrentWindow();
      const nextHeight = Math.min(
        MAX_HEIGHT,
        Math.max(BASE_HEIGHT, BASE_HEIGHT + processCount * ROW_HEIGHT),
      );

      const currentSize = await window.outerSize();
      const previousHeight = heightRef.current ?? currentSize.height;

      if (mountedRef.current && nextHeight === previousHeight) {
        return;
      }

      await window.setSize(new LogicalSize(ISLAND_WIDTH, nextHeight));

      if (mountedRef.current && nextHeight !== previousHeight) {
        const saved = readSavedPosition();
        const currentPos = await window.outerPosition();
        const delta = nextHeight - previousHeight;
        const nextY = currentPos.y - Math.floor(delta / 2);
        await applyIslandPosition(saved?.y ?? nextY);
      }

      heightRef.current = nextHeight;
      mountedRef.current = true;
    })();
  }, [processCount]);
}

export async function openMainWindow() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("show_main_window");
}

export async function quitMesh() {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("quit_mesh");
}
