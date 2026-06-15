import { ExplorerGrid } from "./ExplorerGrid";
import { ExplorerToolbar } from "./ExplorerToolbar";
import { useServerExplorer } from "./useServerExplorer";
import { AppLogo } from "../../components/brand/AppLogo";
import type { FileSystemNode } from "./server-file-system";

export function ServerPage() {
  const {
    items,
    breadcrumbs,
    selectedId,
    setSelectedId,
    openFolder,
    goBack,
    navigateTo,
    isRootView,
    loading,
    error,
    currentRemotePath,
    pm2Processes,
    isConnected,
  } = useServerExplorer();

  function handleOpen(node: FileSystemNode) {
    if (node.type === "folder") {
      openFolder(node);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ExplorerToolbar
        breadcrumbs={breadcrumbs}
        itemCount={items.length}
        canGoBack={breadcrumbs.length > 1}
        isRootView={isRootView}
        currentRemotePath={currentRemotePath}
        liveCount={pm2Processes.filter((process) => process.status === "online").length}
        offlineCount={pm2Processes.filter((process) => process.status !== "online").length}
        onGoBack={goBack}
        onNavigate={navigateTo}
      />

      <div
        className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setSelectedId(null);
          }
        }}
      >
        {loading ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <AppLogo size="lg" className="mb-4" />
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#007AFF]/20 border-t-[#007AFF]" />
            <p className="text-[13px] font-medium text-neutral-600">
              Loading server files…
            </p>
          </div>
        ) : error ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center">
            <AppLogo size="lg" className="mb-4 opacity-80" />
            <p className="text-[14px] font-semibold text-neutral-800">
              {isConnected ? "Unable to browse this location" : "Server not connected"}
            </p>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-neutral-500">
              {error}
            </p>
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
    </div>
  );
}
