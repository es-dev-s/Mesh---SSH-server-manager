import { invoke } from "@tauri-apps/api/core";

export function createTerminalSession(
  id: string,
  cols: number,
  rows: number,
): Promise<number> {
  return invoke<number>("create_terminal_session", { id, cols, rows });
}

export function closeTerminalSession(
  id: string,
  spawnGeneration?: number,
): Promise<void> {
  return invoke("close_terminal_session", {
    id,
    spawnGeneration,
  });
}
