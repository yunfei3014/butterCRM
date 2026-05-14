import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

function unwrap(v: any): string | any[] {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (s.startsWith("[") || s.startsWith("{")) {
    try { return JSON.parse(s); } catch { return v; }
  }
  return v;
}
function renderValue(v: any, type: string) {
  if (v == null || v === "") return null;
  if (type === "record-reference") {
    return <span className="ref">↪ {v.label || v.id?.slice(0, 8)}</span>;
  }
  if (type === "checkbox") return v ? "✓" : "";
  if (type === "currency") return `$${Number(v).toLocaleString()}`;
  if (type === "date" || type === "timestamp") return new Date(v).toLocaleDateString();
  const u = unwrap(v);
  if (Array.isArray(u)) {
    return <>{u.map((x, i) => <span key={i} className="pill" style={{marginRight:4}}>{String(typeof x === "object" ? x.title || x.label || JSON.stringify(x) : x)}</span>)}</>;
  }
  if (type === "status" || type === "select") {
    return <span className="pill">{String(u)}</span>;
  }
  if (typeof u === "object") return u.title || u.label || JSON.stringify(u);
  return String(u);
}

export function RecordTable({ objectSlug, listId, onOpenRecord }: any) {
  const [data, setData] = useState<any>({ records: [], attributes: [], total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.records.query({ object: objectSlug, list_id: listId || undefined, limit: 100 })
      .then(setData)
      .catch(() => setData({ records: [], attributes: [], total: 0 }))
      .finally(() => setLoading(false));
  }, [objectSlug, listId]);

  if (loading) return <div className="empty">Loading…</div>;
  if (!data.records.length) {
    return (
      <div className="empty">
        <h2>No records yet</h2>
        <div>Click "+ New" above to add your first {objectSlug.replace(/s$/, "")}.</div>
      </div>
    );
  }

  // Hide noisy system-y columns + raw actor refs
  const HIDE_SLUGS = new Set(["record_id", "created_at", "created_by", "updated_at", "updated_by", "id"]);
  const HIDE_TYPES = new Set(["actor-reference"]);

  const fillCount: Record<string, number> = {};
  for (const r of data.records) {
    for (const [k, v] of Object.entries(r.values)) {
      if (v != null && v !== "") fillCount[k] = (fillCount[k] || 0) + 1;
    }
  }
  const visibleAttrs = data.attributes.filter((a: any) => !HIDE_SLUGS.has(a.slug) && !HIDE_TYPES.has(a.type));
  const nameAttr = visibleAttrs.find((a: any) => a.slug === "name");
  const others = visibleAttrs
    .filter((a: any) => a.slug !== "name")
    .map((a: any) => ({ ...a, fill: fillCount[a.slug] || 0 }))
    .sort((a: any, b: any) => b.fill - a.fill);
  const columns = [nameAttr, ...others].filter(Boolean).slice(0, 8);

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((a: any) => <th key={a.id}>{a.name}</th>)}
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {data.records.map((r: any) => (
            <tr key={r.id} onClick={() => onOpenRecord(r.id)}>
              {columns.map((a: any, i: number) => (
                <td key={a.id} className={i === 0 ? "name" : ""}>
                  {renderValue(r.values[a.slug], a.type)}
                </td>
              ))}
              <td style={{ color: "var(--text-3)", fontSize: 11 }}>{new Date(r.updated_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ color: "var(--text-3)", fontSize: 11, padding: "8px 10px" }}>{data.total} total</div>
    </div>
  );
}
