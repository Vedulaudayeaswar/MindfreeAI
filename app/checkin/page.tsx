"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";

const preferences = [
  ["guided_breathing", "Guided breathing"], ["forest_serenity", "Forest Serenity"], ["rainfall_relaxation", "Rainfall Relaxation"], ["ocean_breathing", "Ocean Breathing"], ["mountain_breeze", "Mountain Breeze"], ["mindfulness_meditation", "Mindfulness meditation"], ["study_break", "Study break"], ["time_management", "Time management"], ["sleep_routine", "Sleep routine"], ["campus_support", "Campus support information"],
];

export default function CheckinPage() {
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ observations_available: number; cnn_status: string; cnn?: { trend: string; confidence: number }; recommendation?: { id: string; title: string; minutes: number; exercise: string | null; sound: string | null; recommendation_id: number; reason: string } | null } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(["mood", "stress", "sleep_hours", "academic_workload", "study_hours", "physical_activity", "study_breaks"].map((key) => [key, Number(form.get(key))]));
    try {
      const response = await fetch("/api/mindcare/checkins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, checkin_date: form.get("checkin_date"), consent, preferences: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Could not save this check-in.");
      setResult(data); setMessage("Your check-in was saved. Thank you for sharing only what you chose to.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  }

  return <main className="mindcare-data-page"><header className="data-page-header"><a href="/chat"><ArrowLeft size={17} /> Back to chat</a><a href="/" className="chat-wordmark">SASTRA <span>MINDCARE AI</span></a><a href="/dashboard">My progress</a></header><section className="data-card"><span className="data-eyebrow">VOLUNTARY · PRIVATE · NON-CLINICAL</span><h1>Daily well-being check-in</h1><p>Share the indicators you want to reflect on today. These are self-reports, not a test or diagnosis. Your entries are saved to your account only after you opt in.</p>
    <form onSubmit={submit} className="checkin-form"><label>Check-in date<input type="date" name="checkin_date" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <div className="checkin-fields">
        <label>Mood <small>1 = low · 5 = positive</small><input type="number" name="mood" min="1" max="5" step="1" defaultValue="3" required /></label>
        <label>Perceived stress <small>1 = low · 10 = high</small><input type="number" name="stress" min="1" max="10" step="1" defaultValue="5" required /></label>
        <label>Sleep duration <small>Hours last night</small><input type="number" name="sleep_hours" min="0" max="24" step="0.25" defaultValue="7" required /></label>
        <label>Academic workload <small>1 = light · 10 = heavy</small><input type="number" name="academic_workload" min="1" max="10" step="1" defaultValue="5" required /></label>
        <label>Study duration <small>Hours today</small><input type="number" name="study_hours" min="0" max="24" step="0.25" defaultValue="4" required /></label>
        <label>Physical activity <small>Minutes today</small><input type="number" name="physical_activity" min="0" max="600" step="5" defaultValue="30" required /></label>
        <label>Study breaks <small>Number of breaks today</small><input type="number" name="study_breaks" min="0" max="20" step="1" defaultValue="2" required /></label>
      </div>
      <fieldset className="preferences-fieldset"><legend>Activities you may prefer <small>Optional</small></legend><div className="preference-chips">{preferences.map(([id, label]) => <label key={id} className={selected.includes(id) ? "selected" : ""}><input type="checkbox" checked={selected.includes(id)} onChange={() => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} />{label}</label>)}</div></fieldset>
      <label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required /><span><b>Save this voluntary check-in and use it for my personal trends and optional activity suggestions.</b><small>You can revoke consent and delete saved check-ins from the Progress page. Chat messages are not saved as permanent records.</small></span></label>
      <button className="data-primary-button" disabled={!consent || busy}>{busy ? "Saving…" : "Save my check-in"}</button>
    </form>
    {message && <p className="data-status" role="status">{message}</p>}
    {result && <div className="checkin-result"><CheckCircle2 size={19} /><div><b>Check-in recorded · {result.observations_available} available</b>{result.cnn ? <p>CNN temporal pattern: {result.cnn.trend} · model confidence {(result.cnn.confidence * 100).toFixed(1)}%. This reflects self-reports and is not clinical certainty.</p> : <p>{result.cnn_status === "insufficient_history" ? "CNN trend appears after at least 7 chronological check-ins." : "CNN result is currently unavailable."}</p>}{result.recommendation && <div className="checkin-recommendation"><p>Optional activity: <b>{result.recommendation.title}</b>{result.recommendation.minutes ? ` · ${result.recommendation.minutes} min` : ""}</p><a href={result.recommendation.id === "campus_support" ? "https://sastra.edu/swas/" : `/zenmode?${new URLSearchParams({ ...(result.recommendation.exercise ? { exercise: result.recommendation.exercise } : {}), ...(result.recommendation.sound ? { sound: result.recommendation.sound } : {}), recommendation: String(result.recommendation.recommendation_id), activity_id: result.recommendation.id })}`}>{result.recommendation.id === "campus_support" ? "View campus support" : "Try it in ZenMode"}</a></div>}</div></div>}
    <div className="data-privacy-note"><ShieldCheck size={18} /><span>Only the current signed-in account can access these records. Model output is non-clinical; suggestions can be declined without penalty.</span></div>
  </section></main>;
}
