import React, { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";

type Msg = { role: "user" | "assistant"; content: string; citations?: any[] };

const SUGGESTIONS = [
  "What are the next set of business opportunities for sponsorship?",
  "Which founders should I introduce to LPs this month?",
  "Who are the most active hackathon builders?",
  "Show me companies that look like AI infra plays.",
  "Which experts have I not engaged in 60+ days?"
];

export function ChatPanel({ open, onClose, onOpenRecord }: any) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [msgs, busy]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    const userMsg: Msg = { role: "user", content: q };
    const history = [...msgs, userMsg];
    setMsgs(history);
    setInput("");
    setBusy(true);
    try {
      const r = await api.ask(q, msgs.map(m => ({ role: m.role, content: m.content })));
      setMsgs([...history, { role: "assistant", content: r.answer, citations: r.citations || [] }]);
    } catch (e: any) {
      setMsgs([...history, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally { setBusy(false); }
  };

  if (!open) return null;

  // Render assistant content with [N] → clickable citation pills inline
  function renderAssistant(text: string, citations?: any[]) {
    if (!citations?.length) return <>{text}</>;
    const map: Record<number, any> = {};
    for (const c of citations) map[c.index] = c;
    const parts = text.split(/(\[\d+\])/g);
    return (
      <>
        {parts.map((p, i) => {
          const m = p.match(/^\[(\d+)\]$/);
          if (m) {
            const cit = map[+m[1]];
            if (cit?.record_id) {
              return <button key={i} className="cite-chip" onClick={() => onOpenRecord(cit.record_id, cit.object_slug)}>{cit.name || `[${m[1]}]`}</button>;
            }
            return <span key={i} className="cite-chip">{p}</span>;
          }
          return <React.Fragment key={i}>{p}</React.Fragment>;
        })}
      </>
    );
  }

  return (
    <>
      <div className="chat-backdrop" onClick={onClose} />
      <div className="chat-drawer">
        <div className="chat-header">
          <div>
            <div className="chat-title">🧈 Ask butterCRM</div>
            <div className="chat-sub">Chat with your CRM · grounded in 16k records</div>
          </div>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="chat-body" ref={bodyRef}>
          {!msgs.length && (
            <div className="chat-suggestions">
              <div className="muted">Try one of these:</div>
              {SUGGESTIONS.map((s, i) => (
                <button key={i} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.role === "assistant" ? renderAssistant(m.content, m.citations) : m.content}
              {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                <div className="chat-citations">
                  {m.citations.slice(0, 8).map(c => (
                    <button key={c.index} className="cite-card" onClick={() => onOpenRecord(c.record_id, c.object_slug)}>
                      <span className="cite-num">[{c.index}]</span>
                      <div>
                        <div className="cite-name">{c.name || c.record_id?.slice(0, 8)}</div>
                        <div className="cite-meta">{c.singular_noun} · {(c.score * 100).toFixed(0)}%</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {busy && <div className="chat-msg assistant chat-thinking">Searching CRM…</div>}
        </div>
        <form className="chat-composer" onSubmit={e => { e.preventDefault(); ask(input); }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask anything about your CRM…"
            rows={2}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); }
            }}
          />
          <button type="submit" className="btn btn-accent" disabled={busy}>{busy ? "…" : "Send"}</button>
        </form>
      </div>
    </>
  );
}
