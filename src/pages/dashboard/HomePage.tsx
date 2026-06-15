import { useSshStore } from "../../hooks/useSshMonitor";
import { ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { DashboardPlaceholder, DeviceDashboard } from "./DeviceDashboard";

export function HomePage() {
  const snapshot = useSshStore((state) => state.snapshot);
  const hasMetrics = snapshot.specs && snapshot.storage;
  const isLive = snapshot.state === "connected";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[20px] font-semibold tracking-tight text-[#f8f9fa]">
          {snapshot.name}
        </h2>
        <ConnectionStatusBadge state={snapshot.state} />
      </div>

      <div className="mt-5 min-h-0 flex-1">
        {hasMetrics ? (
          <div className="space-y-3">
            {!isLive && (
              <p className="text-[12px] text-neutral-500">
                Showing last known metrics while the session recovers…
              </p>
            )}
            <DeviceDashboard
              specs={snapshot.specs!}
              storage={snapshot.storage!}
              pm2={snapshot.pm2}
              stale={!isLive}
            />
          </div>
        ) : (
          <DashboardPlaceholder
            title={
              snapshot.state === "misconfigured"
                ? "SSH setup required"
                : snapshot.state === "connected"
                  ? "Loading device metrics"
                  : "Establishing secure connection"
            }
            description={
              snapshot.lastError ??
              snapshot.statusMessage ??
              "The connection manager will authenticate, collect device specs, and populate this dashboard automatically."
            }
            loading={snapshot.state === "connecting" || snapshot.state === "reconnecting"}
          />
        )}
      </div>
    </div>
  );
}
