import { type PropsWithChildren, useEffect } from "react";
import clsx from "clsx";

export function Modal({ open, title, onClose, children, className }: PropsWithChildren<{ open: boolean; title: string; onClose: () => void; className?: string }>) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6" role="dialog" aria-modal="true">
      <div className={clsx("w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-[#0f0f14] shadow-2xl", className)}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
          <button
            className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

