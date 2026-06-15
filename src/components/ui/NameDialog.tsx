import { useEffect, useState } from "react";
import { Modal } from "./Modal";

export function NameDialog({
  open,
  title,
  description,
  label,
  placeholder,
  initialValue = "",
  confirmLabel = "Create",
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (value: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialValue]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} title={title} description={description} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {label}
          </span>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#0c0c0d] px-3 py-2.5 text-[13px] text-white outline-none focus:border-white/[0.16]"
          />
        </label>
        {error ? (
          <p className="rounded-lg border border-red-500/20 bg-red-500/[0.08] px-3 py-2 text-[12px] text-red-200">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] px-4 py-2 text-[12px] font-semibold text-neutral-300 hover:bg-white/[0.04]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-white px-4 py-2 text-[12px] font-semibold text-black hover:bg-neutral-200 disabled:opacity-50"
          >
            {submitting ? "Creating…" : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
