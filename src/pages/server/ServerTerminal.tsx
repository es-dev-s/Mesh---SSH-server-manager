import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

interface ServerTerminalProps {
  id: string;
  startupCommand?: string;
  isActive?: boolean;
}

function saneDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return value;
}

export function ServerTerminal({
  id,
  startupCommand,
  isActive = true,
}: ServerTerminalProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const spawnGenerationRef = useRef<number | null>(null);
    const isActiveRef = useRef(isActive);
  const [isReady, setIsReady] = useState(false);
  const startupCommandRef = useRef(startupCommand);

  useEffect(() => {
    startupCommandRef.current = startupCommand;
  }, [startupCommand]);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current) return;

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

    const applyFit = () => {
      if (!fitAddonRef.current || !terminalRef.current || !isActiveRef.current) {
        return;
      }
      try {
        fitAddonRef.current.fit();
        const dimensions = fitAddonRef.current.proposeDimensions();
        const cols = saneDimension(dimensions?.cols, 80);
        const rows = saneDimension(dimensions?.rows, 24);
        void invoke("resize_terminal_session", { id, cols, rows });
      } catch {
        // Ignore resize errors before backend is ready.
      }
    };

    const initSession = async () => {
      const dimensions = fitAddon.proposeDimensions();
      const cols = saneDimension(dimensions?.cols, 80);
      const rows = saneDimension(dimensions?.rows, 24);

      try {
        const spawnGeneration = await invoke<number>("create_terminal_session", {
          id,
          cols,
          rows,
        });
        spawnGenerationRef.current = spawnGeneration;

        const unlistenData = await listen<string>(`terminal-data:${id}`, (event) => {
          terminal.write(event.payload);
        });

        const unlistenClose = await listen<void>(`terminal-closed:${id}`, () => {
          terminal.write("\r\n[SSH Connection Closed]\r\n");
        });

        const unlistenReconnect = await listen<void>(
          `terminal-reconnecting:${id}`,
          () => {
            terminal.write("\r\n[Reconnecting terminal…]\r\n");
          },
        );

        const onDataDisposable = terminal.onData((data) => {
          void invoke("write_terminal_input", { id, input: data });
        });

        cleanupListeners = () => {
          unlistenData();
          unlistenClose();
          unlistenReconnect();
          onDataDisposable.dispose();
          void invoke("close_terminal_session", {
            id,
            spawnGeneration: spawnGenerationRef.current ?? undefined,
          });
        };

        setIsReady(true);

        const command = startupCommandRef.current;
        if (command) {
          setTimeout(() => {
            void invoke("write_terminal_input", { id, input: command });
          }, 200);
        }
      } catch (err) {
        terminal.write(`\r\nError starting SSH session: ${err}\r\n`);
        setIsReady(true);
      }
    };

    void initSession();

    const resizeObserver = new ResizeObserver(() => {
      applyFit();
    });
    resizeObserver.observe(containerRef.current);

    if (isActiveRef.current) {
      terminal.focus();
    }

    return () => {
      resizeObserver.disconnect();
      if (cleanupListeners) {
        cleanupListeners();
      }
      terminal.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (!isActive || !fitAddonRef.current || !terminalRef.current) {
      return;
    }

    try {
      fitAddonRef.current.fit();
      const dimensions = fitAddonRef.current.proposeDimensions();
      const cols = saneDimension(dimensions?.cols, 80);
      const rows = saneDimension(dimensions?.rows, 24);
      void invoke("resize_terminal_session", { id, cols, rows });
      terminalRef.current.focus();
    } catch {
      // Ignore resize errors before backend is ready.
    }
  }, [id, isActive]);

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
