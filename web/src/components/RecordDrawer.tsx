import React, { useEffect, useState } from "react";
import { api } from "../lib/api";

export function RecordDrawer({ recordId, objectSlug, onClose, onUpdate, flash }: any) {
  const [record, setRecord] = useState<any>(null);
  const [attrs, setAttrs] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [vals, setVals] = useState<Record<string, any>>({});
  const [agentLog, setAgentLog] = useState<any[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [enriching, setEnriching] = useState(false);

  const load = async () => {
    const r = await api.records.query({ object: objectSlug, limit: 200 });
    const rec = r.records.find((x: any) => x.id === recordId);
    setRecord(rec);
    setAttrs(r.attributes);
    setVals(rec?.values || {});
    const [n, t] = await Promise.all([api.notes.list(recordId), api.tasks.list(recordId)]);
    setNotes(n.items || []);
    setTasks(t.items || []);
  };

  useEffect(() => { load(); }, [recordId]);

  const saveField = async (slug: string, value: any) => {
    const next = { ...vals, [slug]: value };
    setVals(next);
    await api.records.upsert({ object: objectSlug, record_id: recordId, values: { [slug]: value } });
    onUpdate?.();
  };

  const addNote = async () => {
    if (!noteTitle && !noteBody) return;
    await api.notes.create({ parent_record_id: recordId, title: noteTitle, body_md: noteBody });
    setNoteTitle(""); setNoteBody("");
    const n = await api.notes.list(recordId);
    setNotes(n.items || []);
  };

  const addTask = async () => {
    if (!taskTitle) return;
    await api.tasks.create({ parent_record_id: recordId, title: taskTitle });
    setTaskTitle("");
    const t = await api.tasks.list(recordId);
    setTasks(t.items || []);
  };

  const toggleTask = async (task: any) => {
    await api.tasks.update({ id: task.id, completed: !task.completed_at });
    const t = await api.tasks.list(recordId);
    setTasks(t.items || []);
  };

  const enrich = async () => {
    setEnriching(true);
    try {
      const r = await api.enrich(recordId);
      if (r.inferred) {
        await api.records.upsert({ object: objectSlug, record_id: recordId, values: r.inferred });
        flash?.(`Enriched ${Object.keys(r.inferred).length} fields`);
        load();
      } else {
        flash?.(r.message || "Nothing to enrich");
      }
    } catch (e: any) {
      flash?.("Enrich failed: " + e.message);
    } finally { setEnriching(false); }
  };

  const askAgent = async () => {
    if (!agentInput.trim()) return;
    const userMsg = agentInput;
    setAgentLog(l => [...l, { role: "user", text: userMsg }]);
    setAgentInput("");
    setAgentBusy(true);
    try {
      const r = await api.agent(recordId, userMsg);
      setAgentLog(l => [...l, { role: "assistant", text: r.reply || "(no reply)" }]);
    } catch (e: any) {
      setAgentLog(l => [...l, { role: "assistant", text: "Error: " + e.message }]);
    } finally { setAgentBusy(false); }
  };

  if (!record) return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer"><div className="drawer-body">Loading…</div></div>
    </>
  );

  const displayName = vals.name || "Untitled";

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div className="name">{typeof displayName === "object" ? JSON.stringify(displayName) : displayName}</div>
          <button onClick={enrich} disabled={enriching}>{enriching ? "Enriching…" : "✨ Enrich"}</button>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="drawer-body">
          {attrs.filter(a => !["record_id","created_at","created_by","updated_at","updated_by","id"].includes(a.slug) && a.type !== "actor-reference").map(a => (
            <div className="field-row" key={a.id}>
              <div className="label">{a.name}</div>
              <div className="value">
                <FieldEditor
                  attr={a}
                  value={vals[a.slug]}
                  onSave={v => saveField(a.slug, v)}
                />
              </div>
            </div>
          ))}

          <div className="section">
            <h3>Notes ({notes.length})</h3>
            {notes.map(n => (
              <div className="note" key={n.id}>
                {n.title && <div className="title">{n.title}</div>}
                <div className="body">{n.body_md}</div>
              </div>
            ))}
            <div className="composer">
              <input value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Note title (optional)" />
              <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder="Write a note…" />
              <button className="btn btn-accent" onClick={addNote} style={{ alignSelf: "flex-start" }}>+ Add note</button>
            </div>
          </div>

          <div className="section">
            <h3>Tasks ({tasks.length})</h3>
            {tasks.map(t => (
              <div className={"task" + (t.completed_at ? " completed" : "")} key={t.id}>
                <span className={"check" + (t.completed_at ? " done" : "")} onClick={() => toggleTask(t)} />
                <span className="title">{t.title}</span>
                {t.due_at && <span className="due">{new Date(t.due_at).toLocaleDateString()}</span>}
              </div>
            ))}
            <div className="composer">
              <input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Add a task…" onKeyDown={e => e.key === "Enter" && addTask()} />
              <button className="btn btn-accent" onClick={addTask} style={{ alignSelf: "flex-start" }}>+ Add task</button>
            </div>
          </div>

          <div className="agent-panel">
            <h3>🤖 AI agent</h3>
            <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>Draft emails, summarize, plan follow-ups</div>
            {agentLog.map((m, i) => (
              <div key={i} className={"agent-msg" + (m.role === "user" ? " user" : "")}>{m.text}</div>
            ))}
            <div className="composer">
              <textarea value={agentInput} onChange={e => setAgentInput(e.target.value)} placeholder='e.g. "Draft a follow-up email" or "Summarize my notes"' />
              <button className="btn btn-accent" onClick={askAgent} disabled={agentBusy} style={{ alignSelf: "flex-start" }}>
                {agentBusy ? "Thinking…" : "Ask"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FieldEditor({ attr, value, onSave }: any) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => { if (v !== value) onSave(v); };

  if (attr.type === "record-reference") {
    return value ? <span className="ref">↪ {value.label || value.id?.slice(0, 8)}</span> : <span className="empty-val">—</span>;
  }
  if (attr.type === "checkbox") {
    return <input type="checkbox" checked={!!v} onChange={e => onSave(e.target.checked)} />;
  }
  if (attr.type === "date" || attr.type === "timestamp") {
    const d = v ? new Date(v).toISOString().slice(0, 10) : "";
    return <input type="date" value={d} onChange={e => onSave(e.target.value)} />;
  }
  if (attr.type === "number" || attr.type === "currency" || attr.type === "rating") {
    return <input type="number" value={v ?? ""} onChange={e => setV(e.target.value)} onBlur={commit} placeholder="—" />;
  }
  const stringVal = typeof v === "object" ? JSON.stringify(v) : (v ?? "");
  return <input value={stringVal} onChange={e => setV(e.target.value)} onBlur={commit} placeholder="—" />;
}
