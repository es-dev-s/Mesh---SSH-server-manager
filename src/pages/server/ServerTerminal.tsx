import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

interface ServerTerminalProps {
  id: string;
  startupCommand?: string;
}

export function ServerTerminal({ id, startupCommand }: ServerTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Create and configure xterm terminal
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      theme: {
        background: "#0c0c0d",
        foreground: "#f8f9fa",
        cursor: "#f8f9fa",
        selectionBackground: "rgba(255, 255, 255, 0.15)",
        black: "#1c1c1e",
        red: "#ff453a",
        green: "#32d74b",
        yellow: "#ffd60a",
        blue: "#0a84ff",
        magenta: "#bf5af2",
        cyan: "#5e5ce6",
        white: "#f8f9fa",
        brightBlack: "#48484a",
        brightRed: "#ff453a",
        brightGreen: "#32d74b",
        brightYellow: "#ffd60a",
        brightBlue: "#0a84ff",
        brightMagenta: "#bf5af2",
        brightCyan: "#5e5ce6",
        brightWhite: "#ffffff",
      },
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let cleanupListeners: (() => void) | undefined;

    // 2. Initialize the backend PTY session
    const initSession = async () => {
      const dimensions = fitAddon.proposeDimensions();
      const cols = dimensions ? dimensions.cols : 80;
      const rows = dimensions ? dimensions.rows : 24;

      try {
        // Create terminal session in backend
        await invoke("create_terminal_session", { id, cols, rows });

        // Listen for output from the backend
        const unlistenData = await listen<string>(`terminal-data:${id}`, (event) => {
          terminal.write(event.payload);
        });

        // Listen for close event
        const unlistenClose = await listen<void>(`terminal-closed:${id}`, () => {
          terminal.write("\r\n[SSH Connection Closed]\r\n");
        });

        // Pipe user input to the backend
        const onDataDisposable = terminal.onData((data) => {
          void invoke("write_terminal_input", { id, input: data });
        });

        cleanupListeners = () => {
          unlistenData();
          unlistenClose();
          onDataDisposable.dispose();
          void invoke("close_terminal_session", { id });
        };

        setIsReady(true);

        if (startupCommand) {
          // Send startup command with a small delay to let interactive shell initialize
          setTimeout(() => {
            void invoke("write_terminal_input", { id, input: startupCommand });
          }, 200);
        }
      } catch (err) {
        terminal.write(`\r\nError starting SSH session: ${err}\r\n`);
        setIsReady(true);
      }
    };

    void initSession();

    // 3. Handle terminal resizing
    const resizeObserver = new ResizeObserver(() => {
      if (!fitAddonRef.current || !terminalRef.current) return;
      try {
        fitAddonRef.current.fit();
        const dimensions = fitAddonRef.current.proposeDimensions();
        if (dimensions) {
          void invoke("resize_terminal_session", {
            id,
            cols: dimensions.cols,
            rows: dimensions.rows,
          });
        }
      } catch (e) {
        // Ignore resize errors before backend is ready
      }
    });
    resizeObserver.observe(containerRef.current);

    // Focus terminal on mount
    terminal.focus();

    return () => {
      resizeObserver.disconnect();
      if (cleanupListeners) {
        cleanupListeners();
      }
      terminal.dispose();
    };
  }, [id]);

  return (
    <div className="relative h-full w-full bg-[#0c0c0d] p-3 rounded-lg border border-white/[0.04]">
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0c0c0d]/80 backdrop-blur-sm z-10">
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-[12px] text-neutral-400 font-medium">Connecting PTY stream...</p>
          </div>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
