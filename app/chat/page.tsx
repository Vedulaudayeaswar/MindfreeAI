"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, Heart, LogOut, MessageCircle, Sparkles, ShieldCheck, Smile, Sun, Mic, Volume2, VolumeX, ClipboardCheck, History, Plus, Download } from "lucide-react";
import RobotScene, { type Companion } from "./RobotScene";

type ActivityRecommendation = { id: string; title: string; minutes: number; exercise: string | null; sound: string | null; reason: string; recommendation_id: number };
type Message = { id: number; role: "assistant" | "student"; text: string; companion?: Companion; recommendation?: ActivityRecommendation; safety?: boolean };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; start: () => void };
type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

const prompts = [
  { icon: <Heart size={16} />, text: "I feel stressed about exams" },
  { icon: <Sparkles size={16} />, text: "Help me plan my workload" },
  { icon: <Sun size={16} />, text: "Guide me through a breathing break" },
];

function zenHref(recommendation: ActivityRecommendation) {
  if (recommendation.id === "campus_support") return "https://sastra.edu/swas/";
  const query = new URLSearchParams();
  if (recommendation.exercise) query.set("exercise", recommendation.exercise);
  if (recommendation.sound) query.set("sound", recommendation.sound);
  query.set("recommendation", String(recommendation.recommendation_id));
  query.set("activity_id", recommendation.id);
  return `/zenmode?${query.toString()}`;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isChatCompletionRequest(text: string) {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
  return /^(?:complete(?:d)?(?: chat| (?:this|the) (?:chat|conversation)| it)?|finish(?:ed)?(?: chat| (?:this|the) (?:chat|conversation)| it)?|end (?:(?:this|the) )?(?:chat|conversation)|wrap up(?: this)?(?: chat| conversation)?|i(?: am|'m) done|done for now|all done)$/.test(normalized);
}

async function readApiResult(response: Response) {
  const body = await response.text();
  try { return body ? JSON.parse(body) : {}; }
  catch { return { detail: body || `Request failed (${response.status}).` }; }
}

export default function ChatPage() {
  const [companion, setCompanion] = useState<Companion>("pixel");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [studentName, setStudentName] = useState("Student");
  const [conversationStartDate, setConversationStartDate] = useState(localDateString());
  const [showFinalReport, setShowFinalReport] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const nextId = useRef(1);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, thinking]);
  useEffect(() => { if (showFinalReport) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [showFinalReport]);
  useEffect(() => () => { audioRef.current?.pause(); if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); window.speechSynthesis?.cancel(); }, []);
  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Unable to verify your sign-in.")))
      .then(({ user }) => {
        if (!mounted) return;
        if (!user) {
          window.location.replace("/login?next=%2Fchat");
          return;
        }
        setStudentName([user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Student");
        setSessionReady(true);
      })
      .catch(() => {
        if (mounted) window.location.replace("/login?next=%2Fchat");
      });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (!sessionReady) return;
    let mounted = true;
    async function openThread() {
      try {
        const params = new URLSearchParams(window.location.search);
        const requested = Number(params.get("conversation"));
        const listResponse = await fetch("/api/mindcare/conversations");
        if (listResponse.status === 401) { window.location.replace("/login?next=%2Fchat"); return; }
        if (!listResponse.ok) return;
        const { conversations = [] } = await listResponse.json();
        let selected = conversations.find((item: { id: number }) => item.id === requested) || conversations[0];
        if (!selected) {
          const created = await fetch("/api/mindcare/conversations", { method: "POST" });
          if (created.status === 401) { window.location.replace("/login?next=%2Fchat"); return; }
          if (!created.ok) return;
          selected = await created.json();
        }
        const detailResponse = await fetch(`/api/mindcare/conversations/${selected.id}`);
        if (!detailResponse.ok) return;
        const detail = await detailResponse.json();
        if (!mounted) return;
        setConversationId(selected.id);
        setConversationStartDate((detail.conversation.created_at || localDateString()).slice(0, 10));
        setMessages(detail.messages.map((item: { id: number; role: string; text: string; companion?: Companion; recommendation?: ActivityRecommendation }, index: number) => ({ id: item.id || index + 1, role: item.role === "student" ? "student" : "assistant", text: item.text, companion: item.companion, recommendation: item.recommendation })));
        if (detail.conversation.active_companion === "luna" || detail.conversation.active_companion === "pixel") setCompanion(detail.conversation.active_companion);
        nextId.current = Math.max(1, ...detail.messages.map((item: { id: number }) => item.id + 1));
        window.history.replaceState(null, "", `/chat?conversation=${selected.id}`);
      } catch { /* The page remains usable once the backend is available. */ }
    }
    void openThread();
    return () => { mounted = false; };
  }, [sessionReady]);

  async function startNewConversation() {
    const result = await fetch("/api/mindcare/conversations", { method: "POST" });
    if (result.status === 401) { window.location.assign("/login?next=%2Fchat"); return; }
    if (!result.ok) return;
    const created = await result.json();
    setConversationId(created.id); setMessages([]); nextId.current = 1; setConversationStartDate(localDateString()); setShowFinalReport(false); setReportStatus(""); setReportId(null);
    window.history.replaceState(null, "", `/chat?conversation=${created.id}`);
  }


  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }

  function finishConversation() {
    if (reportBusy) return;
    setDraft("");
    setShowFinalReport(true);
    setReportId(null);
    setReportStatus("");
    void generateFinalReport();
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>, text = draft) {
    event?.preventDefault();
    const content = text.trim();
    if (!content || thinking) return;
    const asksToFinish = isChatCompletionRequest(content);
    if (asksToFinish) { finishConversation(); return; }
    let activeConversationId = conversationId;
    if (!activeConversationId) {
      const createdResponse = await fetch("/api/mindcare/conversations", { method: "POST" });
      if (createdResponse.status === 401) { window.location.assign("/login?next=%2Fchat"); return; }
      if (!createdResponse.ok) {
        setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: "I couldn’t open a conversation. Please check that the MindCare backend is running, then try again." }]);
        return;
      }
      activeConversationId = (await createdResponse.json()).id;
      setConversationId(activeConversationId);
      window.history.replaceState(null, "", `/chat?conversation=${activeConversationId}`);
    }
    setMessages((current) => [...current, { id: nextId.current++, role: "student", text: content }]);
    setDraft("");
    setThinking(true);
    try {
      const result = await fetch("/api/mindcare/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companion, message: content, conversation_id: activeConversationId }) });
      const data = await result.json();
      if (result.status === 401) { window.location.assign("/login?next=%2Fchat"); return; }
      if (!result.ok) throw new Error(data.detail || "The assistant could not respond right now.");
      setConversationId(data.conversation_id);
      if (data.conversation_id) window.history.replaceState(null, "", `/chat?conversation=${data.conversation_id}`);
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: data.reply, companion, recommendation: data.recommendation ?? undefined, safety: Boolean(data.safety) }]);
      if (voiceEnabled) {
        setSpeaking(true);
        try {
          const voiceResponse = await fetch(`/api/mindcare/tts/${companion}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: data.reply }) });
          if (!voiceResponse.ok) throw new Error("Local voice unavailable");
          const blob = await voiceResponse.blob();
          if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audioRef.current = audio;
          audio.onended = () => setSpeaking(false);
          audio.onerror = () => setSpeaking(false);
          await audio.play();
        } catch {
          if ("speechSynthesis" in window) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(data.reply);
            utterance.pitch = companion === "pixel" ? 1.08 : 0.92;
            utterance.onend = () => setSpeaking(false);
            utterance.onerror = () => setSpeaking(false);
            window.speechSynthesis.speak(utterance);
          } else setSpeaking(false);
        }
      } else {
        setSpeaking(true);
        window.setTimeout(() => setSpeaking(false), 2600);
      }
    } catch (error) {
      setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: error instanceof Error ? error.message : "The assistant is temporarily unavailable. Please try again." }]);
    } finally { setThinking(false); }
  }

  async function generateFinalReport() {
    if (reportBusy) return;
    setReportBusy(true); setReportStatus("Generating your report from saved, consented records…");
    try {
      const today = localDateString();
      const earliestAllowed = new Date(); earliestAllowed.setDate(earliestAllowed.getDate() - 365);
      const start = conversationStartDate < localDateString(earliestAllowed) ? localDateString(earliestAllowed) : conversationStartDate;
      const response = await fetch("/api/reports/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: "custom", start_date: start <= today ? start : today, end_date: today }) });
      const result = await readApiResult(response);
      if (!response.ok) throw new Error(result.detail || result.error || "Report generation failed.");
      setReportId(result.report_id);
      setReportStatus("Your report is ready to download.");
    } catch (error) { setReportStatus(error instanceof Error ? error.message : "Report generation failed."); }
    finally { setReportBusy(false); }
  }

  function startListening() {
    const speechWindow = window as SpeechWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) { setMessages((current) => [...current, { id: nextId.current++, role: "assistant", text: "Voice input is not available in this browser. You can type your message instead." }]); return; }
    const recognition = new Recognition();
    recognition.lang = "en-IN"; recognition.interimResults = false;
    recognition.onresult = (event) => { const transcript = event.results[0]?.[0]?.transcript; if (transcript) { setDraft(transcript); setListening(false); } };
    recognition.onerror = () => setListening(false); recognition.onend = () => setListening(false);
    setListening(true); recognition.start();
  }

  async function recordDecline(recommendation: ActivityRecommendation) {
    await fetch("/api/mindcare/activity-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommendation_id: recommendation.recommendation_id, activity: recommendation.id, outcome: "declined" }) }).catch(() => undefined);
  }

  const name = companion === "pixel" ? "Pixel" : "Luna";
  if (!sessionReady) return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", color: "#17144f", fontFamily: "inherit" }}>Checking your sign-in…</main>;
  return (
    <main className={`mindcare-chat ${companion}`}>
      <aside className="companion-panel">
        <div className="companion-topbar">
          <a className="chat-back" href="/" aria-label="Back to home"><ArrowLeft size={18} /></a>
          <a className="chat-wordmark" href="/">SASTRA <span>MINDCARE AI</span></a>
          <span className="companion-online"><i /> HERE WITH YOU</span>
        </div>
        <div className="robot-stage">
          <div className="robot-orbit orbit-one" /><div className="robot-orbit orbit-two" />
          <RobotScene companion={companion} speaking={speaking} />
          <div className={`robot-speech-tag ${speaking ? "speaking" : ""}`}><span /><span /><span /></div>
        </div>
        <div className="companion-caption">
          <span className="chat-eyebrow">YOUR WELL-BEING COMPANION</span>
          <h1>Hi, I’m <b>{name}.</b></h1>
          <p>{companion === "pixel" ? "A friendly study buddy for calmer, more balanced days." : "A gentle study companion for thoughtful, balanced days."}</p>
        </div>
        <div className="companion-switch" role="group" aria-label="Choose AI companion">
          <button type="button" className={companion === "pixel" ? "selected" : ""} onClick={() => setCompanion("pixel")}><span className="model-dot pixel-dot" />Pixel <small>he / him</small></button>
          <button type="button" className={companion === "luna" ? "selected" : ""} onClick={() => setCompanion("luna")}><span className="model-dot luna-dot" />Luna <small>she / her</small></button>
        </div>
        <div className="companion-footnote"><ShieldCheck size={15} /> A supportive space, not clinical care</div>
      </aside>

      <section className="chat-panel" aria-label={`${name} chat`}>
        <header className="chat-header">
          <div className="chat-header-title"><div className="chat-avatar"><MessageCircle size={19} /></div><div><b>MindCare conversation</b><span>{thinking ? `${name} is thinking…` : "A calm space to check in"}</span></div></div>
          <div className="chat-header-actions"><button type="button" className="chat-zenmode" onClick={startNewConversation} title="Start a new conversation"><Plus size={15} /><span>New</span></button><a href="/history" className="chat-zenmode"><History size={15} /><span>History</span></a><a href="/checkin" className="chat-zenmode"><ClipboardCheck size={15} /><span>Check-in</span></a><a href="/zenmode" className="chat-zenmode"><Sparkles size={15} /><span>ZenMode</span></a><button type="button" onClick={finishConversation} className="chat-complete" aria-label="Complete chat and generate report" disabled={reportBusy} title="Finish this conversation and generate your report"><ClipboardCheck size={15} /><span>Complete chat</span></button><button type="button" onClick={logout} className="chat-logout"><LogOut size={16} /><span>Log out</span></button></div>
        </header>

        <div className="chat-scroll-area">
          <div className="chat-date-chip">A MOMENT FOR YOU</div>
          <div className="chat-welcome"><div className="welcome-sparkle"><Smile size={22} /></div><h2>What’s on your mind?</h2><p>Share as much or as little as you like. We can take it one step at a time.</p></div>
          {messages.length === 0 && <div className="quick-prompts">{prompts.map((prompt) => <button type="button" key={prompt.text} onClick={() => sendMessage(undefined, prompt.text)}>{prompt.icon}<span>{prompt.text}</span><ArrowUp size={14} /></button>)}</div>}
          <div className="chat-messages" aria-live="polite">{messages.map((message) => <article className={`chat-message ${message.role}`} key={message.id}>
            {message.role === "assistant" && <div className="message-avatar">{message.companion === "luna" ? "L" : "P"}</div>}
            <div className="message-body"><span className="message-sender">{message.role === "assistant" ? (message.companion === "luna" ? "Luna" : "Pixel") : "You"}</span><p>{message.text}</p>{message.recommendation && <div className="chat-recommendation"><span>OPTIONAL ACTIVITY{message.recommendation.minutes ? ` · ${message.recommendation.minutes} MIN` : ""}</span><b>{message.recommendation.title}</b><small>{message.recommendation.reason}</small><div><a href={zenHref(message.recommendation)} target={message.recommendation.id === "campus_support" ? "_blank" : undefined} rel={message.recommendation.id === "campus_support" ? "noreferrer" : undefined}>{message.recommendation.id === "campus_support" ? "View campus support" : "Try this in ZenMode"}</a><button type="button" onClick={() => recordDecline(message.recommendation!)}>Not now</button></div></div>}</div>
          </article>)}
          {thinking && <div className="chat-message assistant"><div className="message-avatar">{companion === "pixel" ? "P" : "L"}</div><div className="message-body"><span className="message-sender">{name}</span><div className="typing-dots"><i /><i /><i /></div></div></div>}
          {showFinalReport && <section className="chat-final-report" aria-live="polite"><div><b>Conversation complete</b><p>Your report uses your saved check-ins and explicitly shared indicators. Chat messages themselves are not copied into the PDF.</p>{reportStatus && <small role="status">{reportStatus}</small>}</div>{reportId ? <a href={`/api/reports/${reportId}/download`}><Download size={16} />Download {studentName}&apos;s report</a> : <button type="button" onClick={() => void generateFinalReport()} disabled={reportBusy}><Download size={16} />{reportBusy ? "Generating report…" : "Generate my report"}</button>}</section>}
          <div ref={endRef} /></div>
        </div>

        <div className="chat-composer-wrap">
          <form className="chat-composer" onSubmit={(event) => sendMessage(event)}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={`Message ${name}…`} aria-label={`Message ${name}`} maxLength={1200} />
            <button type="button" className="chat-voice-button" aria-label={voiceEnabled ? "Turn voice replies off" : "Turn voice replies on"} title={voiceEnabled ? `Local ${name} voice replies on` : "Local voice replies off"} onClick={() => { setVoiceEnabled(!voiceEnabled); if (voiceEnabled) { audioRef.current?.pause(); window.speechSynthesis?.cancel(); setSpeaking(false); } }}>{voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
            <button type="button" className={`chat-voice-button ${listening ? "listening" : ""}`} aria-label={listening ? "Listening" : "Use voice input"} title="Use voice input" onClick={startListening}><Mic size={18} /></button>
            <button type="submit" aria-label="Send message" disabled={!draft.trim() || thinking}><ArrowUp size={20} /></button>
          </form>
          <div className="chat-composer-meta"><span>{listening ? "Listening…" : "This conversation is saved to your account. You can delete it from History."}</span><span>{draft.length}/1200</span></div>
          <p className="chat-safety-note">General well-being support, not clinical care. For SASTRA SWAS call 04362-350023 or email deanswas@sastra.edu. If you are in immediate danger in India, call 112.</p>
        </div>
      </section>
    </main>
  );
}
