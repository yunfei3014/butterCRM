import React, { useState, useRef, useEffect } from "react";

type Filter = { attr_slug: string; value: string };
type Sort = { attr_slug: string; dir: "asc" | "desc" } | null;

export function TableToolbar({ attributes, filters, setFilters, sort, setSort, groupBy, setGroupBy, hidden, setHidden, total, visibleCount }: any) {
  const [addOpen, setAddOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);

  const visibleAttrs = attributes.filter((a: any) =>
    !["record_id","created_at","created_by","updated_at","updated_by","id"].includes(a.slug) && a.type !== "actor-reference"
  );

  return (
    <div className="toolbar">
      <div className="tb-group">
        {filters.map((f: Filter, i: number) => {
          const a = visibleAttrs.find((x: any) => x.slug === f.attr_slug);
          return (
            <div key={i} className="tb-chip">
              <span className="tb-chip-label">{a?.name || f.attr_slug}</span>
              <span className="tb-chip-op">contains</span>
              <span className="tb-chip-val">{f.value}</span>
              <button onClick={() => setFilters(filters.filter((_: any, j: number) => j !== i))}>×</button>
            </div>
          );
        })}
        <PopButton open={addOpen} setOpen={setAddOpen} label="+ Filter">
          <FilterPicker attrs={visibleAttrs} onPick={(f) => { setFilters([...filters, f]); setAddOpen(false); }} />
        </PopButton>
      </div>

      <div className="tb-group">
        <PopButton open={sortOpen} setOpen={setSortOpen} label={sort ? `Sort: ${visibleAttrs.find((a: any) => a.slug === sort.attr_slug)?.name || sort.attr_slug} ${sort.dir === "asc" ? "↑" : "↓"}` : "Sort"}>
          <div className="tb-pop">
            <div className="tb-pop-row" onClick={() => { setSort(null); setSortOpen(false); }} style={{ color: "var(--text-3)" }}>None</div>
            {visibleAttrs.map((a: any) => (
              <React.Fragment key={a.slug}>
                <div className="tb-pop-row" onClick={() => { setSort({ attr_slug: a.slug, dir: "asc" }); setSortOpen(false); }}>{a.name} ↑</div>
                <div className="tb-pop-row" onClick={() => { setSort({ attr_slug: a.slug, dir: "desc" }); setSortOpen(false); }}>{a.name} ↓</div>
              </React.Fragment>
            ))}
          </div>
        </PopButton>

        <PopButton open={groupOpen} setOpen={setGroupOpen} label={groupBy === "auto" ? "Group: auto" : groupBy === null ? "Group: none" : `Group: ${visibleAttrs.find((a: any) => a.slug === groupBy)?.name || groupBy}`}>
          <div className="tb-pop">
            <div className="tb-pop-row" onClick={() => { setGroupBy(null); setGroupOpen(false); }}>None</div>
            <div className="tb-pop-row" onClick={() => { setGroupBy("auto"); setGroupOpen(false); }}>Auto (first select)</div>
            {visibleAttrs.filter((a: any) => a.type === "select" || a.type === "status" || a.type === "text").map((a: any) => (
              <div key={a.slug} className="tb-pop-row" onClick={() => { setGroupBy(a.slug); setGroupOpen(false); }}>{a.name}</div>
            ))}
          </div>
        </PopButton>

        <PopButton open={hideOpen} setOpen={setHideOpen} label={`Fields${hidden.length ? ` (${hidden.length} hidden)` : ""}`}>
          <div className="tb-pop">
            {visibleAttrs.map((a: any) => (
              <div key={a.slug} className="tb-pop-row tb-pop-check">
                <label>
                  <input type="checkbox" checked={!hidden.includes(a.slug)} onChange={e => {
                    setHidden(e.target.checked ? hidden.filter((s: string) => s !== a.slug) : [...hidden, a.slug]);
                  }} />
                  {a.name}
                </label>
              </div>
            ))}
          </div>
        </PopButton>
      </div>

      <div className="tb-spacer" />
      <div className="tb-meta">{total} {total === 1 ? "record" : "records"}{visibleCount != null && visibleCount !== total ? ` · showing ${visibleCount}` : ""}</div>
    </div>
  );
}

function PopButton({ open, setOpen, label, children }: any) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as any)) setOpen(false); };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, [open]);
  return (
    <div className="tb-popwrap" ref={ref}>
      <button className="tb-btn" onClick={() => setOpen(!open)}>{label}</button>
      {open && children}
    </div>
  );
}

function FilterPicker({ attrs, onPick }: any) {
  const [attr, setAttr] = useState(attrs[0]?.slug || "");
  const [value, setValue] = useState("");
  return (
    <div className="tb-pop tb-pop-form" onClick={e => e.stopPropagation()}>
      <select value={attr} onChange={e => setAttr(e.target.value)}>
        {attrs.map((a: any) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
      </select>
      <input value={value} onChange={e => setValue(e.target.value)} placeholder="contains…" autoFocus />
      <button className="btn btn-accent" onClick={() => { if (value) onPick({ attr_slug: attr, value }); }}>Add</button>
    </div>
  );
}
