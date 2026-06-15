import type { ServerStatus } from "./server-file-system";

const statusConfig: Record<
  ServerStatus,
  { label: string; dot: string; ring: string }
> = {
  live: {
    label: "Live",
    dot: "#34D399",
    ring: "rgba(52,211,153,0.22)",
  },
  offline: {
    label: "Offline",
    dot: "#737373",
    ring: "rgba(115,115,115,0.15)",
  },
};

export function StatusIndicator({
  status,
  size = "md",
}: {
  status: ServerStatus;
  size?: "sm" | "md";
}) {
  const config = statusConfig[status];
  const dotSize = size === "sm" ? 6 : 7;
  const badgeSize = size === "sm" ? 14 : 18;

  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full bg-[#1c1c1e] shadow-[0_2px_8px_rgba(0,0,0,0.3)] ring-1 ring-white/[0.08] backdrop-blur-sm"
      style={{ width: badgeSize, height: badgeSize }}
    >
      <span
        className="rounded-full"
        style={{
          width: dotSize,
          height: dotSize,
          backgroundColor: config.dot,
          boxShadow: `0 0 0 2px ${config.ring}`,
        }}
      />
    </span>
  );
}

export function ServerStatusDot({ status }: { status: ServerStatus }) {
  const config = statusConfig[status];

  return (
    <span
      aria-label={`Server ${config.label.toLowerCase()}`}
      title={config.label}
      className="absolute right-[10px] bottom-[6px] z-[2]"
    >
      <StatusIndicator status={status} size="md" />
    </span>
  );
}

export function StatusChip({
  status,
  count,
}: {
  status: ServerStatus;
  count: number;
}) {
  const config = statusConfig[status];

  return (
    <span className="flex items-center gap-1.5 px-0.5">
      <StatusIndicator status={status} size="sm" />
      <span className="text-[11px] font-medium tracking-tight text-neutral-400">
        <span className="tabular-nums text-neutral-200">{count}</span>
        <span className="ml-1 text-neutral-500">{config.label}</span>
      </span>
    </span>
  );
}

export function ServerStatusSummary({
  liveCount,
  offlineCount,
}: {
  liveCount: number;
  offlineCount: number;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-white/[0.04] px-2.5 py-1 border border-white/[0.02] shadow-[0_2px_10px_rgba(0,0,0,0.2)] ring-1 ring-white/[0.06] backdrop-blur-sm">
      <StatusChip status="live" count={liveCount} />
      <span aria-hidden className="h-3 w-px bg-white/[0.08]" />
      <StatusChip status="offline" count={offlineCount} />
    </div>
  );
}
