import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import { createRequestSequencer } from "../../lib/sync";
import { useSshStore } from "../../hooks/useSshMonitor";
import type { RemoteEntry, SshSnapshot } from "../../types/ssh";
import { useExplorerStore } from "../../stores/useExplorerStore";
import {
  buildPm2RootFolders,
  getBreadcrumbs,
  remoteEntryToNode,
  type FileSystemNode,
  type PathSegment,
} from "./server-file-system";

const DIRECTORY_REFRESH_MS = 15_000;

function isSessionExpiredMessage(message: string): boolean {
  return message.toLowerCase().includes("session expired");
}

export function useServerExplorer() {
  const snapshot = useSshStore((state) => state.snapshot);
  const {
    pathStack,
    selectedId,
    items,
    loading,
    error,
    setPathStack,
    setSelectedId,
    setItems,
    setLoading,
    setError,
  } = useExplorerStore();

  const requestSequencer = useRef(createRequestSequencer());
  const sessionIdRef = useRef(snapshot.sessionId);
  const pathStackRef = useRef<PathSegment[]>(pathStack);

  useEffect(() => {
    pathStackRef.current = pathStack;
  }, [pathStack]);

  const isRootView = pathStack.length === 0;
  const currentRemotePath =
    pathStack.length > 0
      ? pathStack[pathStack.length - 1].remotePath
      : null;
  const isConnected = snapshot.state === "connected";
  const pm2 = snapshot.pm2;

  const applyRootView = useCallback((nextSnapshot: SshSnapshot) => {
    if (!nextSnapshot.pm2?.installed) {
      setItems([]);
      setError("PM2 is not installed on this server");
      return;
    }

    if (nextSnapshot.pm2.processes.length === 0) {
      setItems([]);
      setError("No PM2 processes found on this server");
      return;
    }

    setError(null);
    setItems(buildPm2RootFolders(nextSnapshot.pm2.processes));
  }, []);

  const loadDirectory = useCallback(async (remotePath: string) => {
    const requestId = requestSequencer.current.next();
    setLoading(true);
    setError(null);

    try {
      const entries = await invoke<RemoteEntry[]>("list_remote_directory", {
        path: remotePath,
      });

      if (!requestSequencer.current.isLatest(requestId)) {
        return;
      }

      setItems(entries.map((entry) => remoteEntryToNode(entry, remotePath)));
    } catch (loadError) {
      if (!requestSequencer.current.isLatest(requestId)) {
        return;
      }

      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load directory contents";

      setItems([]);
      setError(
        isSessionExpiredMessage(message)
          ? "Session reconnecting — directory will refresh automatically"
          : message,
      );
    } finally {
      if (requestSequencer.current.isLatest(requestId)) {
        setLoading(false);
      }
    }
  }, []);

  // 1. Reset state on session ID change
  useEffect(() => {
    if (snapshot.sessionId !== sessionIdRef.current) {
      sessionIdRef.current = snapshot.sessionId;
      requestSequencer.current.cancel();
      setPathStack([]);
      setSelectedId(null);
    }
  }, [snapshot.sessionId]);

  // 2. Handle connection status and Root View (PM2 processes list) updates
  useEffect(() => {
    if (!isConnected) {
      requestSequencer.current.cancel();
      setItems([]);
      setError("Connect to the server from Dashboard to browse PM2 apps");
      setLoading(false);
      return;
    }

    if (isRootView) {
      setLoading(false);
      applyRootView(snapshot);
    }
  }, [isConnected, isRootView, applyRootView, snapshot]);

  // 3. Load directory when navigating to a new path
  useEffect(() => {
    if (!isConnected || isRootView || !currentRemotePath) {
      return;
    }

    void loadDirectory(currentRemotePath);
  }, [isConnected, isRootView, currentRemotePath, loadDirectory]);

  // 4. Periodically refresh directory while browsing it
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const refreshTimer = window.setInterval(() => {
      if (pathStackRef.current.length === 0) {
        return;
      }

      const remotePath =
        pathStackRef.current[pathStackRef.current.length - 1]?.remotePath;
      if (remotePath) {
        void loadDirectory(remotePath);
      }
    }, DIRECTORY_REFRESH_MS);

    return () => {
      window.clearInterval(refreshTimer);
    };
  }, [isConnected, loadDirectory]);

  const openFolder = useCallback((node: FileSystemNode) => {
    if (node.type !== "folder") {
      return;
    }

    requestSequencer.current.cancel();
    setPathStack((current) => [
      ...current,
      { name: node.name, remotePath: node.remotePath },
    ]);
    setSelectedId(null);
  }, []);

  const goBack = useCallback(() => {
    requestSequencer.current.cancel();
    setPathStack((current) => current.slice(0, -1));
    setSelectedId(null);
  }, []);

  const navigateTo = useCallback((breadcrumbIndex: number) => {
    requestSequencer.current.cancel();
    if (breadcrumbIndex <= 0) {
      setPathStack([]);
    } else {
      setPathStack((current) => current.slice(0, breadcrumbIndex));
    }
    setSelectedId(null);
  }, []);

  return {
    items,
    breadcrumbs: getBreadcrumbs(pathStack),
    selectedId,
    setSelectedId,
    openFolder,
    goBack,
    navigateTo,
    isRootView,
    loading,
    error,
    currentRemotePath,
    pm2Processes: pm2?.processes ?? [],
    isConnected,
    revision: snapshot.revision,
  };
}
