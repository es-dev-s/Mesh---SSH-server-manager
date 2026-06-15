import {
  panelButtonActiveClass,
  panelButtonClass,
  railButtonActiveClass,
  railButtonClass,
} from "../../lib/interaction";
import { PANEL_ITEM_PADDING_X, PANEL_PADDING_X, RAIL_ROW_HEIGHT } from "../../lib/layout";
import type { PageId } from "../../pages/page-config";
import { useSidebarStore } from "../../stores/useSidebarStore";
import type { SidebarItem } from "./sidebar-data";
import { ActiveIndicator } from "./SidebarPrimitives";

const iconClass = "h-[17px] w-[17px] shrink-0";
const iconStroke = 1.75;

export function RailNavItem({
  item,
  isActive,
  onSelect,
}: {
  item: SidebarItem;
  isActive: boolean;
  onSelect: (pageId: PageId) => void;
}) {
  const isExpanded = useSidebarStore((state) => state.isExpanded);
  const Icon = item.icon;

  return (
    <button
      type="button"
      data-no-drag="true"
      onClick={() => onSelect(item.id)}
      title={!isExpanded ? item.label : undefined}
      aria-label={item.label}
      aria-current={isActive ? "page" : undefined}
      style={{ height: RAIL_ROW_HEIGHT }}
      className={isActive ? railButtonActiveClass : railButtonClass}
    >
      <ActiveIndicator isActive={isActive} />
      <Icon className={iconClass} strokeWidth={iconStroke} />
    </button>
  );
}

export function PanelNavItem({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <div style={{ paddingLeft: PANEL_PADDING_X, paddingRight: PANEL_PADDING_X }}>
      <button
        type="button"
        data-no-drag="true"
        onClick={onClick}
        aria-current={isActive ? "page" : undefined}
        style={{
          height: RAIL_ROW_HEIGHT,
          paddingLeft: PANEL_ITEM_PADDING_X,
          paddingRight: PANEL_ITEM_PADDING_X,
        }}
        className={isActive ? panelButtonActiveClass : panelButtonClass}
      >
        <ActiveIndicator isActive={isActive} />
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}
