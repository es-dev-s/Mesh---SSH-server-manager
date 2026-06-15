import { Box, Server } from "lucide-react";
import {
  formatBytes,
  formatPercent,
  formatPm2Uptime,
} from "../../hooks/useSshMonitor";
import type { Pm2Summary } from "../../types/ssh";

const statusStyles: Record<string, string> = {
  online: "bg-emerald-500/[0.1] text-emerald-300 ring-emerald-500/20",
  stopped: "bg-white/[0.04] text-neutral-400 ring-white/[0.06]",
  launching: "bg-sky-500/[0.1] text-sky-300 ring-sky-500/20",
  errored: "bg-red-500/[0.1] text-red-300 ring-red-500/20",
  stopping: "bg-amber-500/[0.1] text-amber-300 ring-amber-500/20",
};

function statusClass(status: string): string {
  return statusStyles[status] ?? "bg-white/[0.04] text-neutral-400 ring-white/[0.06]";
}

export function Pm2Panel({ pm2 }: { pm2: Pm2Summary }) {
  if (!pm2.installed) {
    return (
      <div className="rounded-2xl bg-[#1c1c1e]/60 shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-white/[0.06] backdrop-blur-md">
        <div className="flex items-center gap-4 px-5 py-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] ring-1 ring-white/10">
            <Box className="h-5 w-5 text-neutral-400" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">
              PM2 Process Manager
            </p>
            <p className="mt-1 text-[15px] font-semibold text-[#f8f9fa]">
              Not installed
            </p>
            <p className="mt-0.5 text-[12px] text-neutral-400">
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
    <div className="overflow-hidden rounded-2xl bg-[#1c1c1e]/60 shadow-[0_4px_24px_rgba(0,0,0,0.15)] border border-white/[0.06] backdrop-blur-md">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] ring-1 ring-white/10">
            <Server className="h-5 w-5 text-white" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase">
              PM2 Process Manager
            </p>
            <p className="mt-1 truncate text-[14px] font-semibold text-[#f8f9fa]">
              Installed
              {pm2.version && (
                <span className="ml-1.5 text-[12px] font-medium text-neutral-400">
                  v{pm2.version}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-emerald-500/[0.1] px-2.5 py-1 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-500/20">
            {pm2.runningCount} running
          </span>
          <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-neutral-400 ring-1 ring-white/[0.06]">
            {pm2.totalCount} total
          </span>
        </div>
      </div>

      {/* Body Table */}
      <div className="px-5 py-4">
        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-8 text-center">
            <p className="text-[13px] font-semibold text-[#f8f9fa]">
              No PM2 processes
            </p>
            <p className="mt-1 text-[12px] text-neutral-400">
              PM2 is installed but no apps are registered yet
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/[0.04] text-[9px] font-semibold tracking-wider text-neutral-500 uppercase">
                  <th className="pb-2.5">App</th>
                  <th className="pb-2.5">Status</th>
                  <th className="pb-2.5">CPU</th>
                  <th className="pb-2.5">Memory</th>
                  <th className="pb-2.5">Uptime</th>
                  <th className="pb-2.5 text-right">Restarts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02] text-[12px]">
                {sorted.map((process) => (
                  <tr
                    key={`${process.id}-${process.name}`}
                    className="group hover:bg-white/[0.01] transition-colors duration-150"
                  >
                    <td className="py-3 pr-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-white truncate" title={process.name}>
                          {process.name}
                        </p>
                        <p className="text-[10px] text-neutral-500 mt-0.5 truncate font-mono" title={process.scriptPath}>
                          ID {process.id} · {process.interpreter}
                        </p>
                      </div>
                    </td>
                    <td className="py-3 pr-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase ring-1 ${statusClass(process.status)}`}
                      >
                        <span
                          className={`h-1 w-1 rounded-full ${
                            process.status === "online"
                              ? "bg-emerald-400 animate-pulse"
                              : "bg-neutral-500"
                          }`}
                        />
                        {process.status}
                      </span>
                    </td>
                    <td className="py-3 pr-2 font-mono text-neutral-200 tabular-nums">
                      {formatPercent(process.cpuPercent)}
                    </td>
                    <td className="py-3 pr-2 font-mono text-neutral-200 tabular-nums">
                      {formatBytes(process.memoryBytes)}
                    </td>
                    <td className="py-3 pr-2 text-neutral-400 text-[11px]">
                      {formatPm2Uptime(process.uptimeMs)}
                    </td>
                    <td className="py-3 font-mono text-neutral-400 text-right tabular-nums">
                      {process.restarts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
