import { ChevronLeft, ChevronRight, PanelLeft } from "lucide-react";
import { AppLogo } from "./brand/AppLogo";
import {
  chromeButtonActiveClass,
  chromeButtonClass,
} from "../lib/interaction";
import { SIDEBAR_RAIL_WIDTH, TITLE_BAR_HEIGHT } from "../lib/layout";
import { getPageMeta } from "../pages/page-config";
import { useWindowDrag } from "../hooks/useWindowDrag";
import { useNavigationStore } from "../stores/useNavigationStore";
import { useSidebarStore } from "../stores/useSidebarStore";
import { WindowControls } from "./WindowControls";
import { useExplorerStore } from "../stores/useExplorerStore";
import { getBreadcrumbs } from "../pages/server/server-file-system";

export function TitleBar() {
  const { onMouseDown } = useWindowDrag();
  const isExpanded = useSidebarStore((state) => state.isExpanded);
  const toggle = useSidebarStore((state) => state.toggle);
  const activePageId = useNavigationStore((state) => state.activePageId);
  const pageTitle = getPageMeta(activePageId).title;

  const { pathStack, setPathStack, setSelectedId, items } = useExplorerStore();
  const breadcrumbs = getBreadcrumbs(pathStack);
  const canGoBack = activePageId === "server" && pathStack.length > 0;

  const handleGoBack = () => {
    setPathStack((prev) => prev.slice(0, -1));
    setSelectedId(null);
  };

  const handleNavigateTo = (index: number) => {
    if (index <= 0) {
      setPathStack([]);
    } else {
      setPathStack((prev) => prev.slice(0, index));
    }
    setSelectedId(null);
  };

  return (
    <header
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      style={{ height: TITLE_BAR_HEIGHT }}
      className="relative flex shrink-0 select-none items-center border-b border-white/[0.06] bg-[#161616]/90 pr-4 backdrop-blur-md"
    >
      {/* 56px Logo Box aligned with Sidebar Rail */}
      <div
        style={{ width: SIDEBAR_RAIL_WIDTH }}
        className="flex shrink-0 items-center justify-center border-r border-white/[0.06] h-full"
        data-no-drag="true"
      >
        <AppLogo size="sm" />
      </div>

      {/* Sidebar toggle button directly to the right of the logo box */}
      <div className="z-10 flex items-center gap-2 pl-3" data-no-drag="true">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggle();
          }}
          aria-label={isExpanded ? "Close sidebar" : "Open sidebar"}
          aria-expanded={isExpanded}
          title={isExpanded ? "Close sidebar" : "Open sidebar"}
          className={[
            "h-7 w-7",
            isExpanded ? chromeButtonActiveClass : chromeButtonClass,
          ].join(" ")}
        >
          <PanelLeft className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
        </button>

        {/* Dynamic Back button for Server Explorer */}
        {canGoBack && (
          <>
            <span className="h-4 w-px bg-white/[0.08]" />
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handleGoBack();
              }}
              aria-label="Back"
              title="Go back"
              className={["h-7 w-7", chromeButtonClass].join(" ")}
            >
              <ChevronLeft className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      <h1 className="pointer-events-none absolute inset-x-0 flex items-center justify-center text-center">
        {activePageId === "server" ? (
          <div
            className="flex flex-col items-center justify-center pointer-events-auto select-none"
            data-no-drag="true"
          >
            <nav className="flex items-center gap-1 text-[13px]">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={index} className="flex items-center gap-1 min-w-0">
                    {index > 0 && (
                      <ChevronRight className="h-3 w-3 text-white/20" strokeWidth={2} />
                    )}
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => handleNavigateTo(index)}
                      className={[
                        "truncate transition-colors duration-150 max-w-[120px]",
                        isLast
                          ? "cursor-default font-semibold text-[#f8f9fa]"
                          : "font-medium text-neutral-400 hover:text-white",
                      ].join(" ")}
                    >
                      {crumb.label}
                    </button>
                  </div>
                );
              })}
            </nav>
            <p className="text-[10px] text-neutral-500 mt-0.5 font-medium">
              {items.length} {items.length === 1 ? "item" : "items"} · Icon View
            </p>
          </div>
        ) : (
          <span className="text-[13px] font-semibold tracking-wider text-[#f8f9fa] uppercase">
            {pageTitle}
          </span>
        )}
      </h1>

      <div className="z-10 ml-auto">
        <WindowControls />
      </div>
    </header>
  );
}
