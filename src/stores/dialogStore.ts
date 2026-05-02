import { create } from "zustand";

type DialogKind = "confirm" | "alert" | "prompt";

type DialogState = {
  open: boolean;
  kind: DialogKind;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  inputLabel: string;
  inputPlaceholder: string;
  inputValue: string;
  resolve: ((v: any) => void) | null;

  confirm: (opts: { title?: string; message: string; confirmText?: string; cancelText?: string }) => Promise<boolean>;
  alert: (opts: { title?: string; message: string; confirmText?: string }) => Promise<void>;
  prompt: (opts: { title?: string; message: string; defaultValue?: string; label?: string; placeholder?: string; confirmText?: string; cancelText?: string }) => Promise<string | null>;
  close: (result: any) => void;
};

export const useDialogStore = create<DialogState>((set, get) => ({
  open: false,
  kind: "confirm",
  title: "",
  message: "",
  confirmText: "OK",
  cancelText: "Cancel",
  inputLabel: "Name",
  inputPlaceholder: "",
  inputValue: "",
  resolve: null,

  confirm: async (opts) => {
    return await new Promise<boolean>((resolve) => {
      set({
        open: true,
        kind: "confirm",
        title: opts.title ?? "Confirm",
        message: opts.message,
        confirmText: opts.confirmText ?? "Confirm",
        cancelText: opts.cancelText ?? "Cancel",
        resolve: (v: any) => resolve(v === true),
      });
    });
  },

  alert: async (opts) => {
    await new Promise<void>((resolve) => {
      set({
        open: true,
        kind: "alert",
        title: opts.title ?? "Notice",
        message: opts.message,
        confirmText: opts.confirmText ?? "OK",
        cancelText: "",
        resolve: () => resolve(),
      });
    });
  },

  prompt: async (opts) => {
    return await new Promise<string | null>((resolve) => {
      set({
        open: true,
        kind: "prompt",
        title: opts.title ?? "Input",
        message: opts.message,
        confirmText: opts.confirmText ?? "Save",
        cancelText: opts.cancelText ?? "Cancel",
        inputLabel: opts.label ?? "Name",
        inputPlaceholder: opts.placeholder ?? "",
        inputValue: opts.defaultValue ?? "",
        resolve: (v: any) => resolve(typeof v === "string" ? v : null),
      });
    });
  },

  close: (result) => {
    const r = get().resolve;
    set({ open: false, resolve: null });
    if (r) r(result);
  },
}));
