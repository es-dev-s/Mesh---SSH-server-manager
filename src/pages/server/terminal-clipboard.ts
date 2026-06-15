import type { Terminal } from "xterm";

type SendInput = (data: string) => void;

async function copySelection(text: string) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

async function pasteFromClipboard(sendInput: SendInput) {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      sendInput(text);
    }
  } catch {
    // Clipboard read may be blocked until user gesture — ignore quietly.
  }
}

export function attachTerminalClipboard(terminal: Terminal, sendInput: SendInput) {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") {
      return true;
    }

    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) {
      return true;
    }

    const selection = terminal.getSelection();

    if (key === "c" && selection) {
      event.preventDefault();
      void copySelection(selection);
      return false;
    }

    if (key === "c" && event.shiftKey) {
      event.preventDefault();
      void copySelection(selection ?? "");
      return false;
    }

    if (key === "v") {
      event.preventDefault();
      void pasteFromClipboard(sendInput);
      return false;
    }

    if (key === "insert" && !event.shiftKey) {
      event.preventDefault();
      void copySelection(selection ?? "");
      return false;
    }

    if (key === "insert" && event.shiftKey) {
      event.preventDefault();
      void pasteFromClipboard(sendInput);
      return false;
    }

    return true;
  });
}
