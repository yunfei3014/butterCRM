import { getToken, logout } from "./auth";

const BASE = (import.meta.env.VITE_API_URL as string) || "https://api.butterbase.ai/v1/app_hz4h4bcpu63n";

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function call(path: string, body?: any, method: string = "POST") {
  const res = await fetch(`${BASE}/fn/${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { logout(); throw new Error("session expired"); }
  if (res.status === 403) throw new Error("forbidden — domain not allowed");
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${path} ${res.status}: ${t}`);
  }
  return res.json();
}

async function callGet(path: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/fn/${path}${q ? "?" + q : ""}`, { headers: { ...authHeaders() } });
  if (res.status === 401) { logout(); throw new Error("session expired"); }
  if (res.status === 403) throw new Error("forbidden — domain not allowed");
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  objects: {
    list: () => callGet("objects"),
    create: (b: any) => call("objects", { action: "create", ...b }),
    update: (b: any) => call("objects", { action: "update", ...b }),
    delete: (id: string) => call("objects", { action: "delete", id })
  },
  attributes: {
    list: (object: string) => callGet("attributes", { object }),
    create: (b: any) => call("attributes", { action: "create", ...b }),
    update: (b: any) => call("attributes", { action: "update", ...b }),
    delete: (id: string) => call("attributes", { action: "delete", id })
  },
  records: {
    query: (b: any) => call("records-query", b),
    upsert: (b: any) => call("records-upsert", b)
  },
  lists: {
    list: (object?: string) => callGet("lists", object ? { object } : {}),
    create: (b: any) => call("lists", { action: "create", ...b }),
    addEntries: (list_id: string, record_ids: string[]) => call("lists", { action: "add_entries", list_id, record_ids }),
    removeEntry: (list_id: string, record_id: string) => call("lists", { action: "remove_entry", list_id, record_id }),
    delete: (id: string) => call("lists", { action: "delete", id })
  },
  notes: {
    list: (record_id: string) => callGet("notes-tasks", { type: "notes", record_id }),
    create: (b: any) => call("notes-tasks?type=notes", { action: "create", ...b }),
    update: (b: any) => call("notes-tasks?type=notes", { action: "update", ...b }),
    delete: (id: string) => call("notes-tasks?type=notes", { action: "delete", id })
  },
  tasks: {
    list: (record_id: string) => callGet("notes-tasks", { type: "tasks", record_id }),
    create: (b: any) => call("notes-tasks?type=tasks", { action: "create", ...b }),
    update: (b: any) => call("notes-tasks?type=tasks", { action: "update", ...b }),
    delete: (id: string) => call("notes-tasks?type=tasks", { action: "delete", id })
  },
  search: (q: string, object_slug?: string) => call("search", { q, object_slug }),
  enrich: (record_id: string) => call("enrich", { record_id }),
  agent: (record_id: string, prompt: string) => call("agent", { record_id, prompt }),
  ask: (query: string, history: any[] = [], object_slug?: string) => call("ask", { query, history, object_slug }),
  bootstrap: () => call("bootstrap", {})
};
