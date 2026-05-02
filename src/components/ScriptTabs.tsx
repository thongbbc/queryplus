import { FolderOpen, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import { useEditorStore } from "../stores/editorStore";
import { invokeJson } from "../lib/invoke";
import { Button } from "./ui/Button";
import { useDialogStore } from "../stores/dialogStore";
import { Modal } from "./ui/Modal";

function stripSqlExt(name: string): string {
  return name.toLowerCase().endsWith(".sql") ? name.slice(0, -4) : name;
}

export function ScriptTabs() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { tabs, activeTabId, setActive, closeTab, createTab, markSaved, renameTab } = useEditorStore();

  const activeConn = useMemo(() => connections.find((c) => c.id === activeConnectionId) ?? null, [connections, activeConnectionId]);
  const visibleTabs = useMemo(() => {
    if (!activeConnectionId) return tabs.filter((t) => t.connectionId == null);
    return tabs.filter((t) => t.connectionId === activeConnectionId);
  }, [tabs, activeConnectionId]);
  const activeTab = useMemo(() => visibleTabs.find((t) => t.id === activeTabId) ?? null, [visibleTabs, activeTabId]);

  const [saving, setSaving] = useState(false);
  const [scriptItems, setScriptItems] = useState<string[]>([]);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [openScriptOpen, setOpenScriptOpen] = useState(false);
  const [openSelectedScript, setOpenSelectedScript] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeConnectionId) {
        setScriptItems([]);
        setOpenSelectedScript("");
        setOpenScriptOpen(false);
        return;
      }
      setScriptLoading(true);
      try {
        const items = await invokeJson<{ name: string }[]>("list_scripts", { connectionId: activeConnectionId });
        if (cancelled) return;
        const names = items.map((s) => s.name);
        setScriptItems(names);
        setOpenSelectedScript((prev) => (prev && names.includes(prev) ? prev : ""));
      } catch {
        if (cancelled) return;
        setScriptItems([]);
        setOpenSelectedScript("");
      } finally {
        if (!cancelled) setScriptLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeConnectionId]);

  const canSave = !!activeConnectionId && !!activeTab && !saving;
  const canOpenPopup = !!activeConnectionId && !saving;
  const activeSavedFileName = (activeTab?.isSaved ? activeTab?.fileName : undefined) ?? undefined;
  const canDeleteActive = !!activeSavedFileName && !!activeTab?.connectionId && !saving;

  return (
    <div className="border-b border-white/10 bg-[color:var(--editor-bg)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              createTab({
                content: "",
                connectionId: activeConnectionId,
                database: activeConn?.database ?? "",
              })
            }
          >
            <Plus className="size-4" />
            New script
          </Button>

          <Button
            size="sm"
            variant="ghost"
            disabled={!canSave}
            onClick={async () => {
              if (!activeConnectionId) return;
              if (!activeTab) return;

              const existing = (activeTab.fileName ?? "").trim();
              const suggestedBase = (existing || `${activeTab.name}.sql`).trim();
              const suggested = suggestedBase.toLowerCase().endsWith(".sql") ? suggestedBase : `${suggestedBase}.sql`;

              const nameInput = existing
                ? suggested
                : await useDialogStore.getState().prompt({
                    title: "Save Script",
                    message: "Script name (.sql):",
                    defaultValue: suggested,
                    label: "File name",
                    placeholder: "example.sql",
                    confirmText: "Save",
                    cancelText: "Cancel",
                  });
              if (!nameInput) return;
              const name = nameInput.toLowerCase().endsWith(".sql") ? nameInput : `${nameInput}.sql`;

              setSaving(true);
              try {
                await invokeJson<void>("save_script", { connectionId: activeConnectionId, name, content: activeTab.content ?? "" });
                markSaved(activeTab.id, name, activeConnectionId, activeConn?.database ?? "");
                renameTab(activeTab.id, stripSqlExt(name));
                const items = await invokeJson<{ name: string }[]>("list_scripts", { connectionId: activeConnectionId });
                setScriptItems(items.map((s) => s.name));
                setOpenSelectedScript(name);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                await useDialogStore.getState().alert({ title: "Save failed", message: msg });
              } finally {
                setSaving(false);
              }
            }}
            title={activeTab?.fileName ? `Save ${activeTab.fileName}` : "Save script"}
          >
            <Save className="size-4" />
            {saving ? "Saving" : "Save"}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canOpenPopup}
            onClick={async () => {
              if (!activeConnectionId) return;
              setOpenScriptOpen(true);
            }}
            title="Open script"
          >
            <FolderOpen className="size-4" />
            Open
          </Button>
          {activeSavedFileName ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!canDeleteActive}
              onClick={async () => {
                const fileName = activeSavedFileName;
                if (!fileName) return;
                const connectionId = activeTab?.connectionId ?? null;
                if (!connectionId) return;
                const deletingName = fileName;
                const ok = await useDialogStore.getState().confirm({
                  title: "Delete Script",
                  message: `Delete "${deletingName}"?\n\nThis cannot be undone.`,
                  confirmText: "Delete",
                  cancelText: "Cancel",
                });
                if (!ok) return;
                setSaving(true);
                try {
                  await invokeJson<void>("delete_script", { connectionId, name: deletingName });
                  const deletingNameLower = deletingName.toLowerCase();
                  const deletingBaseLower = stripSqlExt(deletingName).toLowerCase();
                  const toClose = tabs
                    .filter((t) => t.connectionId === connectionId)
                    .filter((t) => {
                      const fileNameLower = (t.fileName ?? "").toLowerCase();
                      const nameLower = (t.name ?? "").toLowerCase();
                      if (fileNameLower && (fileNameLower === deletingNameLower || stripSqlExt(fileNameLower) === deletingBaseLower)) return true;
                      if (nameLower === deletingBaseLower) return true;
                      return false;
                    })
                    .map((t) => t.id);
                  toClose.forEach((id) => closeTab(id));
                  if (toClose.length > 0 && visibleTabs.length - toClose.length <= 0) {
                    createTab({ content: "", connectionId, database: activeConn?.database ?? "" });
                  }
                  const items = await invokeJson<{ name: string }[]>("list_scripts", { connectionId });
                  setScriptItems(items.map((s) => s.name));
                  setOpenSelectedScript("");
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  await useDialogStore.getState().alert({ title: "Delete failed", message: msg });
                } finally {
                  setSaving(false);
                }
              }}
              title="Delete saved script"
            >
              <Trash2 className="size-4" />
              Delete
            </Button>
          ) : null}
        </div>

        <Modal
          open={openScriptOpen}
          title="Open saved script"
          onClose={() => {
            if (saving) return;
            setOpenScriptOpen(false);
          }}
          className="max-w-lg"
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="text-xs text-zinc-300">Saved scripts</div>
              <select
                className="h-9 w-full rounded-md border border-zinc-300/20 bg-white px-2 text-sm text-black disabled:opacity-60"
                value={openSelectedScript}
                disabled={!activeConnectionId || scriptLoading || saving}
                onChange={(e) => setOpenSelectedScript(e.currentTarget.value)}
              >
                <option value="">{scriptLoading ? "Loading scripts…" : "Select a script…"}</option>
                {scriptItems.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setOpenScriptOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!activeConnectionId || !openSelectedScript || saving || scriptLoading}
                onClick={async () => {
                  if (!activeConnectionId) return;
                  if (!openSelectedScript) return;
                  setSaving(true);
                  try {
                    const content = await invokeJson<string>("load_script", { connectionId: activeConnectionId, name: openSelectedScript });
                    createTab({
                      name: stripSqlExt(openSelectedScript),
                      fileName: openSelectedScript,
                      content,
                      isSaved: true,
                      connectionId: activeConnectionId,
                      database: activeConn?.database ?? "",
                    });
                    setOpenScriptOpen(false);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    await useDialogStore.getState().alert({ title: "Open failed", message: msg });
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Open
              </Button>
            </div>
          </div>
        </Modal>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1 overflow-auto rounded-lg border border-white/10 bg-white/3 p-1">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                className={`group flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition ${
                  t.id === activeTabId ? "bg-white/10 text-zinc-100" : "text-zinc-300 hover:bg-white/6 hover:text-zinc-100"
                }`}
                onClick={() => setActive(t.id)}
                title={t.fileName ? `${t.name} (${t.fileName})` : t.name}
              >
                <span className="truncate">{t.name}{t.isSaved ? "" : " *"}</span>
                {visibleTabs.length > 1 ? (
                  <span
                    className="grid size-5 place-items-center rounded hover:bg-white/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  >
                    ×
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
