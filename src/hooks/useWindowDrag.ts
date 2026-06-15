import { useCallback } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const NO_DRAG_SELECTOR = 'button, a, input, select, textarea, [data-no-drag="true"]';

export function useWindowDrag() {
  const onMouseDown = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!isTauri()) return;

    const target = event.target as HTMLElement;
    if (target.closest(NO_DRAG_SELECTOR)) return;

    event.preventDefault();

    void getCurrentWindow().startDragging().catch(() => {
      // Ignore when running outside the Tauri runtime.
    });
  }, []);

  return { onMouseDown };
}
