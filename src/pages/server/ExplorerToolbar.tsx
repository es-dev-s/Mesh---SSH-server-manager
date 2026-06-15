import { ChevronRight } from "lucide-react";
import { chromeButtonClass } from "../../lib/interaction";
import type { Breadcrumb } from "./server-file-system";
import { ServerStatusSummary } from "./ServerStatus";

export function ExplorerToolbar({
  breadcrumbs,
  itemCount,
  canGoBack,
  isRootView,
  currentRemotePath,
  liveCount,
  offlineCount,
  onGoBack,
  onNavigate,
}: {
  breadcrumbs: Breadcrumb[];
  itemCount: number;
  canGoBack: boolean;
  isRootView: boolean;
  currentRemotePath: string | null;
  liveCount: number;
  offlineCount: number;
  onGoBack: () => void;
  onNavigate: (pathIndex: number) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-black/[0.04] px-5 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={onGoBack}
            aria-label="Back"
            className={[
              "h-7 w-7 shrink-0",
              chromeButtonClass,
              !canGoBack ? "pointer-events-none opacity-30" : "",
            ].join(" ")}
          >
            <ChevronRight className="h-[15px] w-[15px] rotate-180" strokeWidth={2} />
          </button>

          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1 overflow-hidden"
          >
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;

              return (
                <div
                  key={`${crumb.id ?? "root"}-${index}`}
                  className="flex min-w-0 items-center gap-1"
                >
                  {index > 0 && (
                    <ChevronRight
                      className="h-3 w-3 shrink-0 text-neutral-300"
                      strokeWidth={2}
                    />
                  )}
                  <button
                    type="button"
                    disabled={isLast}
                    onClick={() => onNavigate(index)}
                    className={[
                      "truncate text-[13px] transition-colors duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
                      isLast
                        ? "cursor-default font-semibold text-neutral-900"
                        : "font-medium text-neutral-500 hover:text-neutral-800",
                    ].join(" ")}
                  >
                    {crumb.label}
                  </button>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {isRootView && (
            <ServerStatusSummary
              liveCount={liveCount}
              offlineCount={offlineCount}
            />
          )}
          <p className="text-[11px] text-neutral-400">
            {itemCount} {itemCount === 1 ? "item" : "items"} · Icon View
          </p>
        </div>
      </div>

      {!isRootView && currentRemotePath && (
        <p
          className="truncate pl-9 font-mono text-[11px] text-neutral-400"
          title={currentRemotePath}
        >
          {currentRemotePath}
        </p>
      )}
    </div>
  );
}
