import { useEffect, useMemo, useRef } from "react";
import { useDialogStore } from "../stores/dialogStore";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

export function DialogHost() {
  const { open, kind, title, message, confirmText, cancelText, inputLabel, inputPlaceholder, inputValue, close } = useDialogStore();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const showCancel = cancelText.trim().length > 0 && kind !== "alert";

  const canSubmit = useMemo(() => {
    if (kind !== "prompt") return true;
    return inputValue.trim().length > 0;
  }, [kind, inputValue]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && showCancel) {
        e.preventDefault();
        if (kind === "confirm") close(false);
        else close(null);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (!canSubmit) return;
        if (kind === "confirm") close(true);
        else if (kind === "alert") close(true);
        else close(inputValue);
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, kind, inputValue, close, showCancel, canSubmit]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[999] grid place-items-center bg-black/55 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0f0f14] shadow-2xl">
        <div className="border-b border-white/10 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-100">{title}</div>
        </div>

        <div className="px-4 py-4">
          <div className="whitespace-pre-wrap text-sm text-zinc-300">{message}</div>
          {kind === "prompt" ? (
            <div className="mt-4">
              <div className="mb-1 text-xs font-medium text-zinc-400">{inputLabel}</div>
              <Input
                ref={inputRef}
                value={inputValue}
                placeholder={inputPlaceholder}
                onChange={(e) => useDialogStore.setState({ inputValue: e.currentTarget.value })}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
          {showCancel ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (kind === "confirm") close(false);
                else close(null);
              }}
            >
              {cancelText}
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => {
              if (!canSubmit) return;
              if (kind === "confirm") close(true);
              else if (kind === "alert") close(true);
              else close(inputValue);
            }}
            disabled={!canSubmit}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
