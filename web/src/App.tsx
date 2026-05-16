import React, { useEffect, useState, useCallback } from "react";
import { api } from "./lib/api";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { RecordTable } from "./components/RecordTable";
import { RecordDrawer } from "./components/RecordDrawer";
import { NewObjectModal } from "./components/NewObjectModal";
import { ChatPanel } from "./components/ChatPanel";
import { PeopleSearch } from "./components/PeopleSearch";
import { AIBanner } from "./components/AIBanner";
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
  // AI chat is the default entry point — opens automatically until the user dismisses the banner
  const [chatOpen, setChatOpen] = useState(localStorage.getItem("buttercrm.banner.ai.dismissed") !== "1");
  const [toast, setToast] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

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
        onOpenSearch={() => setSearchOpen(true)}
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
        <AIBanner onOpenChat={() => setChatOpen(true)} />
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
      <button className="chat-fab pulse" onClick={() => setChatOpen(true)} title="Ask butterCRM AI">
        <span style={{ fontSize: 18, marginRight: 6 }}>💬</span>
        <span className="chat-fab-label">Ask AI</span>
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
      <PeopleSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenRecord={(id: string) => {
          setActiveObject("people");
          setOpenRecordId(id);
          setSearchOpen(false);
        }}
      />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
