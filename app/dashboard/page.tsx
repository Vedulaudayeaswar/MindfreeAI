"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Download, ShieldCheck, Trash2, Eye } from "lucide-react";

type Dataset = { label: string; data: number[] };
type ReportRecord = { id: string; period: string; start_date: string; end_date: string; created_at: string };
type DashboardData = { consented: boolean; labels: string[]; datasets: Dataset[]; predictions: { trend: string; confidence: number; checkin_date: string }[]; recommendations: { id: number; activity: string; duration_minutes: number; created_at: string }[]; feedback: { activity: string; outcome: string; created_at: string }[]; message?: string };

async function readApiResult(response: Response) {
  const body = await response.text();
  try { return body ? JSON.parse(body) : {}; }
  catch { return { detail: body || `Request failed (${response.status}).` }; }
}

function LineChart({ labels, dataset, color }: { labels: string[]; dataset?: Dataset; color: string }) {
  if (!dataset || dataset.data.length === 0) return <div className="empty-chart">No check-ins recorded yet.</div>;
  const values = dataset.data; const min = Math.min(...values); const max = Math.max(...values); const span = max - min || 1;
  const points = values.map((value, index) => `${values.length === 1 ? 50 : 8 + index * 84 / (values.length - 1)},${82 - ((value - min) / span) * 64}`).join(" ");
  return <div className="mindcare-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${dataset.label} actual self-reported trend`}><line x1="6" y1="82" x2="94" y2="82" /><polyline points={points} style={{ stroke: color }} />{values.map((value, index) => <circle key={index} cx={values.length === 1 ? 50 : 8 + index * 84 / (values.length - 1)} cy={82 - ((value - min) / span) * 64} r="1.7" style={{ fill: color }} />)}</svg><div className="chart-labels">{labels.map((label, index) => index === 0 || index === labels.length - 1 || index % Math.ceil(labels.length / 4) === 0 ? <span key={`${label}-${index}`}>{label.slice(5)}</span> : null)}</div><small>Scale values: {Math.min(...values)}–{Math.max(...values)} · n={values.length} actual check-ins</small></div>;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportStatus, setReportStatus] = useState("");
  const [reportPeriod, setReportPeriod] = useState("weekly");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  async function load() { try { const response = await fetch("/api/mindcare/dashboard"); const result = await response.json(); if (!response.ok) throw new Error(result.detail); setData(result); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load progress."); } }
  async function loadReportHistory() {
    const response = await fetch("/api/reports/history");
    if (response.ok) setReports((await response.json()).reports || []);
  }
  useEffect(() => { void load(); void loadReportHistory(); }, []);
  async function generateReport(period: "weekly" | "monthly" | "custom") {
    if (period === "custom" && (!startDate || !endDate)) { setReportStatus("Choose both dates for a custom report."); return; }
    setReportBusy(true); setReportStatus("Generating a private report from your saved records?");
    try {
      const response = await fetch("/api/reports/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, ...(period === "custom" ? { start_date: startDate, end_date: endDate } : {}) }) });
      const result = await readApiResult(response);
      if (!response.ok) throw new Error(result.detail || "Report generation failed.");
      setReportStatus(`Report ready (${result.insight_source === "ollama" ? "Ollama insights included" : "local Ollama unavailable; clearly labeled general suggestions included"}).`);
      setPreviewId(result.report_id); await loadReportHistory();
    } catch (error) { setReportStatus(error instanceof Error ? error.message : "Report generation failed."); }
    finally { setReportBusy(false); }
  }
  async function revoke() { if (!window.confirm("Revoke consent and permanently delete your saved check-ins, model observations, activity suggestions, feedback, completed ZenMode sessions, and generated PDF reports?")) return; setBusy(true); try { await fetch("/api/mindcare/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: false }) }); await load(); await loadReportHistory(); } finally { setBusy(false); } }
  const series = data?.datasets ?? [];
  return <main className="mindcare-data-page"><header className="data-page-header"><a href="/chat"><ArrowLeft size={17} /> Back to chat</a><a href="/" className="chat-wordmark">SASTRA <span>MINDCARE AI</span></a><a href="/checkin">Daily check-in</a></header><section className="data-dashboard"><span className="data-eyebrow">YOUR REFLECTIONS · YOUR CHOICE</span><h1>My progress</h1><p>Charts use only your saved self-reports. Empty charts mean there is no historical data yet.</p>{error && <p className="data-status">{error}</p>}
    {!data ? <p>Loading your records…</p> : !data.consented ? <div className="dashboard-empty"><ShieldCheck size={28} /><h2>No saved check-ins</h2><p>Choose the daily check-in page and opt in if you would like to save and view your own data.</p><a href="/checkin" className="data-primary-button">Start a voluntary check-in</a></div> : <>
      <div className="dashboard-actions"><button type="button" onClick={() => void generateReport("weekly")} disabled={reportBusy}><Download size={16} />Generate weekly report</button><button type="button" onClick={() => void generateReport("monthly")} disabled={reportBusy}><Download size={16} />Generate monthly report</button><button type="button" onClick={revoke} disabled={busy}><Trash2 size={16} />Revoke consent &amp; delete records</button></div>
      <section className="dashboard-record-list report-builder"><h2>Custom date range</h2><div className="report-range-controls"><label>From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><button type="button" onClick={() => void generateReport("custom")} disabled={reportBusy}><Download size={15} />Generate custom PDF</button></div>{reportStatus && <p role="status">{reportStatus}</p>}</section>
      <section className="dashboard-record-list report-builder"><h2>Generated reports</h2>{reports.length ? reports.map((item) => <p key={item.id}><b>{item.period === "custom" ? "Custom" : item.period} report</b> ? {item.start_date} to {item.end_date} ? {new Date(item.created_at).toLocaleString()} <a href={`/api/reports/${item.id}/download`}><Download size={13} />Download PDF</a> <button type="button" onClick={() => setPreviewId(previewId === item.id ? null : item.id)}><Eye size={13} />{previewId === item.id ? "Hide preview" : "Preview"}</button></p>) : <p>No reports generated yet.</p>}{previewId && <iframe className="report-preview" title="Generated well-being report preview" src={`/api/reports/${previewId}/download?inline=true`} />}</section>
      <div className="dashboard-chart-grid"><article><h2>Mood · self-reported</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Mood")} color="#1717ff" /></article><article><h2>Stress · self-reported</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Stress")} color="#ef6c8b" /></article><article><h2>Sleep duration · hours</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Sleep Hours")} color="#5095d5" /></article><article><h2>Study duration · hours</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Study Hours")} color="#58a66e" /></article><article><h2>Academic workload</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Academic Workload")} color="#bd72dd" /></article><article><h2>Physical activity · minutes</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Physical Activity")} color="#d18e36" /></article><article><h2>Study breaks · count</h2><LineChart labels={data.labels} dataset={series.find((item) => item.label === "Study Breaks")} color="#39a4a0" /></article></div>
      <section className="dashboard-record-list"><h2>CNN temporal observations</h2>{data.predictions.length ? data.predictions.map((item, index) => <p key={index}><b>{item.checkin_date}</b> · {item.trend} · {(item.confidence * 100).toFixed(1)}% model confidence <small>(not clinical certainty)</small></p>) : <p>At least 7 dated check-ins are needed for the CNN. Available observations: {data.labels.length}.</p>}</section>
      <section className="dashboard-record-list"><h2>Activity recommendations</h2>{data.recommendations.length ? data.recommendations.map((item) => <p key={item.id}><b>{item.activity.replaceAll("_", " ")}</b> · {item.duration_minutes ? `${item.duration_minutes} min` : "support information"} · {item.created_at}</p>) : <p>No activity recommendations recorded.</p>}</section>
      <section className="dashboard-record-list"><h2>Activity feedback</h2>{data.feedback.length ? data.feedback.map((item, index) => <p key={index}><b>{item.activity.replaceAll("_", " ")}</b> · {item.outcome} · {item.created_at}</p>) : <p>No feedback recorded.</p>}</section>
    </>}
    <div className="data-privacy-note"><ShieldCheck size={18} /><span>Model observations describe patterns in your reported indicators only. They are not diagnosis or evidence of recovery. For qualified support, contact SASTRA SWAS.</span></div>
  </section></main>;
}
