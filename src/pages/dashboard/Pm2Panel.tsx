import { Box, Server } from "lucide-react";
import {
  formatBytes,
  formatPercent,
  formatPm2Uptime,
} from "../../hooks/useSshMonitor";
import type { Pm2Process, Pm2Summary } from "../../types/ssh";

const statusStyles: Record<string, string> = {
  online: "bg-emerald-50 text-emerald-700 ring-emerald-500/20",
  stopped: "bg-neutral-100 text-neutral-600 ring-neutral-300/40",
  launching: "bg-sky-50 text-sky-700 ring-sky-500/20",
  errored: "bg-red-50 text-red-700 ring-red-500/20",
  stopping: "bg-amber-50 text-amber-700 ring-amber-500/20",
};

function statusClass(status: string): string {
  return statusStyles[status] ?? "bg-neutral-100 text-neutral-600 ring-neutral-300/40";
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[12px] font-medium text-neutral-800" title={value}>
        {value}
      </p>
    </div>
  );
}

function ProcessCard({ process }: { process: Pm2Process }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.05] bg-neutral-50/60">
      <div className="flex items-start justify-between gap-3 border-b border-black/[0.04] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-neutral-900">
              {process.name}
            </p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ring-1 ${statusClass(process.status)}`}
            >
              {process.status}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-neutral-500">
            {process.description}
          </p>
        </div>
        <div className="shrink-0 text-right text-[11px] tabular-nums text-neutral-500">
          <p>PID {process.pid ?? "—"}</p>
          <p>ID {process.id}</p>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        <div className="min-w-0 sm:col-span-2">
          <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase">
            Working Directory
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[12px] text-neutral-700"
            title={process.cwd}
          >
            {process.cwd}
          </p>
        </div>
        <div className="min-w-0 sm:col-span-2">
          <p className="text-[10px] font-medium tracking-wide text-neutral-400 uppercase">
            Script
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[12px] text-neutral-700"
            title={process.scriptPath}
          >
            {process.scriptPath}
          </p>
          {process.args && (
            <p
              className="mt-1 truncate font-mono text-[11px] text-neutral-500"
              title={process.args}
            >
              {process.args}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-black/[0.04] bg-white/40 px-4 py-3 sm:grid-cols-4">
        <MetaItem label="Runtime" value={process.interpreter} />
        <MetaItem label="Mode" value={process.execMode} />
        <MetaItem label="Memory" value={formatBytes(process.memoryBytes)} />
        <MetaItem label="CPU" value={formatPercent(process.cpuPercent)} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-black/[0.04] px-4 py-2.5 text-[11px] text-neutral-500">
        <span>Uptime {formatPm2Uptime(process.uptimeMs)}</span>
        <span>Restarts {process.restarts}</span>
        {process.version && <span>v{process.version}</span>}
      </div>
    </div>
  );
}

export function Pm2Panel({ pm2 }: { pm2: Pm2Summary }) {
  if (!pm2.installed) {
    return (
      <div className="rounded-2xl bg-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-sm">
        <div className="flex items-center gap-4 px-5 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 ring-1 ring-neutral-200/60">
            <Box className="h-5 w-5 text-neutral-400" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
              PM2 Process Manager
            </p>
            <p className="mt-1 text-[15px] font-semibold text-neutral-900">
              Not installed
            </p>
            <p className="mt-0.5 text-[12px] text-neutral-500">
              PM2 was not found on this server PATH
            </p>
          </div>
        </div>
      </div>
    );
  }

  const sorted = [...pm2.processes].sort((a, b) => {
    if (a.status === "online" && b.status !== "online") return -1;
    if (b.status === "online" && a.status !== "online") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="overflow-hidden rounded-2xl bg-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.05] backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.04] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#007AFF]/10 ring-1 ring-[#007AFF]/15">
            <Server className="h-5 w-5 text-[#007AFF]" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium tracking-wide text-neutral-400 uppercase">
              PM2 Process Manager
            </p>
            <p className="mt-1 truncate text-[15px] font-semibold text-neutral-900">
              Installed
              {pm2.version && (
                <span className="ml-2 text-[13px] font-medium text-neutral-400">
                  v{pm2.version}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-500/20">
            {pm2.runningCount} running
          </span>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-semibold text-neutral-600 ring-1 ring-neutral-300/40">
            {pm2.totalCount} total
          </span>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/[0.08] bg-neutral-50/50 px-4 py-8 text-center">
            <p className="text-[14px] font-semibold text-neutral-800">
              No PM2 processes
            </p>
            <p className="mt-1 text-[12px] text-neutral-500">
              PM2 is installed but no apps are registered yet
            </p>
          </div>
        ) : (
          sorted.map((process) => (
            <ProcessCard key={`${process.id}-${process.name}`} process={process} />
          ))
        )}
      </div>
    </div>
  );
}
