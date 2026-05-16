import React, { useState } from "react";
import { api } from "../lib/api";

type Person = {
  record_id: string;
  name: string;
  job_title?: string;
  email?: string;
  linkedin?: string;
  twitter?: string;
  location?: string;
  avatar_url?: string;
  bio?: string;
  rag_score?: number;
  fit_score?: number | null;
  reason?: string;
};

// Preset searches. The first is an example use case (Sphere — data
// anonymization); the rest are generic. Sphere is just a prompt, not built in.
const PRESETS: { label: string; q: string; uc: string }[] = [
  {
    label: "Sphere pilot prospects",
    q: "founders, data leaders and ML engineers at companies holding sensitive data — healthcare, fintech, HR",
    uc: "Sphere anonymizes PII/PHI in datasets without degrading data quality or model performance. Find pilot customers and case-study partners: people whose company sits on sensitive data they cannot fully use for AI/analytics due to HIPAA/GDPR/CCPA or data-sharing limits.",
  },
  { label: "AI dev-tool founders", q: "early-stage founders building AI developer tools and infrastructure", uc: "" },
  { label: "Enterprise / AI investors", q: "venture capital investors and partners focused on AI and enterprise software", uc: "" },
  { label: "Healthcare founders", q: "founders and operators building in healthcare and digital health", uc: "" },
];

function scoreClass(n?: number | null) {
  if (n == null) return "ps-lo";
  if (n >= 70) return "ps-hi";
  if (n >= 45) return "ps-mid";
  return "ps-lo";
}
function initials(name: string) {
  return (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
}

export function PeopleSearch({ open, onClose, onOpenRecord }: any) {
  const [query, setQuery] = useState("");
  const [useCase, setUseCase] = useState("");
  const [topK, setTopK] = useState(12);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [status, setStatus] = useState("");

  const run = async (q?: string, uc?: string) => {
    const qq = (q ?? query).trim();
    if (!qq || busy) return;
    if (q !== undefined) {
      setQuery(q);
      setUseCase(uc || "");
    }
    const ucc = (uc ?? useCase).trim();
    setBusy(true);
    setStatus("Searching ~11k contacts — retrieving + reranking…");
    setPeople(null);
    const t0 = Date.now();
    try {
      const r = await api.peopleSearch(qq, ucc, topK);
      const list: Person[] = r.people || [];
      setPeople(list);
      setStatus(
        list.length
          ? `${list.length} results · ${r.ranked ? "fit-ranked" : "RAG order"} · ${((Date.now() - t0) / 1000).toFixed(1)}s`
          : "No matches — try broader wording.",
      );
    } catch (e: any) {
      setStatus("Error: " + e.message);
      setPeople([]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="chat-backdrop" onClick={onClose} />
      <div className="chat-drawer">
        <div className="chat-header">
          <div>
            <div className="chat-title">🔍 People Search</div>
            <div className="chat-sub">RAG search · ~11k contacts · LLM fit-ranked</div>
          </div>
          <button onClick={onClose}>✕</button>
        </div>

        <div className="ps-form">
          <textarea
            className="ps-input"
            rows={2}
            value={query}
            placeholder="Who are you looking for? e.g. founders at companies handling sensitive data"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
            }}
          />
          <textarea
            className="ps-input"
            rows={2}
            value={useCase}
            placeholder="Use case / context (optional) — what the fit score is judged against"
            onChange={(e) => setUseCase(e.target.value)}
          />
          <div className="ps-row">
            <select className="ps-select" value={topK} onChange={(e) => setTopK(+e.target.value)}>
              {[8, 12, 20, 30].map((n) => (
                <option key={n} value={n}>{n} results</option>
              ))}
            </select>
            <button className="btn btn-accent" disabled={busy} onClick={() => run()}>
              {busy ? "Searching…" : "Search"}
            </button>
          </div>
          <div className="ps-chips">
            {PRESETS.map((p, i) => (
              <button
                key={i}
                className={"ps-chip" + (i === 0 ? " ps-chip-star" : "")}
                onClick={() => run(p.q, p.uc)}
              >
                {i === 0 ? "★ " : ""}
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="chat-body">
          {status && <div className="ps-status">{status}</div>}
          {people &&
            people.map((p, i) => (
              <div key={p.record_id} className="ps-card" onClick={() => onOpenRecord(p.record_id)}>
                {p.avatar_url ? (
                  <img
                    className="ps-av"
                    src={p.avatar_url}
                    alt=""
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  <div className="ps-av ps-av-ph">{initials(p.name)}</div>
                )}
                <div className="ps-cardbody">
                  <div className="ps-name-row">
                    <span className="ps-name">{p.name}</span>
                    <span className="ps-rank">#{i + 1}</span>
                  </div>
                  <div className="ps-title">
                    {[p.job_title, p.location].filter(Boolean).join(" · ") || " "}
                  </div>
                  {p.reason && <div className="ps-reason">{p.reason}</div>}
                  <div className="ps-links">
                    {p.linkedin && (
                      <a href={p.linkedin} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        LinkedIn
                      </a>
                    )}
                    {p.email && (
                      <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}>
                        {p.email}
                      </a>
                    )}
                    {p.rag_score != null && <span className="ps-muted">match {p.rag_score}</span>}
                  </div>
                </div>
                <div className={"ps-score " + scoreClass(p.fit_score)}>
                  <b>{p.fit_score != null ? p.fit_score : "–"}</b>
                  <small>fit</small>
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
