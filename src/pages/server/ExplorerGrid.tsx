import type { FileSystemNode, ServerStatus } from "./server-file-system";
import { FileIcon } from "./FileIcon";
import { FolderIcon } from "./FolderIcon";
import { ServerStatusDot } from "./ServerStatus";
import { Terminal, RotateCw } from "lucide-react";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useServerTabsStore } from "../../stores/useServerTabsStore";

export const EXPLORER_CELL_WIDTH = 112;
export const EXPLORER_ICON_SLOT = 80;
export const FOLDER_ICON_SIZE = 64;
export const FILE_ICON_SIZE = 58;

function SelectionBackdrop({ isSelected }: { isSelected: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 inset-y-2 rounded-[10px] bg-white/[0.08] ring-1 ring-white/10 transition-opacity duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        style={{ opacity: isSelected ? 1 : 0 }}
      />
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute inset-x-1 inset-y-2 rounded-[10px] bg-white/[0.03]",
          "transition-opacity duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
          isSelected ? "opacity-0" : "opacity-0 group-hover:opacity-100",
        ].join(" ")}
      />
    </>
  );
}

export function ExplorerItem({
  node,
  isSelected,
  serverStatus,
  isRestarting = false,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  node: FileSystemNode;
  isSelected: boolean;
  serverStatus?: ServerStatus;
  isRestarting?: boolean;
  onSelect: (id: string) => void;
  onOpen: (node: FileSystemNode) => void;
  onContextMenu?: (e: React.MouseEvent, node: FileSystemNode) => void;
}) {
  const isFolder = node.type === "folder";

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => onOpen(node)}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(e, node);
        }
      }}
      aria-pressed={isSelected}
      style={{ width: EXPLORER_CELL_WIDTH }}
      className="group flex flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111111]"
    >
      <div
        style={{ width: EXPLORER_CELL_WIDTH, height: EXPLORER_ICON_SLOT }}
        className="relative flex items-center justify-center"
      >
        <SelectionBackdrop isSelected={isSelected} />
        <div className="relative z-[1]">
          {isRestarting ? (
            <div className="flex h-16 w-16 items-center justify-center animate-spin">
              <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white" />
            </div>
          ) : isFolder ? (
            <FolderIcon size={FOLDER_ICON_SIZE} />
          ) : (
            <FileIcon kind={node.kind} size={FILE_ICON_SIZE} />
          )}
        </div>
        {serverStatus && <ServerStatusDot status={serverStatus} />}
      </div>

      <span
        className={[
          "mt-1.5 max-w-[104px] text-center text-[12px] leading-[1.25] font-medium",
          "line-clamp-2 transition-colors duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
          isSelected ? "text-white font-semibold" : "text-neutral-300",
        ].join(" ")}
        title={node.type === "folder" ? node.subtitle ?? node.name : node.name}
      >
        {node.name}
      </span>
      {node.type === "folder" && node.subtitle && (
        <span className="mt-0.5 max-w-[104px] truncate text-center text-[10px] text-neutral-500">
          {node.subtitle}
        </span>
      )}
    </button>
  );
}

interface ContextMenuProps {
  x: number;
  y: number;
  node: FileSystemNode;
  isRootView: boolean;
  onClose: () => void;
  onAction: (action: "logs" | "restart" | "terminal", node: FileSystemNode) => void;
}

function ContextMenu({ x, y, node, isRootView, onClose, onAction }: ContextMenuProps) {
  useEffect(() => {
    const handleClose = () => onClose();
    window.addEventListener("click", handleClose);
    return () => window.removeEventListener("click", handleClose);
  }, [onClose]);

  const isFolder = node.type === "folder";

  return (
    <div
      style={{ top: y, left: x }}
      className="fixed z-50 min-w-[180px] rounded-lg border border-white/[0.08] bg-[#1a1a1c]/90 p-1 shadow-[0_4px_16px_rgba(0,0,0,0.4)] backdrop-blur-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {isRootView && isFolder && (
        <>
          <div className="px-2.5 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-wider select-none">
            PM2 Actions
          </div>
          <button
            onClick={() => {
              onAction("logs", node);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12px] font-medium text-neutral-200 hover:bg-white/5 hover:text-white cursor-pointer"
          >
            <Terminal className="h-3.5 w-3.5" />
            View Live Logs
          </button>
          <button
            onClick={() => {
              onAction("restart", node);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12px] font-medium text-[#ff453a] hover:bg-[#ff453a]/10 cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Redeploy (Restart)
          </button>
          <div className="my-1 border-t border-white/[0.06]" />
        </>
      )}

      <div className="px-2.5 py-1 text-[10px] font-bold text-neutral-500 uppercase tracking-wider select-none">
        Shell Actions
      </div>
      <button
        onClick={() => {
          onAction("terminal", node);
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12px] font-medium text-neutral-200 hover:bg-white/5 hover:text-white cursor-pointer"
      >
        <Terminal className="h-3.5 w-3.5" />
        {isFolder ? "Open in Terminal" : "Open Parent in Terminal"}
      </button>
    </div>
  );
}

export function ExplorerGrid({
  items,
  selectedId,
  isRootView,
  onSelect,
  onOpen,
}: {
  items: FileSystemNode[];
  selectedId: string | null;
  isRootView: boolean;
  onSelect: (id: string) => void;
  onOpen: (node: FileSystemNode) => void;
}) {
  const addTab = useServerTabsStore((state) => state.addTab);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileSystemNode;
  } | null>(null);
  const [restartingId, setRestartingId] = useState<string | null>(null);

  const handleContextMenu = (e: React.MouseEvent, node: FileSystemNode) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
    });
  };

  const handleAction = async (action: "logs" | "restart" | "terminal", node: FileSystemNode) => {
    if (action === "logs") {
      const termId = `logs-${node.name}-${Date.now()}`;
      addTab({
        type: "terminal",
        id: termId,
        title: `Logs: ${node.name}`,
        startupCommand: `pm2 logs ${node.name} --lines 100\n`,
      });
    } else if (action === "terminal") {
      const isFolder = node.type === "folder";
      let targetPath = node.remotePath;
      if (!isFolder) {
        const lastSlashIndex = node.remotePath.lastIndexOf('/');
        targetPath = lastSlashIndex > 0 ? node.remotePath.substring(0, lastSlashIndex) : "/";
      }

      const termId = `terminal-${node.name}-${Date.now()}`;
      const escapedPath = targetPath.replace(/"/g, '\\"');

      addTab({
        type: "terminal",
        id: termId,
        title: isFolder ? `Terminal (${node.name})` : `Terminal (${node.name.split('.').slice(0, -1).join('.') || node.name})`,
        startupCommand: `cd "${escapedPath}"\n`,
      });
    } else if (action === "restart") {
      setRestartingId(node.id);
      try {
        await invoke("restart_pm2_process", { name: node.name });
      } catch (err) {
        alert(`Failed to restart ${node.name}: ${err}`);
      } finally {
        setRestartingId(null);
      }
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
        <p className="text-[13px] font-medium text-neutral-400">This folder is empty</p>
        <p className="mt-1 text-[11px] text-neutral-500">
          No files or folders to display
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid justify-items-center relative"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${EXPLORER_CELL_WIDTH}px, 1fr))`,
        columnGap: 24,
        rowGap: 28,
      }}
    >
      {items.map((node) => (
        <ExplorerItem
          key={node.id}
          node={node}
          isSelected={selectedId === node.id}
          isRestarting={restartingId === node.id}
          serverStatus={
            isRootView && node.type === "folder" ? node.status : undefined
          }
          onSelect={onSelect}
          onOpen={onOpen}
          onContextMenu={handleContextMenu}
        />
      ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          node={contextMenu.node}
          isRootView={isRootView}
          onClose={() => setContextMenu(null)}
          onAction={handleAction}
        />
      )}
    </div>
  );
}
