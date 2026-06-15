import { Plus, Trash2 } from "lucide-react";

export type EnvVarRow = { id: string; key: string; value: string };

export function parseEnvContent(content: string): EnvVarRow[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      if (index === -1) {
        return { id: crypto.randomUUID(), key: line, value: "" };
      }
      return {
        id: crypto.randomUUID(),
        key: line.slice(0, index).trim(),
        value: line.slice(index + 1),
      };
    });
}

export function serializeEnvRows(rows: EnvVarRow[]): string {
  return rows
    .filter((row) => row.key.trim())
    .map((row) => `${row.key.trim()}=${row.value}`)
    .join("\n");
}

export function EnvVarEditor({
  rows,
  onChange,
}: {
  rows: EnvVarRow[];
  onChange: (rows: EnvVarRow[]) => void;
}) {
  function updateRow(id: string, patch: Partial<EnvVarRow>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addRow() {
    onChange([...rows, { id: crypto.randomUUID(), key: "", value: "" }]);
  }

  function removeRow(id: string) {
    onChange(rows.filter((row) => row.id !== id));
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-[12px] text-neutral-500">
          No environment variables yet. Add variables required by your app (e.g. DATABASE_URL,
          JWT_SECRET).
        </p>
      ) : (
        rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_1.2fr_auto] gap-2">
            <input
              value={row.key}
              onChange={(e) => updateRow(row.id, { key: e.target.value })}
              placeholder="KEY"
              className="rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2 font-mono text-[12px] text-white outline-none focus:border-white/[0.16]"
            />
            <input
              value={row.value}
              onChange={(e) => updateRow(row.id, { value: e.target.value })}
              placeholder="value"
              className="rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2 font-mono text-[12px] text-white outline-none focus:border-white/[0.16]"
            />
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] text-neutral-400 hover:bg-red-500/10 hover:text-red-300"
              aria-label="Remove variable"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))
      )}

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-neutral-200 hover:bg-white/[0.08]"
      >
        <Plus className="h-3.5 w-3.5" />
        Add variable
      </button>
    </div>
  );
}
