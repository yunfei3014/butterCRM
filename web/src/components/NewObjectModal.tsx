import React, { useState } from "react";
import { api } from "../lib/api";

export function NewObjectModal({ onClose, onCreated }: any) {
  const [singular, setSingular] = useState("");
  const [plural, setPlural] = useState("");
  const [icon, setIcon] = useState("tag");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!singular || !plural) return;
    setBusy(true);
    try {
      const slug = plural.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      await api.objects.create({ slug, singular_noun: singular, plural_noun: plural, icon });
      onCreated();
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>New object</h2>
        <div className="field">
          <label>Singular noun</label>
          <input value={singular} onChange={e => setSingular(e.target.value)} placeholder="e.g. Investor" />
        </div>
        <div className="field">
          <label>Plural noun</label>
          <input value={plural} onChange={e => setPlural(e.target.value)} placeholder="e.g. Investors" />
        </div>
        <div className="field">
          <label>Icon</label>
          <select value={icon} onChange={e => setIcon(e.target.value)}>
            <option value="tag">🏷️ Tag</option>
            <option value="user">👤 User</option>
            <option value="building">🏢 Building</option>
            <option value="currency-dollar">💰 Money</option>
            <option value="briefcase">💼 Briefcase</option>
            <option value="star">⭐ Star</option>
            <option value="folder">📁 Folder</option>
          </select>
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-accent" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}
