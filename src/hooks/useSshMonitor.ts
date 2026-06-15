import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { create } from "zustand";
import { isSnapshotNewer } from "../lib/sync";
import type { SshSnapshot } from "../types/ssh";

const initialSnapshot: SshSnapshot = {
  state: "connecting",
  name: "es",
  user: "es",
  host: "10.80.80.221",
  port: 22,
  lastConnectedAt: null,
  lastUpdatedAt: null,
  lastError: null,
  statusMessage: null,
  reconnectAttempts: 0,
  revision: 0,
  sessionId: 0,
  specs: null,
  storage: null,
  pm2: null,
};

interface SshStore {
  snapshot: SshSnapshot;
  applySnapshot: (snapshot: SshSnapshot) => void;
}

export const useSshStore = create<SshStore>((set) => ({
  snapshot: initialSnapshot,
  applySnapshot: (incoming) =>
    set((state) => {
      if (!isSnapshotNewer(state.snapshot, incoming)) {
        return state;
      }
      return { snapshot: incoming };
    }),
}));

const SSH_STATUS_EVENT = "ssh://status";
const RECONCILE_INTERVAL_MS = 30_000;

export function useSshMonitor() {
  const applySnapshot = useSshStore((state) => state.applySnapshot);
  const revisionRef = useRef(0);

  useEffect(() => {
    let active = true;

    async function reconcile() {
      try {
        const snapshot = await invoke<SshSnapshot>("get_ssh_status");
        if (!active) {
          return;
        }

        if (snapshot.revision > revisionRef.current) {
          revisionRef.current = snapshot.revision;
          applySnapshot(snapshot);
        }
      } catch {
        // Running outside Tauri.
      }
    }

    async function bootstrap() {
      await reconcile();

      const unlisten = await listen<SshSnapshot>(SSH_STATUS_EVENT, (event) => {
        if (!active) {
          return;
        }

        const snapshot = event.payload;
        if (snapshot.revision >= revisionRef.current) {
          revisionRef.current = snapshot.revision;
          applySnapshot(snapshot);
        }
      });

      const reconcileTimer = window.setInterval(() => {
        void reconcile();
      }, RECONCILE_INTERVAL_MS);

      return () => {
        window.clearInterval(reconcileTimer);
        unlisten();
      };
    }

    let cleanup: (() => void) | undefined;
    void bootstrap().then((dispose) => {
      cleanup = dispose;
    });

    return () => {
      active = false;
      cleanup?.();
    };
  }, [applySnapshot]);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function formatPm2Uptime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0m";
  }
  return formatUptime(Math.floor(ms / 1000));
}

export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0m";
  }

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}
