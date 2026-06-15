import { ExplorerGrid } from "./ExplorerGrid";
import { useServerExplorer } from "./useServerExplorer";
import { AppLogo } from "../../components/brand/AppLogo";
import type { FileSystemNode } from "./server-file-system";
import { useServerTabsStore } from "../../stores/useServerTabsStore";
import { ServerTerminal } from "./ServerTerminal";
import { ServerEditor } from "./ServerEditor";
import { Folder, Terminal, FileCode, X, Plus } from "lucide-react";

export function ServerPage() {
  const {
    items,
    selectedId,
    setSelectedId,
    openFolder,
    loading,
    error,
    isRootView,
    isConnected,
  } = useServerExplorer();

  const { tabs, activeTabIndex, addTab, closeTab, setActiveTabIndex } = useServerTabsStore();

  function handleOpen(node: FileSystemNode) {
    if (node.type === "folder") {
      openFolder(node);
    } else if (node.type === "file") {
      addTab({
        type: "editor",
        path: node.remotePath,
        name: node.name,
      });
    }
  }

  const activeTab = tabs[activeTabIndex] || { type: "explorer" };

  const handleNewTerminal = () => {
    const termId = `terminal-${Date.now()}`;
    addTab({
      type: "terminal",
      id: termId,
    });
  };

  return (
    <div className="flex h-full flex-col bg-[#111111]">
      {/* VS Code style Tab Bar */}
      <div className="flex h-[36px] items-center justify-between border-b border-white/[0.06] bg-[#161617]/95 px-4 select-none">
        <div className="flex h-full items-end gap-0.5 overflow-x-auto scrollbar-none">
          {tabs.map((tab, idx) => {
            const isActive = idx === activeTabIndex;
            return (
              <div
                key={tab.type === "explorer" ? "explorer" : tab.type === "terminal" ? tab.id : tab.path}
                onClick={() => setActiveTabIndex(idx)}
                className={[
                  "group relative flex h-[32px] items-center gap-2 rounded-t-md px-3 text-[12px] font-medium transition-all duration-200 border-x border-t border-transparent cursor-pointer",
                  isActive
                    ? "bg-[#111111] text-[#f8f9fa] border-white/[0.06] shadow-[0_-2px_6px_rgba(0,0,0,0.15)]"
                    : "bg-[#161617] text-neutral-400 hover:bg-[#1a1a1c] hover:text-neutral-200",
                ].join(" ")}
              >
                {/* Icon */}
                {tab.type === "explorer" && <Folder className="h-3.5 w-3.5" />}
                {tab.type === "terminal" && <Terminal className="h-3.5 w-3.5" />}
                {tab.type === "editor" && <FileCode className="h-3.5 w-3.5" />}

                {/* Title */}
                <span className="truncate max-w-[120px]">
                  {tab.type === "explorer"
                    ? "File Explorer"
                    : tab.type === "terminal"
                    ? tab.title || "Terminal"
                    : tab.name}
                </span>

                {/* Dirty state indicator / close button */}
                {tab.type !== "explorer" && (
                  <div className="flex h-4 w-4 items-center justify-center rounded-sm hover:bg-white/10 active:scale-90 transition-all">
                    {tab.type === "editor" && tab.isDirty ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 group-hover:hidden" />
                    ) : null}
                    <X
                      className={[
                        "h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity",
                        tab.type === "editor" && tab.isDirty ? "hidden group-hover:block" : "",
                      ].join(" ")}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(idx);
                      }}
                    />
                  </div>
                )}

                {/* Bottom line glow for active tab */}
                {isActive && (
                  <div className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-[#f8f9fa] z-10" />
                )}
              </div>
            );
          })}
        </div>

        {/* Action button */}
        <button
          onClick={handleNewTerminal}
          title="New Terminal"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10 active:scale-95 text-neutral-400 hover:text-neutral-200 cursor-pointer transition-all"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Page Content Panel Router */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab.type === "explorer" && (
          <div
            className="h-full w-full overflow-y-auto px-6 py-6"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedId(null);
              }
            }}
          >
            {loading ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
                <AppLogo size="lg" className="mb-4" />
                <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <p className="text-[13px] font-medium text-neutral-400">Loading server files…</p>
              </div>
            ) : error ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
                <AppLogo size="lg" className="mb-4 opacity-80" />
                <p className="text-[14px] font-semibold text-[#f8f9fa]">
                  {isConnected ? "Unable to browse this location" : "Server not connected"}
                </p>
                <p className="mt-2 max-w-md text-[13px] leading-relaxed text-neutral-400">{error}</p>
              </div>
            ) : (
              <ExplorerGrid
                items={items}
                selectedId={selectedId}
                isRootView={isRootView}
                onSelect={setSelectedId}
                onOpen={handleOpen}
              />
            )}
          </div>
        )}

        {activeTab.type === "terminal" && (
          <div className="h-full w-full p-4">
            <ServerTerminal id={activeTab.id} startupCommand={activeTab.startupCommand} />
          </div>
        )}

        {activeTab.type === "editor" && (
          <div className="h-full w-full p-4">
            <ServerEditor path={activeTab.path} name={activeTab.name} />
          </div>
        )}
      </div>
    </div>
  );
}
