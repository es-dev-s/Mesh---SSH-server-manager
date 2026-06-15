import {
  formatBytes,
  formatPercent,
  formatUptime,
} from "../../hooks/useSshMonitor";
import { AppLogo } from "../../components/brand/AppLogo";
import type { DeviceSpecs, Pm2Summary, StorageSummary } from "../../types/ssh";
import { Pm2Panel } from "./Pm2Panel";

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/80 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-sm">
      <p className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
        {label}
      </p>
      <p className="mt-2 text-[20px] font-semibold tracking-tight text-neutral-900">
        {value}
      </p>
      {detail && (
        <p className="mt-1 text-[12px] text-neutral-500">{detail}</p>
      )}
    </div>
  );
}

function StorageOverview({ storage }: { storage: StorageSummary }) {
  const usedPercent = Math.min(
    Math.max(storage.filesystemUsedPercent, 0),
    100,
  );
  const hasPhysical = storage.physicalTotalBytes > 0;

  return (
    <div className="rounded-2xl bg-white/80 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
            Total Storage
          </p>
          <p className="mt-2 text-[26px] font-semibold tracking-tight text-neutral-900">
            {formatBytes(storage.filesystemUsedBytes)}
            <span className="text-[15px] font-medium text-neutral-400">
              {" "}
              used of {formatBytes(storage.filesystemTotalBytes)}
            </span>
          </p>
          <p className="mt-1 text-[12px] text-neutral-500">
            Across {storage.volumes.length} mounted volume
            {storage.volumes.length === 1 ? "" : "s"} on the server
          </p>
        </div>
        <p className="text-[14px] font-semibold text-[#007AFF]">
          {formatPercent(usedPercent)} used
        </p>
      </div>

      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-[#007AFF]/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#5AC8FA] to-[#007AFF] transition-[width] duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
          style={{ width: `${usedPercent}%` }}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-neutral-50/80 px-3.5 py-3">
          <p className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
            Available
          </p>
          <p className="mt-1 text-[15px] font-semibold text-neutral-900">
            {formatBytes(storage.filesystemAvailableBytes)}
          </p>
        </div>
        <div className="rounded-xl bg-neutral-50/80 px-3.5 py-3">
          <p className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
            Filesystem Total
          </p>
          <p className="mt-1 text-[15px] font-semibold text-neutral-900">
            {formatBytes(storage.filesystemTotalBytes)}
          </p>
        </div>
        <div className="rounded-xl bg-neutral-50/80 px-3.5 py-3">
          <p className="text-[10px] font-semibold tracking-wide text-neutral-400 uppercase">
            Physical Disks
          </p>
          <p className="mt-1 text-[15px] font-semibold text-neutral-900">
            {hasPhysical
              ? formatBytes(storage.physicalTotalBytes)
              : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

function VolumeList({ volumes }: { volumes: StorageSummary["volumes"] }) {
  const sorted = [...volumes].sort((a, b) => b.totalBytes - a.totalBytes);

  return (
    <div className="rounded-2xl bg-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-sm">
      <div className="border-b border-black/[0.04] px-5 py-4">
        <p className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
          Storage Volumes
        </p>
        <p className="mt-1 text-[13px] text-neutral-500">
          All mounted filesystems on this server
        </p>
      </div>

      <div className="divide-y divide-black/[0.04]">
        {sorted.map((volume) => {
          const usedPercent = Math.min(Math.max(volume.usedPercent, 0), 100);

          return (
            <div
              key={`${volume.filesystem}-${volume.mountPoint}`}
              className="px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-neutral-900">
                    {volume.mountPoint}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-neutral-500">
                    {volume.filesystem}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold text-neutral-800">
                    {formatBytes(volume.usedBytes)} /{" "}
                    {formatBytes(volume.totalBytes)}
                  </p>
                  <p className="text-[11px] text-neutral-400">
                    {formatBytes(volume.availableBytes)} free ·{" "}
                    {formatPercent(usedPercent)}
                  </p>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full bg-[#007AFF]/70"
                  style={{ width: `${usedPercent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DeviceDashboard({
  specs,
  storage,
  pm2,
  stale = false,
}: {
  specs: DeviceSpecs;
  storage: StorageSummary;
  pm2: Pm2Summary | null;
  stale?: boolean;
}) {
  const memoryPercent =
    specs.memoryTotalBytes > 0
      ? (specs.memoryUsedBytes / specs.memoryTotalBytes) * 100
      : 0;
  const swapPercent =
    specs.swapTotalBytes > 0
      ? (specs.swapUsedBytes / specs.swapTotalBytes) * 100
      : 0;

  return (
    <div className={`space-y-4 ${stale ? "opacity-80" : ""}`}>
      <StorageOverview storage={storage} />
      {pm2 && <Pm2Panel pm2={pm2} />}
      <VolumeList volumes={storage.volumes} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Hostname"
          value={specs.hostname}
          detail={specs.architecture}
        />
        <MetricCard
          label="Operating System"
          value={specs.osName}
          detail={specs.kernel}
        />
        <MetricCard
          label="Processor"
          value={`${specs.cpuCores} cores · ${specs.cpuThreads} threads`}
          detail={specs.cpuModel}
        />
        <MetricCard
          label="Memory (RAM)"
          value={formatBytes(specs.memoryUsedBytes)}
          detail={`${formatPercent(memoryPercent)} of ${formatBytes(specs.memoryTotalBytes)} · ${formatBytes(specs.memoryAvailableBytes)} free`}
        />
        <MetricCard
          label="Swap"
          value={
            specs.swapTotalBytes > 0
              ? formatBytes(specs.swapUsedBytes)
              : "Not configured"
          }
          detail={
            specs.swapTotalBytes > 0
              ? `${formatPercent(swapPercent)} of ${formatBytes(specs.swapTotalBytes)}`
              : undefined
          }
        />
        <MetricCard
          label="Uptime"
          value={formatUptime(specs.uptimeSeconds)}
          detail="Since last boot"
        />
        <MetricCard
          label="Load Average"
          value={specs.loadAverage1m.toFixed(2)}
          detail={`5m ${specs.loadAverage5m.toFixed(2)} · 15m ${specs.loadAverage15m.toFixed(2)}`}
        />
      </div>
    </div>
  );
}

export function DashboardPlaceholder({
  title,
  description,
  loading = false,
}: {
  title: string;
  description: string;
  loading?: boolean;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-black/[0.08] bg-white/45 px-6 text-center">
      <AppLogo size="lg" className="mb-4" />
      {loading && (
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-[#007AFF]/20 border-t-[#007AFF]" />
      )}
      <p className="text-[15px] font-semibold text-neutral-800">{title}</p>
      <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-neutral-500">
        {description}
      </p>
    </div>
  );
}
