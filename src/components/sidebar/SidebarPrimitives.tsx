import { APPLE_EASE } from "../../lib/interaction";

export function ActiveIndicator({ isActive }: { isActive: boolean }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-[#007AFF]"
      style={{
        opacity: isActive ? 1 : 0,
        transition: `opacity 200ms ${APPLE_EASE}`,
      }}
    />
  );
}
