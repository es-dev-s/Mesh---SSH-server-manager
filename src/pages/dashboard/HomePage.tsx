import { useSshMonitor, useSshStore } from "../../hooks/useSshMonitor";
import { ConnectionPanel, ConnectionStatusBadge } from "./ConnectionStatusBadge";
import { DashboardPlaceholder, DeviceDashboard } from "./DeviceDashboard";

export function HomePage() {
  useSshMonitor();
  const snapshot = useSshStore((state) => state.snapshot);
  const endpoint = `${snapshot.user}@${snapshot.host}:${snapshot.port}`;
  const hasMetrics = snapshot.specs && snapshot.storage;
  const isLive = snapshot.state === "connected";

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.08em] text-[#007AFF] uppercase">
            Dashboard
          </p>
          <h2 className="mt-1 text-[24px] font-semibold tracking-tight text-neutral-900">
            {snapshot.name}
          </h2>
          <p className="mt-1 text-[13px] text-neutral-500">{endpoint}</p>
        </div>

        <ConnectionStatusBadge state={snapshot.state} />
      </div>

      <div className="mt-5">
        <ConnectionPanel snapshot={snapshot} />
      </div>

      <div className="mt-6 min-h-0 flex-1">
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
