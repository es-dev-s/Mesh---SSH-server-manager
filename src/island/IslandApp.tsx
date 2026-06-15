import { GripHorizontal, Loader2, Power } from "lucide-react";
import { useMemo } from "react";
import type { Pm2Process } from "../types/ssh";
import { useSshMonitor, useSshStore } from "../hooks/useSshMonitor";
import { useIslandDrag } from "../hooks/useIslandDrag";
import { openMainWindow, quitMesh, useIslandLayout } from "./useIslandLayout";
import { useIslandPresenceSync } from "./useTopIslandLayer";

const statusDot: Record<string, string> = {
  online: "bg-emerald-400",
  stopped: "bg-neutral-500",
  errored: "bg-red-400",
  launching: "bg-sky-400",
  stopping: "bg-amber-400",
};

function dotClass(status: string): string {
  return statusDot[status] ?? "bg-neutral-500";
}

export function IslandApp() {
  useSshMonitor();
  const snapshot = useSshStore((state) => state.snapshot);
  const { onMouseDown } = useIslandDrag();

  const processes = useMemo(() => {
    const list = snapshot.pm2?.processes ?? [];
    return [...list].sort((a, b) => {
      if (a.status === "online" && b.status !== "online") return -1;
      if (b.status === "online" && a.status !== "online") return 1;
      return a.name.localeCompare(b.name);
    });
  }, [snapshot.pm2?.processes]);

  const onlineCount = processes.filter((p) => p.status === "online").length;
  const isConnected = snapshot.state === "connected";
  const isLoading =
    snapshot.state === "connecting" || snapshot.state === "reconnecting";

  useIslandLayout(processes.length);
  useIslandPresenceSync();

  return (
    <div
      className="flex h-full w-full cursor-grab flex-col items-stretch bg-transparent py-2 pl-0 pr-1 active:cursor-grabbing"
      onMouseDown={onMouseDown}
    >
      <div className="pointer-events-none flex min-h-0 flex-1 flex-col overflow-hidden rounded-r-xl border border-l-0 border-white/[0.1] bg-[#1e1e20]/92 shadow-[4px_0_24px_rgba(0,0,0,0.35)] backdrop-blur-xl select-none">
        <div className="flex h-5 shrink-0 items-center justify-center text-neutral-600">
          <GripHorizontal className="h-3 w-3" strokeWidth={2} />
        </div>

        <button
          type="button"
          data-no-drag="true"
          onClick={() => void openMainWindow()}
          className="pointer-events-auto mx-1.5 flex shrink-0 flex-col items-center gap-1 rounded-lg py-2 text-[9px] font-semibold uppercase tracking-wide text-neutral-300 hover:bg-white/[0.06] hover:text-white"
          title="Open Mesh"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
          ) : (
            <span
              className={`h-2 w-2 rounded-full ${isConnected ? "bg-emerald-400" : "bg-amber-400"}`}
            />
          )}
          Mesh
        </button>

        <div className="mx-2 my-1 h-px shrink-0 bg-white/[0.08]" />

        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1 pb-1">
          {!snapshot.pm2?.installed && isConnected && (
            <p className="px-1 py-2 text-center text-[9px] text-neutral-500">No PM2</p>
          )}

          {snapshot.pm2?.installed && processes.length === 0 && isConnected && (
            <p className="px-1 py-2 text-center text-[9px] text-neutral-500">Empty</p>
          )}

          {!isConnected && (
            <p className="px-1 py-2 text-center text-[9px] leading-tight text-neutral-500">
              {snapshot.statusMessage ?? "…"}
            </p>
          )}

          {processes.map((process) => (
            <IslandProcessButton
              key={`${process.id}-${process.name}`}
              process={process}
              dotClass={dotClass}
            />
          ))}
        </div>

        {onlineCount > 0 && (
          <>
            <div className="mx-2 h-px shrink-0 bg-white/[0.08]" />
            <p className="shrink-0 py-1.5 text-center text-[8px] font-semibold text-emerald-300">
              {onlineCount}↑
            </p>
          </>
        )}

        <button
          type="button"
          data-no-drag="true"
          onClick={() => void quitMesh()}
          className="pointer-events-auto mx-1.5 mb-1.5 flex h-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-red-500/15 hover:text-red-300"
          title="Quit Mesh"
        >
          <Power className="h-3.5 w-3.5" strokeWidth={2} />
        </button>

        <div className="flex h-5 shrink-0 items-center justify-center text-neutral-600">
          <GripHorizontal className="h-3 w-3" strokeWidth={2} />
        </div>
      </div>
    </div>
  );
}

function IslandProcessButton({
  process,
  dotClass,
}: {
  process: Pm2Process;
  dotClass: (status: string) => string;
}) {
  return (
    <button
      type="button"
      data-no-drag="true"
      onClick={() => void openMainWindow()}
      title={`${process.name} · ${process.status}`}
      className="pointer-events-auto flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 hover:bg-white/[0.05]"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass(process.status)}`} />
      <span className="max-w-[44px] truncate text-[9px] font-semibold leading-tight text-[#f8f9fa]">
        {process.name}
      </span>
    </button>
  );
}
