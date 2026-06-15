import { invoke } from "@tauri-apps/api/core";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RemoteEntry } from "../../types/ssh";
import { Modal } from "./Modal";

type PathCrumb = { label: string; path: string };

export function FolderPickerDialog({
  open,
  initialPath,
  onClose,
  onSelect,
}: {
  open: boolean;
  initialPath: string;
  onClose: () => void;
  onSelect: (path: string) => void | Promise<void>;
}) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [folders, setFolders] = useState<RemoteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadFolders = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const entries = await invoke<RemoteEntry[]>("list_remote_directory", { path });
      setFolders(entries.filter((entry) => entry.entryType === "folder"));
    } catch (err) {
      setFolders([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentPath(initialPath);
  }, [open, initialPath]);

  useEffect(() => {
    if (!open || !currentPath) return;
    void loadFolders(currentPath);
  }, [open, currentPath, loadFolders]);

  const crumbs: PathCrumb[] = (() => {
    const parts = currentPath.split("/").filter(Boolean);
    const list: PathCrumb[] = [{ label: "/", path: "/" }];
    let built = "";
    for (const part of parts) {
      built += `/${part}`;
      list.push({ label: part, path: built });
    }
    return list;
  })();

  async function handleSelect() {
    setSubmitting(true);
    try {
      await onSelect(currentPath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Choose folder"
      description="Browse the server and select a destination folder."
      onClose={onClose}
      widthClassName="max-w-2xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.06] bg-[#0c0c0d] px-3 py-2">
          {crumbs.map((crumb, index) => (
            <div key={crumb.path} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="h-3 w-3 text-neutral-600" /> : null}
              <button
                type="button"
                onClick={() => setCurrentPath(crumb.path)}
                className={[
                  "rounded-md px-2 py-1 text-[12px] font-medium transition-colors",
                  crumb.path === currentPath
                    ? "bg-white/[0.08] text-white"
                    : "text-neutral-400 hover:text-white",
                ].join(" ")}
              >
                {crumb.label}
              </button>
            </div>
          ))}
        </div>

        <div className="max-h-[320px] overflow-y-auto rounded-xl border border-white/[0.06] bg-[#0c0c0d]">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-[13px] text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading folders…
            </div>
          ) : folders.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-neutral-500">
              No subfolders here
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {folders.map((folder) => (
                <li key={folder.name}>
                  <button
                    type="button"
                    onDoubleClick={() =>
                      setCurrentPath(`${currentPath.replace(/\/+$/, "")}/${folder.name}`)
                    }
                    onClick={() =>
                      setCurrentPath(`${currentPath.replace(/\/+$/, "")}/${folder.name}`)
                    }
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.04]"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-sky-300" />
                    <span className="truncate text-[13px] font-medium text-neutral-200">
                      {folder.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? (
          <p className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-200">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <code className="truncate rounded-lg bg-black/30 px-2 py-1 font-mono text-[11px] text-neutral-400">
            {currentPath}
          </code>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/[0.08] px-4 py-2 text-[12px] font-semibold text-neutral-300 hover:bg-white/[0.04]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSelect()}
              className="rounded-xl bg-white px-4 py-2 text-[12px] font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
            >
              {submitting ? "Opening…" : "Open folder"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
