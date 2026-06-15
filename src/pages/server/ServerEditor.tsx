import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { useServerTabsStore } from "../../stores/useServerTabsStore";

interface ServerEditorProps {
  path: string;
  name: string;
}

export function ServerEditor({ path, name }: ServerEditorProps) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<"clean" | "dirty" | "saving" | "saved">("clean");

  const setTabDirty = useServerTabsStore((state) => state.setTabDirty);
  const isDirtyRef = useRef(false);

  // 1. Fetch file content on mount
  useEffect(() => {
    let active = true;

    async function loadFile() {
      setLoading(true);
      setError(null);
      try {
        const fileContent = await invoke<string>("read_remote_file", { path });
        if (active) {
          setContent(fileContent);
          setOriginalContent(fileContent);
          setSaveStatus("clean");
          setTabDirty(path, false);
          isDirtyRef.current = false;
        }
      } catch (err) {
        if (active) {
          setError(String(err));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadFile();

    return () => {
      active = false;
      // Mark clean on unmount
      setTabDirty(path, false);
    };
  }, [path, setTabDirty]);

  // 2. Handle Ctrl+S keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        void handleSave();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [content, saving, loading]);

  // 3. Save file to remote server
  async function handleSave() {
    if (saving || loading) return;
    setSaving(true);
    setSaveStatus("saving");

    try {
      await invoke("write_remote_file", { path, content });
      setOriginalContent(content);
      setSaveStatus("saved");
      setTabDirty(path, false);
      isDirtyRef.current = false;

      // Reset to clean status text after a brief delay
      setTimeout(() => {
        setSaveStatus("clean");
      }, 1500);
    } catch (err) {
      setError(`Failed to save: ${err}`);
      setSaveStatus("dirty");
    } finally {
      setSaving(false);
    }
  }

  // 4. Track local content modifications
  function handleChange(value: string) {
    setContent(value);
    const modified = value !== originalContent;
    if (modified !== isDirtyRef.current) {
      isDirtyRef.current = modified;
      setSaveStatus(modified ? "dirty" : "clean");
      setTabDirty(path, modified);
    }
  }

  // Determine language extensions
  const ext = name.split(".").pop()?.toLowerCase();
  const extensions = [];
  if (ext === "md" || ext === "markdown" || ext === "txt" || !ext) {
    extensions.push(markdown());
  }

  return (
    <div className="flex h-full flex-col bg-[#111111] rounded-lg border border-white/[0.04] overflow-hidden">
      {/* Top Header info bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#161617]/90 px-4 py-2 text-[12px] backdrop-blur">
        <div className="flex items-center gap-2 font-mono text-neutral-400">
          <span className="text-[#f8f9fa] font-semibold">{name}</span>
          <span className="text-neutral-600">|</span>
          <span className="truncate max-w-[300px] sm:max-w-[500px]" title={path}>
            {path}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <span className="font-medium">
            {saveStatus === "clean" && (
              <span className="text-neutral-500">All changes saved</span>
            )}
            {saveStatus === "dirty" && (
              <span className="text-amber-400">● Unsaved changes</span>
            )}
            {saveStatus === "saving" && (
              <span className="text-neutral-400 animate-pulse">Saving to server...</span>
            )}
            {saveStatus === "saved" && (
              <span className="text-green-400">✓ Saved successfully</span>
            )}
          </span>

          <button
            onClick={handleSave}
            disabled={saving || loading || saveStatus === "clean"}
            className={[
              "rounded px-3 py-1 text-[11px] font-semibold transition-all duration-200 cursor-pointer",
              saveStatus === "clean"
                ? "bg-white/5 text-neutral-500 cursor-default"
                : "bg-[#f8f9fa] text-black hover:bg-[#ffffff] active:scale-95 shadow-[0_1px_3px_rgba(0,0,0,0.2)]",
            ].join(" ")}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Main editor area */}
      <div className="flex-1 overflow-auto text-left font-mono">
        {loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-[12px] text-neutral-400">Reading remote file...</p>
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <p className="text-[13px] font-semibold text-red-400">Failed to load file</p>
            <p className="mt-2 max-w-md text-[12px] leading-relaxed text-neutral-400">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded bg-white/10 px-4 py-2 text-[11px] font-semibold text-white hover:bg-white/20"
            >
              Retry
            </button>
          </div>
        ) : (
          <CodeMirror
            value={content}
            height="100%"
            theme="dark"
            extensions={extensions}
            onChange={handleChange}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              foldGutter: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              syntaxHighlighting: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              rectangularSelection: true,
              crosshairCursor: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              closeBracketsKeymap: true,
              defaultKeymap: true,
              searchKeymap: true,
              historyKeymap: true,
              foldKeymap: true,
              completionKeymap: true,
              lintKeymap: true,
            }}
            className="h-full w-full text-[13px]"
          />
        )}
      </div>
    </div>
  );
}
