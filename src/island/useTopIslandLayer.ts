import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isIslandDragging, restoreIslandPosition } from "../hooks/useIslandDrag";

const ISLAND_PIN_MS = 3_000;

function syncIslandPresence() {
  if (isIslandDragging()) {
    return;
  }

  if (isTauri()) {
    void invoke("pin_island");
    void restoreIslandPosition();
  }
}

export function useIslandPresenceSync() {
  useEffect(() => {
    syncIslandPresence();
    const interval = window.setInterval(syncIslandPresence, ISLAND_PIN_MS);
    return () => window.clearInterval(interval);
  }, []);
}

export function useDashboardIslandSync() {
  useEffect(() => {
    syncIslandPresence();
    const interval = window.setInterval(syncIslandPresence, ISLAND_PIN_MS);
    return () => window.clearInterval(interval);
  }, []);
}
