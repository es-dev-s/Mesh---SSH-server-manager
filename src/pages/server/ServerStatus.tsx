import type { ServerStatus } from "./server-file-system";

const statusConfig: Record<
  ServerStatus,
  { label: string; dot: string; ring: string }
> = {
  live: {
    label: "Live",
    dot: "#30D158",
    ring: "rgba(48,209,88,0.22)",
  },
  offline: {
    label: "Offline",
    dot: "#AEAEB2",
    ring: "rgba(174,174,178,0.2)",
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
      className="relative flex shrink-0 items-center justify-center rounded-full bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.1)] ring-1 ring-black/[0.05] backdrop-blur-sm"
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
      <span className="text-[11px] font-medium tracking-tight text-neutral-600">
        <span className="tabular-nums text-neutral-800">{count}</span>
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
    <div className="flex items-center gap-2 rounded-full bg-white/70 px-2.5 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-sm">
      <StatusChip status="live" count={liveCount} />
      <span aria-hidden className="h-3 w-px bg-black/[0.07]" />
      <StatusChip status="offline" count={offlineCount} />
    </div>
  );
}
