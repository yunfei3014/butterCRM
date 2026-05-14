import React, { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";

const ICON: Record<string, string> = {
  user: "👤", building: "🏢", "currency-dollar": "💰", tag: "🏷️"
};

export function Topbar({ title, objectSlug, onOpenRecord, onNewRecord }: any) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) { setResults(null); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const r = await api.search(q);
        setResults(r.records || []);
      } catch (e) {
        setResults([]);
      } finally { setLoading(false); }
    }, 250);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as any)) setResults(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="topbar">
      <div className="title">{title}</div>
      <div className="search" ref={wrapRef}>
        <span className="icon">⌕</span>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name or natural language…"
          onFocus={() => q.trim() && results !== null && setResults(results)}
        />
        {results !== null && (
          <div className="search-results">
            {loading && <div className="result">Searching…</div>}
            {!loading && !results.length && <div className="result">No matches</div>}
            {results.map(r => (
              <div key={r.id} className="result" onMouseDown={() => { onOpenRecord(r.id); setResults(null); setQ(""); }}>
                <span>{ICON[r.icon] || "📋"}</span>
                <span>{r.display_name || r.search_text?.split("\n")[0] || r.id.slice(0, 8)}</span>
                <span className="obj">· {r.singular_noun}</span>
                <span className="src">{r.source}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <button className="btn-primary" onClick={onNewRecord}>+ New</button>
    </div>
  );
}
