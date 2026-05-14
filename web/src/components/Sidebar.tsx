import React from "react";
import { getSession, logout } from "../lib/auth";

const ICON: Record<string, string> = {
  user: "👤", building: "🏢", "currency-dollar": "💰", tag: "🏷️",
  star: "⭐", folder: "📁", briefcase: "💼"
};

export function Sidebar({ objects, lists, activeObject, activeListId, onSelectObject, onSelectList, onNewObject }: any) {
  const session = getSession();
  return (
    <div className="sidebar">
      <div className="brand">
        <span className="logo">🧈</span>
        <span>butterCRM</span>
      </div>

      <div className="section-label">Objects</div>
      {objects.map((o: any) => (
        <button
          key={o.id}
          className={"nav-item" + (activeObject === o.slug && !activeListId ? " active" : "")}
          onClick={() => onSelectObject(o.slug)}
        >
          <span className="icon">{ICON[o.icon] || "📋"}</span>
          <span>{o.plural_noun}</span>
          <span className="count">{o.record_count}</span>
        </button>
      ))}
      <button className="add-btn nav-item" onClick={onNewObject}>+ New object</button>

      {lists.length > 0 && <div className="section-label">Lists</div>}
      {lists.map((l: any) => (
        <button
          key={l.id}
          className={"nav-item" + (activeListId === l.id ? " active" : "")}
          onClick={() => onSelectList(l)}
        >
          <span className="icon">{ICON[l.icon] || "📑"}</span>
          <span>{l.name}</span>
          <span className="count">{l.entry_count}</span>
        </button>
      ))}
      {session && (
        <div className="sidebar-user">
          <div className="email">{session.user.display_name || session.user.email}</div>
          <button onClick={logout}>Sign out</button>
        </div>
      )}
    </div>
  );
}
