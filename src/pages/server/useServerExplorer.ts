import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRequestSequencer } from "../../lib/sync";
import { useSshStore } from "../../hooks/useSshMonitor";
import type { RemoteEntry, SshSnapshot } from "../../types/ssh";
import {
  buildPm2RootFolders,
  getBreadcrumbs,
  remoteEntryToNode,
  type FileSystemNode,
  type PathSegment,
} from "./server-file-system";

const SSH_STATUS_EVENT = "ssh://status";
const DIRECTORY_REFRESH_MS = 15_000;

function isSessionExpiredMessage(message: string): boolean {
  return message.toLowerCase().includes("session expired");
}

export function useServerExplorer() {
  const snapshot = useSshStore((state) => state.snapshot);
  const [pathStack, setPathStack] = useState<PathSegment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<FileSystemNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestSequencer = useRef(createRequestSequencer());
  const sessionIdRef = useRef(snapshot.sessionId);
  const revisionRef = useRef(snapshot.revision);
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

  useEffect(() => {
    if (snapshot.sessionId !== sessionIdRef.current) {
      sessionIdRef.current = snapshot.sessionId;
      requestSequencer.current.cancel();
      setPathStack([]);
      setSelectedId(null);
    }
  }, [snapshot.sessionId]);

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
      return;
    }

    if (!currentRemotePath) {
      return;
    }

    void loadDirectory(currentRemotePath);
  }, [
    applyRootView,
    currentRemotePath,
    isConnected,
    isRootView,
    loadDirectory,
    snapshot,
  ]);

  useEffect(() => {
    if (snapshot.revision === revisionRef.current) {
      return;
    }

    revisionRef.current = snapshot.revision;

    if (!isConnected) {
      return;
    }

    if (isRootView) {
      applyRootView(snapshot);
      return;
    }

    if (currentRemotePath) {
      void loadDirectory(currentRemotePath);
    }
  }, [
    applyRootView,
    currentRemotePath,
    isConnected,
    isRootView,
    loadDirectory,
    snapshot.revision,
    snapshot.pm2,
  ]);

  useEffect(() => {
    let active = true;
    let refreshTimer: number | undefined;
    let disposeListener: (() => void) | undefined;

    void listen<SshSnapshot>(SSH_STATUS_EVENT, (event) => {
      if (!active || event.payload.revision <= revisionRef.current) {
        return;
      }

      revisionRef.current = event.payload.revision;

      if (event.payload.state !== "connected") {
        return;
      }

      const stack = pathStackRef.current;
      if (stack.length === 0) {
        applyRootView(event.payload);
        return;
      }

      const remotePath = stack[stack.length - 1]?.remotePath;
      if (remotePath) {
        void loadDirectory(remotePath);
      }
    }).then((unlisten) => {
      if (!active) {
        unlisten();
        return;
      }
      disposeListener = unlisten;
    });

    refreshTimer = window.setInterval(() => {
      if (!isConnected || pathStackRef.current.length === 0) {
        return;
      }

      const remotePath =
        pathStackRef.current[pathStackRef.current.length - 1]?.remotePath;
      if (remotePath) {
        void loadDirectory(remotePath);
      }
    }, DIRECTORY_REFRESH_MS);

    return () => {
      active = false;
      disposeListener?.();
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
      }
    };
  }, [applyRootView, isConnected, loadDirectory]);

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
