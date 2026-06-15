export const APPLE_EASE = "cubic-bezier(0.25, 0.1, 0.25, 1)";

const transition = [
  "transition-[background-color,color,opacity]",
  "duration-200",
  "ease-[cubic-bezier(0.25,0.1,0.25,1)]",
].join(" ");

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-0";

export const chromeButtonClass = [
  "flex items-center justify-center rounded-[8px]",
  transition,
  "text-neutral-400",
  "hover:bg-white/[0.06] hover:text-neutral-200",
  "active:bg-white/[0.1]",
  focusRing,
].join(" ");

export const chromeButtonActiveClass = [
  "flex items-center justify-center rounded-[8px]",
  transition,
  "bg-white/[0.1] text-white",
  focusRing,
].join(" ");

export const railButtonClass = [
  "relative flex w-full items-center justify-center rounded-[10px]",
  transition,
  "text-neutral-400",
  "hover:bg-white/[0.05] hover:text-neutral-200",
  "active:bg-white/[0.08]",
  focusRing,
].join(" ");

export const railButtonActiveClass = [
  "relative flex w-full items-center justify-center rounded-[10px]",
  transition,
  "bg-white/[0.08] text-white border border-white/[0.05] shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
  focusRing,
].join(" ");

export const panelButtonClass = [
  "relative flex w-full items-center rounded-[10px] text-left text-[13px] font-medium",
  transition,
  "text-neutral-400",
  "hover:bg-white/[0.04] hover:text-white",
  "active:bg-white/[0.08]",
  focusRing,
].join(" ");

export const panelButtonActiveClass = [
  "relative flex w-full items-center rounded-[10px] text-left text-[13px] font-medium",
  transition,
  "bg-white/[0.08] text-white border border-white/[0.05] shadow-[0_1px_2px_rgba(0,0,0,0.15)]",
  focusRing,
].join(" ");
