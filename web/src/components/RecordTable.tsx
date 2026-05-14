import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { TableToolbar } from "./TableToolbar";

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
  const [filters, setFilters] = useState<any[]>([]);
  const [sort, setSort] = useState<any>(null);
  const [groupBy, setGroupBy] = useState<any>("auto");
  const [hidden, setHidden] = useState<string[]>([]);

  // Reset state on object switch
  useEffect(() => { setFilters([]); setSort(null); setGroupBy("auto"); setHidden([]); }, [objectSlug, listId]);

  useEffect(() => {
    setLoading(true);
    const filterObj: any = {};
    for (const f of filters) filterObj[f.attr_slug] = f.value;
    api.records.query({ object: objectSlug, list_id: listId || undefined, limit: 200, filter: filterObj, sort: sort || undefined })
      .then(setData)
      .catch(() => setData({ records: [], attributes: [], total: 0 }))
      .finally(() => setLoading(false));
  }, [objectSlug, listId, filters, sort]);

  // Hide noisy system-y columns + raw actor refs + user-hidden
  const HIDE_SLUGS = new Set(["record_id", "created_at", "created_by", "updated_at", "updated_by", "id", ...hidden]);
  const HIDE_TYPES = new Set(["actor-reference"]);

  const toolbar = (
    <TableToolbar
      attributes={data.attributes}
      filters={filters} setFilters={setFilters}
      sort={sort} setSort={setSort}
      groupBy={groupBy} setGroupBy={setGroupBy}
      hidden={hidden} setHidden={setHidden}
      total={data.total} visibleCount={data.records.length}
    />
  );

  if (loading) return <>{toolbar}<div className="empty">Loading…</div></>;
  if (!data.records.length) {
    return (
      <>
        {toolbar}
        <div className="empty">
          <h2>{filters.length ? "No matches" : "No records yet"}</h2>
          <div>{filters.length ? "Clear or adjust filters above." : `Click "+ New" above to add your first ${objectSlug.replace(/s$/, "")}.`}</div>
        </div>
      </>
    );
  }

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

  // Group by first populated select/status attr, if any
  const normGroup = (v: any): string => {
    if (v == null || v === "") return "";
    if (Array.isArray(v)) return String(v[0] ?? "");
    if (typeof v === "string" && v.startsWith("[")) { try { return String(JSON.parse(v)[0] ?? ""); } catch { return v; } }
    return String(v);
  };
  let groupAttr: any = null;
  if (groupBy === "auto") {
    groupAttr = visibleAttrs.find((a: any) =>
      (a.type === "select" || a.type === "status") &&
      data.records.some((r: any) => r.values[a.slug] != null && r.values[a.slug] !== "")
    );
  } else if (groupBy) {
    groupAttr = visibleAttrs.find((a: any) => a.slug === groupBy);
  }
  const sortedRecords = groupAttr
    ? [...data.records].sort((a: any, b: any) => normGroup(a.values[groupAttr.slug]).localeCompare(normGroup(b.values[groupAttr.slug])))
    : data.records;

  const toggleSort = (slug: string) => {
    if (sort?.attr_slug !== slug) setSort({ attr_slug: slug, dir: "asc" });
    else if (sort.dir === "asc") setSort({ attr_slug: slug, dir: "desc" });
    else setSort(null);
  };

  return (
    <>
      {toolbar}
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((a: any) => (
              <th key={a.id} onClick={() => toggleSort(a.slug)} style={{ cursor: "pointer" }}>
                {a.name}{sort?.attr_slug === a.slug ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
              </th>
            ))}
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            const rendered: any[] = [];
            let lastGroup: string | null = null;
            for (const r of sortedRecords) {
              if (groupAttr) {
                const g = normGroup(r.values[groupAttr.slug]) || "—";
                if (g !== lastGroup) {
                  rendered.push(
                    <tr key={`g-${g}`} className="group-row">
                      <td colSpan={columns.length + 1}>
                        <span className="group-label">{groupAttr.name}</span> · {g}
                      </td>
                    </tr>
                  );
                  lastGroup = g;
                }
              }
              rendered.push(
                <tr key={r.id} onClick={() => onOpenRecord(r.id)}>
                  {columns.map((a: any, i: number) => (
                    <td key={a.id} className={i === 0 ? "name" : ""}>
                      {renderValue(r.values[a.slug], a.type)}
                    </td>
                  ))}
                  <td style={{ color: "var(--text-3)", fontSize: 11 }}>{new Date(r.updated_at).toLocaleDateString()}</td>
                </tr>
              );
            }
            return rendered;
          })()}
        </tbody>
      </table>
    </div>
    </>
  );
}
