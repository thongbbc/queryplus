import { invoke } from "@tauri-apps/api/core";

export type InvokeError = {
  message: string;
};

function hasTauriInvoke(): boolean {
  const w = window as unknown as Record<string, unknown>;
  const internals = w["__TAURI_INTERNALS__"] as { invoke?: unknown } | undefined;
  return typeof internals?.invoke === "function";
}

export async function invokeJson<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriInvoke()) {
    throw new Error("Tauri API is not available. Open the desktop app window (not the browser). Run `npm run tauri dev`.");
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(message);
  }
}
