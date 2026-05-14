import React, { useEffect, useState, useCallback } from "react";
import { api } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { RecordTable } from "./components/RecordTable";
import { RecordDrawer } from "./components/RecordDrawer";
import { NewObjectModal } from "./components/NewObjectModal";
import { ChatPanel } from "./components/ChatPanel";
import { Login } from "./components/Login";
import { getSession, logout, isAllowedDomain } from "./lib/auth";

export function App() {
  const [session, setSession] = useState(getSession());
  if (!session) return <Login onSession={setSession} />;
  if (!isAllowedDomain(session.user.email)) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>🚫 Access denied</h1>
          <p>This workspace is limited to <strong>@betauniversity.org</strong> and <strong>@betafund.ai</strong>.</p>
          <button className="btn btn-accent" onClick={logout}>Sign out</button>
        </div>
      </div>
    );
  }
  return <AuthedApp session={session} />;
}

function AuthedApp({ session }: any) {
  const [objects, setObjects] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [activeObject, setActiveObject] = useState<string>("people");
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showNewObject, setShowNewObject] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(() => setRefreshKey(k => k + 1), []);
  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2000); }, []);

  useEffect(() => {
    api.objects.list().then(d => setObjects(d.objects || []));
    api.lists.list().then(d => setLists(d.lists || []));
  }, [refreshKey]);

  const onSelectObject = (slug: string) => {
    setActiveObject(slug);
    setActiveListId(null);
  };
  const onSelectList = (l: any) => {
    setActiveObject(l.object_slug);
    setActiveListId(l.id);
  };

  const activeObjectMeta = objects.find(o => o.slug === activeObject);
  const activeListMeta = activeListId ? lists.find(l => l.id === activeListId) : null;

  return (
    <div className="app">
      <Sidebar
        objects={objects}
        lists={lists}
        activeObject={activeObject}
        activeListId={activeListId}
        onSelectObject={onSelectObject}
        onSelectList={onSelectList}
        onNewObject={() => setShowNewObject(true)}
      />
      <div className="main">
        <Topbar
          title={activeListMeta ? activeListMeta.name : (activeObjectMeta?.plural_noun || activeObject)}
          objectSlug={activeObject}
          onOpenRecord={setOpenRecordId}
          onNewRecord={async () => {
            const out = await api.records.upsert({ object: activeObject, values: { name: "Untitled" } });
            setOpenRecordId(out.record_id);
            reload();
          }}
        />
        <div className="content">
          <RecordTable
            key={`${activeObject}-${activeListId}-${refreshKey}`}
            objectSlug={activeObject}
            listId={activeListId}
            onOpenRecord={setOpenRecordId}
          />
        </div>
      </div>
      {openRecordId && (
        <RecordDrawer
          recordId={openRecordId}
          objectSlug={activeObject}
          onClose={() => { setOpenRecordId(null); reload(); }}
          onUpdate={reload}
          flash={flash}
        />
      )}
      {showNewObject && (
        <NewObjectModal onClose={() => setShowNewObject(false)} onCreated={() => { setShowNewObject(false); reload(); }} />
      )}
      <button className="chat-fab" onClick={() => setChatOpen(true)} title="Ask butterCRM">
        <span style={{ fontSize: 20 }}>💬</span>
      </button>
      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        onOpenRecord={(id: string, objSlug?: string) => {
          if (objSlug) setActiveObject(objSlug);
          setOpenRecordId(id);
          setChatOpen(false);
        }}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
