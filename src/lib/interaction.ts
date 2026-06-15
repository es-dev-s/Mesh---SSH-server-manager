export const APPLE_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

const transition = [
  "transition-[background-color,color,opacity]",
  "duration-200",
  "ease-[cubic-bezier(0.25,0.1,0.25,1)]",
].join(" ");

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40 focus-visible:ring-offset-0";

export const chromeButtonClass = [
  "flex items-center justify-center rounded-[8px]",
  transition,
  "text-neutral-400",
  "hover:bg-black/[0.04] hover:text-neutral-600",
  "active:bg-black/[0.07]",
  focusRing,
].join(" ");

export const chromeButtonActiveClass = [
  "flex items-center justify-center rounded-[8px]",
  transition,
  "bg-black/[0.05] text-neutral-700",
  focusRing,
].join(" ");

export const railButtonClass = [
  "relative flex w-full items-center justify-center rounded-[10px]",
  transition,
  "text-neutral-500",
  "hover:bg-black/[0.035] hover:text-neutral-600",
  "active:bg-black/[0.06]",
  focusRing,
].join(" ");

export const railButtonActiveClass = [
  "relative flex w-full items-center justify-center rounded-[10px]",
  transition,
  "bg-black/[0.05] text-[#007AFF]",
  focusRing,
].join(" ");

export const panelButtonClass = [
  "relative flex w-full items-center rounded-[10px] text-left text-[13px] font-medium",
  transition,
  "text-neutral-600",
  "hover:bg-black/[0.035] hover:text-neutral-800",
  "active:bg-black/[0.06]",
  focusRing,
].join(" ");

export const panelButtonActiveClass = [
  "relative flex w-full items-center rounded-[10px] text-left text-[13px] font-medium",
  transition,
  "bg-black/[0.05] text-neutral-900",
  focusRing,
].join(" ");
