import { AlertCircle, Loader2, RefreshCw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import type { ConnectionState, SshSnapshot } from "../../types/ssh";

const stateConfig: Record<
  ConnectionState,
  {
    label: string;
    tone: "live" | "pending" | "error" | "idle";
    icon: typeof Wifi;
  }
> = {
  connected: {
    label: "Connected",
    tone: "live",
    icon: ShieldCheck,
  },
  connecting: {
    label: "Connecting",
    tone: "pending",
    icon: Loader2,
  },
  reconnecting: {
    label: "Reconnecting",
    tone: "pending",
    icon: RefreshCw,
  },
  disconnected: {
    label: "Offline",
    tone: "idle",
    icon: WifiOff,
  },
  misconfigured: {
    label: "Setup Required",
    tone: "error",
    icon: AlertCircle,
  },
};

const toneStyles = {
  live: {
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]",
    ring: "ring-emerald-400/20",
    text: "text-emerald-300",
    bg: "bg-emerald-950/[0.15]",
  },
  pending: {
    dot: "bg-white shadow-[0_0_8px_rgba(255,255,255,0.5)]",
    ring: "ring-white/20",
    text: "text-white",
    bg: "bg-white/[0.08]",
  },
  error: {
    dot: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]",
    ring: "ring-amber-400/20",
    text: "text-amber-300",
    bg: "bg-amber-950/[0.15]",
  },
  idle: {
    dot: "bg-neutral-500 shadow-[0_0_4px_rgba(115,115,115,0.3)]",
    ring: "ring-white/10",
    text: "text-neutral-400",
    bg: "bg-white/[0.04]",
  },
};

function formatRelativeTime(unixSeconds: string | null): string {
  if (!unixSeconds) return "—";
  const timestamp = Number(unixSeconds) * 1000;
  if (!Number.isFinite(timestamp)) return "—";

  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

export function ConnectionStatusBadge({ state }: { state: ConnectionState }) {
  const config = stateConfig[state];
  const styles = toneStyles[config.tone];
  const Icon = config.icon;
  const isAnimated = state === "connecting" || state === "reconnecting";

  return (
    <div
      className={`flex items-center gap-2.5 rounded-full px-3.5 py-1.5 ring-1 backdrop-blur-sm ${styles.bg} ${styles.ring}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Icon
            className={`h-3.5 w-3.5 ${styles.text} ${isAnimated ? "animate-spin" : ""}`}
            strokeWidth={2.25}
          />
          <p className={`text-[11px] font-semibold tracking-wide uppercase ${styles.text}`}>{config.label}</p>
        </div>
      </div>
    </div>
  );
}

export function ConnectionPanel({ snapshot }: { snapshot: SshSnapshot }) {
  const config = stateConfig[snapshot.state];
  const styles = toneStyles[config.tone];
  const endpoint = `${snapshot.user}@${snapshot.host}:${snapshot.port}`;
  const isPending =
    snapshot.state === "connecting" || snapshot.state === "reconnecting";

  return (
    <div className="overflow-hidden rounded-2xl bg-[#1c1c1e]/60 shadow-[0_4px_24px_rgba(0,0,0,0.25)] border border-white/[0.06] backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ring-1 ${styles.bg} ${styles.ring}`}
          >
            <Wifi className={`h-[18px] w-[18px] ${styles.text}`} strokeWidth={2} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[#f8f9fa]">
              Remote Device Session
            </p>
            <p className="text-[12px] text-neutral-400">{endpoint}</p>
          </div>
        </div>
        <ConnectionStatusBadge state={snapshot.state} />
      </div>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">
            Status
          </p>
          <p className="mt-1 text-[13px] font-medium text-neutral-200">
            {snapshot.statusMessage ?? config.label}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">
            Last Sync
          </p>
          <p className="mt-1 text-[13px] font-medium text-neutral-200">
            {formatRelativeTime(snapshot.lastUpdatedAt)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-[0.08em] text-neutral-500 uppercase">
            Resilience
          </p>
          <p className="mt-1 text-[13px] font-medium text-neutral-200">
            {snapshot.reconnectAttempts > 0
              ? `${snapshot.reconnectAttempts} recovery attempt${snapshot.reconnectAttempts === 1 ? "" : "s"}`
              : "Stable — auto-heal enabled"}
          </p>
        </div>
      </div>

      {snapshot.lastError && (
        <div className="mx-5 mb-4 rounded-xl border border-red-500/25 bg-red-950/[0.15] px-4 py-3">
          <p className="text-[10px] font-semibold tracking-wide text-red-400 uppercase">
            Connection Detail
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-red-200/90">
            {snapshot.lastError}
          </p>
        </div>
      )}

      {isPending && !snapshot.lastError && (
        <div className="mx-5 mb-4 flex items-center gap-2 rounded-xl bg-white/[0.04] px-4 py-3">
          <Loader2 className="h-4 w-4 animate-spin text-white" strokeWidth={2.25} />
          <p className="text-[12px] text-neutral-400">
            Maintaining persistent SSH session with automatic recovery…
          </p>
        </div>
      )}
    </div>
  );
}
