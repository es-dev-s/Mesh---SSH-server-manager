import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRequestSequencer } from "../../lib/sync";
import { useSshStore } from "../../hooks/useSshMonitor";
import type { RemoteEntry, SshSnapshot } from "../../types/ssh";
import { useExplorerStore } from "../../stores/useExplorerStore";
import {
  buildRootViewItems,
  getBreadcrumbs,
  joinRemotePath,
  remoteEntryToNode,
  type FileSystemNode,
  type PathSegment,
} from "./server-file-system";

const DIRECTORY_REFRESH_MS = 15_000;

function isSessionExpiredMessage(message: string): boolean {
  return message.toLowerCase().includes("session expired");
}

function guessHomePath(user: string): string {
  return `/home/${user}`;
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
  const [homePath, setHomePath] = useState<string>(() => guessHomePath(snapshot.user));

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

  const applyRootView = useCallback(
    (nextSnapshot: SshSnapshot, resolvedHome: string) => {
      if (!nextSnapshot.pm2?.installed) {
        setItems(buildRootViewItems(resolvedHome, []));
        setError("PM2 is not installed — you can still browse Home and Deployments");
        return;
      }

      setError(null);
      setItems(buildRootViewItems(resolvedHome, nextSnapshot.pm2.processes));
    },
    [setError, setItems],
  );

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
  }, [setError, setItems, setLoading]);

  const refreshCurrent = useCallback(async () => {
    if (!isConnected) {
      return;
    }

    if (isRootView) {
      applyRootView(snapshot, homePath);
      return;
    }

    if (currentRemotePath) {
      await loadDirectory(currentRemotePath);
    }
  }, [
    applyRootView,
    currentRemotePath,
    homePath,
    isConnected,
    isRootView,
    loadDirectory,
    snapshot,
  ]);

  const resolveHomePath = useCallback(async () => {
    try {
      const resolved = await invoke<string>("get_remote_home");
      if (resolved.trim()) {
        setHomePath(resolved.trim());
        return resolved.trim();
      }
    } catch {
      // Fall back to /home/{user} when the remote home lookup fails.
    }

    const fallback = guessHomePath(snapshot.user);
    setHomePath(fallback);
    return fallback;
  }, [snapshot.user]);

  const createParentPath = useCallback((): string | null => {
    if (currentRemotePath) {
      return currentRemotePath;
    }

    const selected = items.find((item) => item.id === selectedId);
    if (selected?.type === "folder") {
      return selected.remotePath;
    }

    return homePath;
  }, [currentRemotePath, homePath, items, selectedId]);

  const createFolder = useCallback(
    async (name: string) => {
      const parent = createParentPath();
      if (!parent) {
        throw new Error("Open a folder or select a destination first");
      }

      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("Folder name is required");
      }

      const path = joinRemotePath(parent, trimmed);
      await invoke("create_remote_directory", { path });
      await refreshCurrent();
    },
    [createParentPath, refreshCurrent],
  );

  const createFile = useCallback(
    async (name: string) => {
      const parent = createParentPath();
      if (!parent) {
        throw new Error("Open a folder or select a destination first");
      }

      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error("File name is required");
      }

      const path = joinRemotePath(parent, trimmed);
      await invoke("create_remote_file", { path });
      await refreshCurrent();
    },
    [createParentPath, refreshCurrent],
  );

  const goToPath = useCallback(
    async (rawPath: string) => {
      const remotePath = rawPath.trim();
      if (!remotePath.startsWith("/")) {
        throw new Error("Path must be absolute (start with /)");
      }

      requestSequencer.current.cancel();
      setPathStack([{ name: remotePath.split("/").filter(Boolean).pop() ?? remotePath, remotePath }]);
      setSelectedId(null);
      await loadDirectory(remotePath);
    },
    [loadDirectory, setPathStack, setSelectedId],
  );

  // 1. Reset state on session ID change
  useEffect(() => {
    if (snapshot.sessionId !== sessionIdRef.current) {
      sessionIdRef.current = snapshot.sessionId;
      requestSequencer.current.cancel();
      setPathStack([]);
      setSelectedId(null);
      setHomePath(guessHomePath(snapshot.user));
    }
  }, [snapshot.sessionId, snapshot.user, setPathStack, setSelectedId]);

  // 2. Resolve remote home when connected
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    void resolveHomePath();
  }, [isConnected, resolveHomePath, snapshot.sessionId]);

  // 3. Handle connection status and root view updates
  useEffect(() => {
    if (!isConnected) {
      requestSequencer.current.cancel();
      setItems([]);
      setError("Connect to the server from Dashboard to browse files");
      setLoading(false);
      return;
    }

    if (isRootView) {
      setLoading(false);
      applyRootView(snapshot, homePath);
    }
  }, [isConnected, isRootView, applyRootView, snapshot, homePath, setError, setItems, setLoading]);

  // 4. Load directory when navigating to a new path
  useEffect(() => {
    if (!isConnected || isRootView || !currentRemotePath) {
      return;
    }

    void loadDirectory(currentRemotePath);
  }, [isConnected, isRootView, currentRemotePath, loadDirectory]);

  // 5. Periodically refresh directory while browsing it
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

  const openFolder = useCallback(
    (node: FileSystemNode) => {
      if (node.type !== "folder") {
        return;
      }

      requestSequencer.current.cancel();
      setPathStack((current) => [
        ...current,
        { name: node.name, remotePath: node.remotePath },
      ]);
      setSelectedId(null);
    },
    [setPathStack, setSelectedId],
  );

  const goBack = useCallback(() => {
    requestSequencer.current.cancel();
    setPathStack((current) => current.slice(0, -1));
    setSelectedId(null);
  }, [setPathStack, setSelectedId]);

  const navigateTo = useCallback(
    (breadcrumbIndex: number) => {
      requestSequencer.current.cancel();
      if (breadcrumbIndex <= 0) {
        setPathStack([]);
      } else {
        setPathStack((current) => current.slice(0, breadcrumbIndex));
      }
      setSelectedId(null);
    },
    [setPathStack, setSelectedId],
  );

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
    homePath,
    pm2Processes: pm2?.processes ?? [],
    isConnected,
    revision: snapshot.revision,
    createFolder,
    createFile,
    goToPath,
    refreshCurrent,
  };
}
