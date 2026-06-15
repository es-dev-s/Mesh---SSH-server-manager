import type { Pm2Process } from "../../types/ssh";

export type ServerStatus = "live" | "offline";

export type FileKind = "doc" | "code" | "config" | "log" | "image" | "archive";

export type FolderNode = {
  type: "folder";
  id: string;
  name: string;
  remotePath: string;
  status?: ServerStatus;
  subtitle?: string;
};

export type FileNode = {
  type: "file";
  id: string;
  name: string;
  kind: FileKind;
  remotePath: string;
};

export type FileSystemNode = FolderNode | FileNode;

export type PathSegment = {
  name: string;
  remotePath: string;
};

export type Breadcrumb = {
  id: string | null;
  label: string;
  remotePath: string | null;
};

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Stable terminal tab id — no spaces or special chars (PM2 names may contain spaces). */
export function buildTerminalTabId(prefix: "logs" | "terminal", label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const safeSlug = slug.length > 0 ? slug : "session";
  return `${prefix}-${safeSlug}-${Date.now()}`;
}

export function pm2StatusToServerStatus(status: string): ServerStatus {
  return status === "online" ? "live" : "offline";
}

export function buildPm2RootFolders(processes: Pm2Process[]): FolderNode[] {
  return [...processes]
    .sort((a, b) => {
      if (a.status === "online" && b.status !== "online") return -1;
      if (b.status === "online" && a.status !== "online") return 1;
      return a.name.localeCompare(b.name);
    })
    .map((process) => ({
      type: "folder" as const,
      id: `pm2-${process.id}`,
      name: process.name,
      remotePath: process.cwd,
      status: pm2StatusToServerStatus(process.status),
      subtitle: process.cwd,
    }));
}

export function buildRootShortcuts(homePath: string): FolderNode[] {
  const normalizedHome = homePath.replace(/\/+$/, "");
  return [
    {
      type: "folder",
      id: "shortcut-home",
      name: "Home",
      remotePath: normalizedHome,
      subtitle: normalizedHome,
    },
    {
      type: "folder",
      id: "shortcut-deployments",
      name: "Deployments",
      remotePath: `${normalizedHome}/mesh-deployments`,
      subtitle: `${normalizedHome}/mesh-deployments`,
    },
  ];
}

export function buildRootViewItems(
  homePath: string,
  processes: Pm2Process[],
): FolderNode[] {
  return [...buildRootShortcuts(homePath), ...buildPm2RootFolders(processes)];
}

export function joinRemotePath(base: string, name: string): string {
  const normalized = base.replace(/\/+$/, "");
  return `${normalized}/${name}`;
}

export function remoteEntryToNode(
  entry: { name: string; entryType: string; kind: string },
  parentPath: string,
): FileSystemNode {
  const remotePath = joinRemotePath(parentPath, entry.name);
  const id = encodeURIComponent(remotePath);

  if (entry.entryType === "folder") {
    return {
      type: "folder",
      id,
      name: entry.name,
      remotePath,
    };
  }

  return {
    type: "file",
    id,
    name: entry.name,
    kind: entry.kind as FileKind,
    remotePath,
  };
}

export function getBreadcrumbs(pathStack: PathSegment[]): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ id: null, label: "Server", remotePath: null }];

  for (const segment of pathStack) {
    crumbs.push({
      id: segment.remotePath,
      label: segment.name,
      remotePath: segment.remotePath,
    });
  }

  return crumbs;
}

export function countPm2Status(processes: { status: string }[]): {
  liveCount: number;
  offlineCount: number;
} {
  const liveCount = processes.filter((process) => process.status === "online").length;
  return {
    liveCount,
    offlineCount: processes.length - liveCount,
  };
}
