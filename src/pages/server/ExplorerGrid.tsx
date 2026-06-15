import type { FileSystemNode, ServerStatus } from "./server-file-system";
import { FileIcon } from "./FileIcon";
import { FolderIcon } from "./FolderIcon";
import { ServerStatusDot } from "./ServerStatus";

export const EXPLORER_CELL_WIDTH = 112;
export const EXPLORER_ICON_SLOT = 80;
export const FOLDER_ICON_SIZE = 64;
export const FILE_ICON_SIZE = 58;

function SelectionBackdrop({ isSelected }: { isSelected: boolean }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1 inset-y-2 rounded-[10px] bg-[#007AFF]/[0.14] transition-opacity duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
        style={{ opacity: isSelected ? 1 : 0 }}
      />
      <span
        aria-hidden
        className={[
          "pointer-events-none absolute inset-x-1 inset-y-2 rounded-[10px] bg-black/[0.04]",
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
  onSelect,
  onOpen,
}: {
  node: FileSystemNode;
  isSelected: boolean;
  serverStatus?: ServerStatus;
  onSelect: (id: string) => void;
  onOpen: (node: FileSystemNode) => void;
}) {
  const isFolder = node.type === "folder";

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      onDoubleClick={() => {
        if (isFolder) {
          onOpen(node);
        }
      }}
      aria-pressed={isSelected}
      style={{ width: EXPLORER_CELL_WIDTH }}
      className="group flex flex-col items-center outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f5f7]"
    >
      <div
        style={{ width: EXPLORER_CELL_WIDTH, height: EXPLORER_ICON_SLOT }}
        className="relative flex items-center justify-center"
      >
        <SelectionBackdrop isSelected={isSelected} />
        <div className="relative z-[1]">
          {isFolder ? (
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
          isSelected ? "text-neutral-900" : "text-neutral-700",
        ].join(" ")}
        title={node.type === "folder" ? node.subtitle ?? node.name : node.name}
      >
        {node.name}
      </span>
      {node.type === "folder" && node.subtitle && (
        <span className="mt-0.5 max-w-[104px] truncate text-center text-[10px] text-neutral-400">
          {node.subtitle}
        </span>
      )}
    </button>
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
  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
        <p className="text-[13px] font-medium text-neutral-500">This folder is empty</p>
        <p className="mt-1 text-[11px] text-neutral-400">
          No files or folders to display
        </p>
      </div>
    );
  }

  return (
    <div
      className="grid justify-items-center"
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
          serverStatus={
            isRootView && node.type === "folder" ? node.status : undefined
          }
          onSelect={onSelect}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
