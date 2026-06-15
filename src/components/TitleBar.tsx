import { PanelLeft } from "lucide-react";
import { AppLogo } from "./brand/AppLogo";
import {
  chromeButtonActiveClass,
  chromeButtonClass,
} from "../lib/interaction";
import { TITLE_BAR_HEIGHT } from "../lib/layout";
import { getPageMeta } from "../pages/page-config";
import { useWindowDrag } from "../hooks/useWindowDrag";
import { useNavigationStore } from "../stores/useNavigationStore";
import { useSidebarStore } from "../stores/useSidebarStore";
import { WindowControls } from "./WindowControls";

export function TitleBar() {
  const { onMouseDown } = useWindowDrag();
  const isExpanded = useSidebarStore((state) => state.isExpanded);
  const toggle = useSidebarStore((state) => state.toggle);
  const activePageId = useNavigationStore((state) => state.activePageId);
  const pageTitle = getPageMeta(activePageId).title;

  return (
    <header
      data-tauri-drag-region
      onMouseDown={onMouseDown}
      style={{ height: TITLE_BAR_HEIGHT }}
      className="relative flex shrink-0 select-none items-center border-b border-black/[0.06] bg-[#f5f5f7] px-4"
    >
      <button
        type="button"
        data-no-drag="true"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-label={isExpanded ? "Close sidebar" : "Open sidebar"}
        aria-expanded={isExpanded}
        title={isExpanded ? "Close sidebar" : "Open sidebar"}
        className={[
          "z-10 h-7 w-7",
          isExpanded ? chromeButtonActiveClass : chromeButtonClass,
        ].join(" ")}
      >
        <PanelLeft className="h-[15px] w-[15px] shrink-0" strokeWidth={1.75} />
      </button>

      <h1 className="pointer-events-none absolute inset-x-0 flex items-center justify-center gap-2 text-center">
        <AppLogo size="xs" imageClassName="rounded-[6px]" />
        <span className="text-[13px] font-semibold text-neutral-800">{pageTitle}</span>
      </h1>

      <div
        className="z-10 ml-auto"
        data-no-drag="true"
        onClick={(event) => event.stopPropagation()}
      >
        <WindowControls />
      </div>
    </header>
  );
}
