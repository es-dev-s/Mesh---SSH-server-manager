import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "lucide-react";
import { chromeButtonClass } from "../lib/interaction";

export function WindowControls() {
  async function minimize() {
    await getCurrentWindow().minimize();
  }

  async function close() {
    await getCurrentWindow().close();
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={minimize}
        data-no-drag="true"
        aria-label="Minimize"
        className={["h-7 w-7", chromeButtonClass].join(" ")}
      >
        <Minus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={close}
        data-no-drag="true"
        aria-label="Close"
        className={[
          "h-7 w-7 rounded-[8px] transition-[background-color,color] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]",
          "text-neutral-400 outline-none focus-visible:ring-2 focus-visible:ring-[#007AFF]/40",
          "hover:bg-red-500/[0.08] hover:text-red-500",
          "active:bg-red-500/[0.12]",
        ].join(" ")}
      >
        <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      </button>
    </div>
  );
}
