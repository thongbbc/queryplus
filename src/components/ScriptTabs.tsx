import { FolderOpen, Plus, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import { useEditorStore } from "../stores/editorStore";
import { invokeJson } from "../lib/invoke";
import { Button } from "./ui/Button";

function stripSqlExt(name: string): string {
  return name.toLowerCase().endsWith(".sql") ? name.slice(0, -4) : name;
}

export function ScriptTabs() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { tabs, activeTabId, setActive, closeTab, createTab, markSaved, renameTab } = useEditorStore();

  const activeConn = useMemo(() => connections.find((c) => c.id === activeConnectionId) ?? null, [connections, activeConnectionId]);
  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? null, [tabs, activeTabId]);

  const [saving, setSaving] = useState(false);
  const [scriptItems, setScriptItems] = useState<string[]>([]);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [selectedScript, setSelectedScript] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!activeConnectionId) {
        setScriptItems([]);
        setSelectedScript("");
        return;
      }
      setScriptLoading(true);
      try {
        const items = await invokeJson<{ name: string }[]>("list_scripts", { connectionId: activeConnectionId });
        if (cancelled) return;
        const names = items.map((s) => s.name);
        setScriptItems(names);
        setSelectedScript((prev) => (prev && names.includes(prev) ? prev : ""));
      } catch {
        if (cancelled) return;
        setScriptItems([]);
        setSelectedScript("");
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
  const canOpen = !!activeConnectionId && !!selectedScript && !saving;

  return (
    <div className="border-b border-white/10 bg-[color:var(--editor-bg)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => createTab({ content: "" })}>
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

              const nameInput = existing ? suggested : window.prompt("Script name (.sql):", suggested);
              if (!nameInput) return;
              const name = nameInput.toLowerCase().endsWith(".sql") ? nameInput : `${nameInput}.sql`;

              setSaving(true);
              try {
                await invokeJson<void>("save_script", { connectionId: activeConnectionId, name, content: activeTab.content ?? "" });
                markSaved(activeTab.id, name);
                renameTab(activeTab.id, stripSqlExt(name));
                const items = await invokeJson<{ name: string }[]>("list_scripts", { connectionId: activeConnectionId });
                setScriptItems(items.map((s) => s.name));
                setSelectedScript(name);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                window.alert(msg);
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
          <select
            className="h-8 min-w-[240px] rounded-md border border-zinc-300/50 bg-white px-2 text-xs text-black disabled:opacity-60"
            value={selectedScript}
            disabled={!activeConnectionId || scriptLoading}
            onChange={(e) => setSelectedScript(e.currentTarget.value)}
          >
            <option value="">{scriptLoading ? "Loading scripts…" : "Open saved script…"}</option>
            {scriptItems.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canOpen}
            onClick={async () => {
              if (!activeConnectionId) return;
              if (!selectedScript) return;
              try {
                const content = await invokeJson<string>("load_script", { connectionId: activeConnectionId, name: selectedScript });
                createTab({
                  name: stripSqlExt(selectedScript),
                  fileName: selectedScript,
                  content,
                  isSaved: true,
                  connectionId: activeConnectionId,
                  database: activeConn?.database ?? "",
                });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                window.alert(msg);
              }
            }}
            title="Open script"
          >
            <FolderOpen className="size-4" />
            Open
          </Button>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1 overflow-auto rounded-lg border border-white/10 bg-white/3 p-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`group flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition ${
                  t.id === activeTabId ? "bg-white/10 text-zinc-100" : "text-zinc-300 hover:bg-white/6 hover:text-zinc-100"
                }`}
                onClick={() => setActive(t.id)}
                title={t.fileName ? `${t.name} (${t.fileName})` : t.name}
              >
                <span className="truncate">{t.name}{t.isSaved ? "" : " *"}</span>
                {tabs.length > 1 ? (
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

