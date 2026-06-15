import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Minus, X } from "lucide-react";

export function WindowControls() {
  async function minimize() {
    await getCurrentWindow().minimize();
  }

  async function close() {
    await invoke("quit_mesh");
  }

  return (
    <div className="flex items-center select-none" data-no-drag="true">
      <button
        type="button"
        onClick={minimize}
        aria-label="Minimize"
        className="flex h-8 w-9 items-center justify-center rounded-[6px] text-neutral-400 hover:bg-white/[0.08] hover:text-white transition-colors duration-150 outline-none"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>

      <button
        type="button"
        onClick={close}
        aria-label="Close"
        className="flex h-8 w-9 items-center justify-center rounded-[6px] text-neutral-400 hover:bg-red-600 hover:text-white transition-colors duration-150 outline-none active:bg-red-700"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
