import { useState, useEffect } from "react";
import {
  formatBytes,
  formatUptime,
} from "../../hooks/useSshMonitor";
import { AppLogo } from "../../components/brand/AppLogo";
import type { DeviceSpecs, Pm2Summary, StorageSummary } from "../../types/ssh";
import { Pm2Panel } from "./Pm2Panel";
import { Activity, Server, Cpu, HardDrive } from "lucide-react";

interface TelemetryChartProps {
  history: number[];
  title: string;
  subtitle: string;
  value: string;
  colorClass: string;
  gradientId: string;
  strokeColor: string;
  stopColor: string;
}

function TelemetryChart({
  history,
  title,
  subtitle,
  value,
  colorClass,
  gradientId,
  strokeColor,
  stopColor,
}: TelemetryChartProps) {
  // SVG drawing configuration
  const width = 300;
  const height = 80;
  const maxVal = 100;
  const minVal = 0;

  // Safeguard if history is empty
  const data = history.length > 0 ? history : Array(15).fill(0);

  // Map values to coordinates
  const points = data.map((val, idx) => {
    const x = idx * (width / (data.length - 1));
    const y = height - ((val - minVal) / (maxVal - minVal)) * (height - 15) - 5;
    return { x, y };
  });

  // Generate path coordinates
  const linePath = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = points.length > 0
    ? `${linePath} L ${width},${height} L 0,${height} Z`
    : "";

  const lastPoint = points[points.length - 1] || { x: 0, y: 0 };

  return (
    <div className="bg-white/[0.01] border border-white/[0.04] rounded-xl p-4 flex flex-col justify-between">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">{title}</span>
          <p className="text-[20px] font-bold text-[#f8f9fa] tracking-tight mt-0.5">{value}</p>
        </div>
        <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${colorClass}`}>
          {subtitle}
        </span>
      </div>

      {/* SVG Chart area */}
      <div className="relative h-[80px] w-full mt-4 select-none">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stopColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={stopColor} stopOpacity="0" />
            </linearGradient>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Dotted Grid lines */}
          <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="rgba(255,255,255,0.04)" strokeDasharray="3,3" />
          <line x1="0" y1={height * 0.5} x2={width} y2={height * 0.5} stroke="rgba(255,255,255,0.04)" strokeDasharray="3,3" />
          <line x1="0" y1={height * 0.75} x2={width} y2={height * 0.75} stroke="rgba(255,255,255,0.04)" strokeDasharray="3,3" />

          {/* Fill area */}
          {areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

          {/* Stroke line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={strokeColor}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Glowing cursor node at latest point */}
          <circle
            cx={lastPoint.x}
            cy={lastPoint.y}
            r="3"
            fill={strokeColor}
            filter="url(#glow)"
          />
        </svg>
      </div>
    </div>
  );
}

function ResourceTelemetryPanel({
  specs,
  memoryPercent,
  cpuHistory,
  ramHistory,
}: {
  specs: DeviceSpecs;
  memoryPercent: number;
  cpuHistory: number[];
  ramHistory: number[];
}) {
  const coreCount = Math.max(specs.cpuCores, 1);
  const cpuPercent1m = Math.min((specs.loadAverage1m / coreCount) * 100, 100);

  const getStatus = (percent: number) => {
    if (percent > 85) {
      return {
        text: "Critical",
        colorClass: "bg-red-500/10 text-red-400 border border-red-500/20",
        dot: "bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.4)]",
        statusText: "text-red-300",
      };
    }
    if (percent > 60) {
      return {
        text: "Warning",
        colorClass: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
        dot: "bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.4)]",
        statusText: "text-amber-300",
      };
    }
    return {
      text: "Optimal",
      colorClass: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
      dot: "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]",
      statusText: "text-emerald-300",
    };
  };

  const overallLoad = Math.max(cpuPercent1m, memoryPercent);
  const status = getStatus(overallLoad);

  return (
    <div className="rounded-2xl bg-[#1c1c1e]/60 p-5 shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-white/[0.06] backdrop-blur-md">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-neutral-400" />
          <div>
            <h3 className="text-[14px] font-semibold text-[#f8f9fa]">Real-time Telemetry</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">CPU load queue and physical RAM utilization history</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full animate-pulse ${status.dot}`} />
          <span className={`text-[10px] font-semibold tracking-wide uppercase ${status.statusText}`}>
            {status.text}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <TelemetryChart
          history={cpuHistory}
          title="CPU Utilization"
          subtitle={`${coreCount} cores active`}
          value={`${cpuPercent1m.toFixed(0)}%`}
          colorClass={getStatus(cpuPercent1m).colorClass}
          gradientId="cpuGrad"
          strokeColor="#ffffff"
          stopColor="#ffffff"
        />

        <TelemetryChart
          history={ramHistory}
          title="RAM Utilization"
          subtitle={`Free: ${formatBytes(specs.memoryAvailableBytes)}`}
          value={`${formatBytes(specs.memoryUsedBytes)} / ${formatBytes(specs.memoryTotalBytes)}`}
          colorClass={getStatus(memoryPercent).colorClass}
          gradientId="ramGrad"
          strokeColor="#0a84ff"
          stopColor="#0a84ff"
        />
      </div>
    </div>
  );
}

function HardwareSpecsPanel({ specs }: { specs: DeviceSpecs }) {
  return (
    <div className="rounded-2xl bg-[#1c1c1e]/60 p-5 shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-white/[0.06] backdrop-blur-md">
      <div className="border-b border-white/[0.06] pb-3 mb-4 flex items-center gap-2">
        <Server className="h-4 w-4 text-neutral-400" />
        <div>
          <h3 className="text-[14px] font-semibold text-[#f8f9fa]">Hardware Profile & OS Details</h3>
          <p className="text-[11px] text-neutral-400 mt-0.5">Core physical specifications and kernel metadata</p>
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Hostname</p>
          <p className="mt-0.5 text-[13px] font-semibold text-[#f8f9fa] truncate">{specs.hostname}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Architecture</p>
          <p className="mt-0.5 text-[13px] font-medium text-neutral-200 truncate">{specs.architecture}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Operating System</p>
          <p className="mt-0.5 text-[13px] font-medium text-neutral-200 truncate">{specs.osName}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Kernel</p>
          <p className="mt-0.5 text-[13px] font-medium text-neutral-200 truncate">{specs.kernel}</p>
        </div>
        <div className="sm:col-span-2 border-t border-b border-white/[0.04] py-3 my-1">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Cpu className="h-3.5 w-3.5 text-neutral-500" />
            <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Processor (CPU)</p>
          </div>
          <p className="text-[13px] font-semibold text-[#f8f9fa] truncate">{specs.cpuModel}</p>
          <p className="mt-0.5 text-[11px] text-neutral-400">{specs.cpuCores} Cores · {specs.cpuThreads} Threads active</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">System Uptime</p>
          <p className="mt-0.5 text-[13px] font-medium text-neutral-200">{formatUptime(specs.uptimeSeconds)}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Load Balance</p>
          <p className="mt-0.5 text-[13px] font-medium text-neutral-200 font-mono">
            {specs.loadAverage1m.toFixed(2)} · {specs.loadAverage5m.toFixed(2)} · {specs.loadAverage15m.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  );
}

function StorageTelemetryPanel({ storage }: { storage: StorageSummary }) {
  const usedPercent = Math.min(Math.max(storage.filesystemUsedPercent, 0), 100);
  const sortedVolumes = [...storage.volumes].sort((a, b) => b.totalBytes - a.totalBytes);

  // SVG Gauge calculations
  const r = 32;
  const circ = 2 * Math.PI * r;
  const strokeOffset = circ * (1 - usedPercent / 100);

  return (
    <div className="rounded-2xl bg-[#1c1c1e]/60 p-5 shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-white/[0.06] backdrop-blur-md">
      <div className="border-b border-white/[0.06] pb-3 mb-4 flex items-center gap-2">
        <HardDrive className="h-4 w-4 text-neutral-400" />
        <div>
          <h3 className="text-[14px] font-semibold text-[#f8f9fa]">Storage Telemetry</h3>
          <p className="text-[11px] text-neutral-400 mt-0.5">Physical disks and mounted partitions</p>
        </div>
      </div>

      {/* Global Storage Overview with Radial Gauge */}
      <div className="flex items-center gap-5 bg-white/[0.01] border border-white/[0.04] rounded-xl p-4 mb-5">
        <div className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center select-none">
          <svg className="h-full w-full rotate-[-90deg]">
            <circle
              cx="36"
              cy="36"
              r={r}
              fill="transparent"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="5.5"
            />
            <circle
              cx="36"
              cy="36"
              r={r}
              fill="transparent"
              stroke="#ffffff"
              strokeWidth="5.5"
              strokeDasharray={circ}
              strokeDashoffset={strokeOffset}
              strokeLinecap="round"
              className="transition-all duration-700 ease-[cubic-bezier(0.25,0.1,0.25,1)]"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-[13px] font-bold text-[#f8f9fa] tracking-tight">{usedPercent.toFixed(0)}%</span>
            <span className="text-[8px] font-semibold text-neutral-500 uppercase tracking-wide">used</span>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">Total Filesystem Space</p>
          <p className="mt-1 text-[16px] font-bold text-[#f8f9fa] tracking-tight">
            {formatBytes(storage.filesystemUsedBytes)}
          </p>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            used of {formatBytes(storage.filesystemTotalBytes)}
          </p>
          <p className="text-[10px] text-neutral-500 mt-1 font-medium">
            Available: {formatBytes(storage.filesystemAvailableBytes)}
          </p>
        </div>
      </div>

      {/* Volumes List */}
      <div>
        <h4 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider mb-2.5">Mounted Partitions</h4>
        <div className="space-y-2.5 max-h-[170px] overflow-y-auto pr-1">
          {sortedVolumes.map((volume) => {
            const volUsedPercent = Math.min(Math.max(volume.usedPercent, 0), 100);
            return (
              <div
                key={`${volume.filesystem}-${volume.mountPoint}`}
                className="bg-white/[0.01] border border-white/[0.04] rounded-lg p-2.5"
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-semibold text-[#f8f9fa] truncate">{volume.mountPoint}</p>
                    <p className="text-[9.5px] text-neutral-500 truncate mt-0.5">{volume.filesystem}</p>
                  </div>
                  <div className="text-right text-[10.5px] tabular-nums">
                    <span className="font-semibold text-neutral-200">
                      {formatBytes(volume.usedBytes)} / {formatBytes(volume.totalBytes)}
                    </span>
                    <p className="text-[9.5px] text-neutral-500 mt-0.5">
                      {volUsedPercent.toFixed(0)}% used
                    </p>
                  </div>
                </div>
                <div className="h-1 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-white/40"
                    style={{ width: `${volUsedPercent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
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
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramHistory, setRamHistory] = useState<number[]>([]);

  const memoryPercent =
    specs.memoryTotalBytes > 0
      ? (specs.memoryUsedBytes / specs.memoryTotalBytes) * 100
      : 0;

  useEffect(() => {
    if (!specs) return;
    const coreCount = Math.max(specs.cpuCores, 1);
    const cpuUtil = Math.min((specs.loadAverage1m / coreCount) * 100, 100);
    const ramUtil = specs.memoryTotalBytes > 0
      ? (specs.memoryUsedBytes / specs.memoryTotalBytes) * 100
      : 0;

    setCpuHistory((prev) => {
      if (prev.length === 0) {
        // Seed initial history path
        return Array(15).fill(cpuUtil);
      }
      const next = [...prev, cpuUtil];
      if (next.length > 15) next.shift();
      return next;
    });

    setRamHistory((prev) => {
      if (prev.length === 0) {
        // Seed initial history path
        return Array(15).fill(ramUtil);
      }
      const next = [...prev, ramUtil];
      if (next.length > 15) next.shift();
      return next;
    });
  }, [specs]);

  return (
    <div className={`grid gap-6 lg:grid-cols-12 ${stale ? "opacity-80" : ""}`}>
      {/* LEFT COLUMN: Resource Telemetry & Hardware profile (7 cols) */}
      <div className="lg:col-span-7 space-y-6">
        <ResourceTelemetryPanel
          specs={specs}
          memoryPercent={memoryPercent}
          cpuHistory={cpuHistory}
          ramHistory={ramHistory}
        />
        <HardwareSpecsPanel specs={specs} />
      </div>

      {/* RIGHT COLUMN: Storage Telemetry & PM2 Manager (5 cols) */}
      <div className="lg:col-span-5 space-y-6">
        <StorageTelemetryPanel storage={storage} />
        {pm2 && <Pm2Panel pm2={pm2} />}
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
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-white/[0.02] backdrop-blur-md px-6 text-center">
      <AppLogo size="lg" className="mb-4" />
      {loading && (
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      )}
      <p className="text-[15px] font-semibold text-[#f8f9fa]">{title}</p>
      <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-neutral-400">
        {description}
      </p>
    </div>
  );
}
