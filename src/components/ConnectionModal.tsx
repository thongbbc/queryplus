import { useMemo, useState } from "react";
import { Modal } from "./ui/Modal";
import { Input } from "./ui/Input";
import { Button } from "./ui/Button";
import type { ConnectionConfig, DbType } from "../types/connection";
import { defaultPort } from "../types/connection";
import { useConnectionStore } from "../stores/connectionStore";

function nowIso(): string {
  return new Date().toISOString();
}

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function ConnectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { upsert, save, testConnection, setActive } = useConnectionStore();
  const [dbType, setDbType] = useState<DbType>("postgres");
  const [name, setName] = useState("Local");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState(defaultPort("postgres"));
  const [username, setUsername] = useState("postgres");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [ssl, setSsl] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const canSave = useMemo(() => name.trim() && host.trim() && port > 0 && username.trim(), [name, host, port, username]);

  return (
    <Modal
      open={open}
      title="New Connection"
      onClose={() => {
        setTestMsg(null);
        onClose();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2">
          <div className="mb-1 text-xs text-zinc-400">Type</div>
          <select
            className="h-9 w-full rounded-md border border-zinc-300/70 bg-white px-3 text-sm text-black"
            value={dbType}
            onChange={(e) => {
              const next = e.currentTarget.value as DbType;
              setDbType(next);
              setPort(defaultPort(next));
            }}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mariadb">MariaDB</option>
          </select>
        </label>

        <label className="col-span-2">
          <div className="mb-1 text-xs text-zinc-400">Name</div>
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>

        <label>
          <div className="mb-1 text-xs text-zinc-400">Host</div>
          <Input value={host} onChange={(e) => setHost(e.currentTarget.value)} />
        </label>
        <label>
          <div className="mb-1 text-xs text-zinc-400">Port</div>
          <Input type="number" value={String(port)} onChange={(e) => setPort(Number(e.currentTarget.value))} />
        </label>

        <label>
          <div className="mb-1 text-xs text-zinc-400">Username</div>
          <Input value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
        </label>
        <label>
          <div className="mb-1 text-xs text-zinc-400">Password</div>
          <Input value={password} onChange={(e) => setPassword(e.currentTarget.value)} type="password" />
        </label>

        <label className="col-span-2">
          <div className="mb-1 text-xs text-zinc-400">Database</div>
          <Input value={database} onChange={(e) => setDatabase(e.currentTarget.value)} placeholder="(optional)" />
        </label>

        <label className="col-span-2 flex items-center justify-between rounded-md border border-white/10 bg-white/3 px-3 py-2">
          <div>
            <div className="text-sm text-zinc-100">SSL</div>
            <div className="text-xs text-zinc-500">Enable TLS (if supported by server)</div>
          </div>
          <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.currentTarget.checked)} />
        </label>
      </div>

      {testMsg ? <div className="mt-4 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200">{testMsg}</div> : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={async () => {
            setTesting(true);
            setTestMsg(null);
            try {
              const msg = await testConnection({ dbType, host, port, username, password, database, ssl });
              setTestMsg(msg);
            } catch (e) {
              const message = e instanceof Error ? e.message : String(e);
              setTestMsg(message);
            } finally {
              setTesting(false);
            }
          }}
          disabled={testing}
        >
          {testing ? "Testing" : "Test Connection"}
        </Button>

        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              const c: ConnectionConfig = {
                id: `c-${uid()}`,
                name,
                db_type: dbType,
                host,
                port,
                username,
                password,
                database,
                ssl,
                created_at: nowIso(),
                updated_at: nowIso(),
              };
              upsert(c);
              setActive(c.id);
              await save();
              setTestMsg(null);
              onClose();
            }}
            disabled={!canSave}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
