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
  const crumbs: Breadcrumb[] = [{ id: null, label: "PM2 Apps", remotePath: null }];

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
