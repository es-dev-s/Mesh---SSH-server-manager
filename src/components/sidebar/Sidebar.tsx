import type { CSSProperties } from "react";
import {
  RAIL_ITEM_GAP,
  RAIL_PADDING_X,
  SIDEBAR_PANEL_WIDTH,
  SIDEBAR_RAIL_WIDTH,
} from "../../lib/layout";
import { useNavigationStore } from "../../stores/useNavigationStore";
import { useSidebarStore } from "../../stores/useSidebarStore";
import { sidebarNavItems } from "./sidebar-data";
import { PanelNavItem, RailNavItem } from "./SidebarNavItems";

function SidebarRail() {
  const activePageId = useNavigationStore((state) => state.activePageId);
  const setPage = useNavigationStore((state) => state.setPage);

  return (
    <nav
      aria-label="Primary"
      style={{ paddingLeft: RAIL_PADDING_X, paddingRight: RAIL_PADDING_X, paddingTop: 12 }}
      className="flex h-full w-[var(--sidebar-rail-width)] shrink-0 flex-col border-r border-white/[0.06] bg-[#181818]/90 backdrop-blur-xl"
    >
      <div
        className="flex flex-col"
        style={{ gap: RAIL_ITEM_GAP }}
      >
        {sidebarNavItems.map((item) => (
          <RailNavItem
            key={item.id}
            item={item}
            isActive={activePageId === item.id}
            onSelect={setPage}
          />
        ))}
      </div>
    </nav>
  );
}

function SidebarPanel() {
  const isExpanded = useSidebarStore((state) => state.isExpanded);
  const activePageId = useNavigationStore((state) => state.activePageId);
  const setPage = useNavigationStore((state) => state.setPage);

  return (
    <div
      data-sidebar-panel
      aria-hidden={!isExpanded}
      style={{ width: isExpanded ? SIDEBAR_PANEL_WIDTH : 0 }}
      className={[
        "absolute top-0 bottom-0 left-[var(--sidebar-rail-width)] z-30 overflow-hidden bg-[#1c1c1e]/95 shadow-[6px_0_24px_-10px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-[width] duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
        isExpanded ? "border-r border-white/[0.06]" : "",
      ].join(" ")}
    >
      <div
        style={{ width: SIDEBAR_PANEL_WIDTH, paddingTop: 16 }}
        className="flex h-full flex-col"
      >
        <div
          className="flex flex-col pb-3"
          style={{ gap: RAIL_ITEM_GAP }}
        >
          {sidebarNavItems.map((item) => (
            <PanelNavItem
              key={item.id}
              label={item.label}
              isActive={activePageId === item.id}
              onClick={() => setPage(item.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <div
      data-sidebar
      style={
        {
          "--sidebar-rail-width": `${SIDEBAR_RAIL_WIDTH}px`,
          width: SIDEBAR_RAIL_WIDTH,
        } as CSSProperties
      }
      className="relative h-full shrink-0"
      onClick={(event) => event.stopPropagation()}
    >
      <SidebarRail />
      <SidebarPanel />
    </div>
  );
}
