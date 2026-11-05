"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Trash2, MessageCircle, ChartNoAxesCombined, ExternalLink } from "lucide-react";

type Thread = { id: number; title: string; active_companion: "pixel" | "luna"; created_at: string; updated_at: string; message_count: number; preview: string | null };
type ChatMessage = { id: number; role: "student" | "assistant"; text: string; companion: "pixel" | "luna" | null; created_at: string; recommendation?: { title: string; minutes?: number; reason: string; id: string } | null };
type Dashboard = { labels: string[]; datasets: { label: string; data: number[] }[]; consented: boolean };

function TrendLine({ title, values, labels, color }: { title: string; values: number[]; labels: string[]; color: string }) {
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const spread = max - min || 1;
  const points = values.map((value, index) => ({ x: values.length < 2 ? 50 : 4 + index * (92 / (values.length - 1)), y: 30 - ((value - min) / spread) * 24, value, label: labels[index] }));
  return <div className="history-chart"><div><b>{title}</b><span>{values.length ? `${values.length} check-ins` : "No check-ins yet"}</span></div>{values.length ? <svg viewBox="0 0 100 36" role="img" aria-label={`${title} trend across saved check-ins`}><polyline points={points.map((item) => `${item.x},${item.y}`).join(" ")} fill="none" stroke={color} strokeWidth="2" />{points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="2" fill={color}><title>{point.label}: {point.value}</title></circle>)}</svg> : <div className="history-chart-empty">Add a voluntary check-in to see your trend.</div>}</div>;
}

export default function HistoryPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh(selectId?: number) {
    const response = await fetch("/api/mindcare/conversations");
    if (!response.ok) { setError("Please log in to view your saved history."); setLoading(false); return; }
    const data = await response.json();
    const rows: Thread[] = data.conversations || [];
    setThreads(rows);
    const active = rows.find((item) => item.id === selectId) || rows[0] || null;
    setSelected(active);
    if (active) {
      const detail = await fetch(`/api/mindcare/conversations/${active.id}`);
      if (detail.ok) setMessages((await detail.json()).messages || []);
    } else setMessages([]);
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
    fetch("/api/mindcare/dashboard").then((response) => response.ok ? response.json() : null).then((data) => { if (data) setDashboard(data); }).catch(() => undefined);
  }, []);

  async function choose(thread: Thread) {
    setSelected(thread);
    const response = await fetch(`/api/mindcare/conversations/${thread.id}`);
    if (response.ok) setMessages((await response.json()).messages || []);
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this conversation and all its messages from your SQLite history?")) return;
    const response = await fetch(`/api/mindcare/conversations/${id}`, { method: "DELETE" });
    if (!response.ok) { setError("Could not delete this conversation."); return; }
    setMessages([]); setSelected(null); await refresh();
  }

  async function removeAll() {
    if (!threads.length || !window.confirm("Delete all saved conversations and messages from your SQLite history?")) return;
    const response = await fetch("/api/mindcare/conversations", { method: "DELETE" });
    if (!response.ok) { setError("Could not clear your conversation history."); return; }
    setMessages([]); setSelected(null); await refresh();
  }

  const mood = dashboard?.datasets.find((item) => item.label === "Mood")?.data || [];
  const stress = dashboard?.datasets.find((item) => item.label === "Stress")?.data || [];
  return <main className="mindcare-data-page">
    <header className="data-page-header"><a href="/chat"><ArrowLeft size={16} /> Chat</a><span>SASTRA MINDCARE AI</span><a href="/dashboard"><ChartNoAxesCombined size={16} /> Progress charts</a></header>
    <section className="data-dashboard history-dashboard">
      <div className="history-title"><div><span className="data-eyebrow">YOUR PRIVATE ACCOUNT</span><h1>Conversation history</h1><p>Reopen your full Pixel and Luna chats, or permanently remove them from your SQLite account history.</p></div><button type="button" onClick={removeAll} disabled={!threads.length}><Trash2 size={15} /> Delete all</button></div>
      {error && <p role="alert" className="history-error">{error}</p>}
      <div className="history-layout">
        <aside className="history-list" aria-label="Saved conversations">
          <h2>Saved chats <span>{threads.length}</span></h2>
          {loading ? <p className="history-empty">Loading history…</p> : threads.length ? threads.map((thread) => <button key={thread.id} type="button" className={`history-thread ${selected?.id === thread.id ? "selected" : ""}`} onClick={() => void choose(thread)}><span className={`history-avatar ${thread.active_companion}`}>{thread.active_companion === "pixel" ? "P" : "L"}</span><span className="history-thread-copy"><b>{thread.title || "Conversation"}</b><small>{thread.message_count} messages · {new Date(thread.updated_at).toLocaleDateString()}</small><small>{thread.preview || "No messages yet"}</small></span><span className="history-thread-delete" onClick={(event) => { event.stopPropagation(); void remove(thread.id); }} aria-label="Delete conversation"><Trash2 size={15} /></span></button>) : <p className="history-empty">Your saved conversations will appear here.</p>}
        </aside>
        <section className="history-detail" aria-label="Selected conversation">
          {selected ? <><div className="history-detail-header"><div><span className="data-eyebrow">FULL TRANSCRIPT</span><h2>{selected.title}</h2><small>{new Date(selected.created_at).toLocaleString()}</small></div><div><a href={`/chat?conversation=${selected.id}`}><ExternalLink size={14} /> Open in chat</a><button type="button" onClick={() => void remove(selected.id)}><Trash2 size={14} /> Delete</button></div></div><div className="history-transcript">{messages.map((message) => <article key={message.id} className={`history-message ${message.role}`}><span>{message.role === "student" ? "You" : message.companion === "luna" ? "Luna" : "Pixel"}</span><p>{message.text}</p>{message.recommendation && <div className="history-recommendation"><b>{message.recommendation.title}{message.recommendation.minutes ? ` - ${message.recommendation.minutes} min` : ""}</b><span>{message.recommendation.reason}</span></div>}<small>{new Date(message.created_at).toLocaleString()}</small></article>)}</div></> : <div className="history-empty history-no-selection"><MessageCircle size={24} /><b>Select a saved chat</b><span>Its complete transcript will appear here.</span></div>}
        </section>
      </div>
      <section className="history-trends"><div className="history-trends-title"><span className="data-eyebrow">YOUR CHECK-INS</span><h2>Well-being trends</h2><p>These charts show only your saved voluntary check-ins.</p><a href="/dashboard">More progress details <ChartNoAxesCombined size={14} /></a></div><div className="history-chart-grid"><TrendLine title="Mood" values={dashboard?.consented ? mood : []} labels={dashboard?.labels || []} color="#2929ed" /><TrendLine title="Stress" values={dashboard?.consented ? stress : []} labels={dashboard?.labels || []} color="#e36a78" /></div></section>
    </section>
  </main>;
}
