from __future__ import annotations

import json
from xml.sax.saxutils import escape as xml_escape
import math
import os
import urllib.request
import uuid
from collections import Counter
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = Path(os.getenv("MINDCARE_REPORT_DIR", ROOT / "data" / "reports")).resolve()
NAVY = colors.HexColor("#172554")
BLUE = colors.HexColor("#2563EB")
GREEN = "#15803D"
PALE = colors.HexColor("#EFF6FF")
MUTED = colors.HexColor("#64748B")
CLASSES = ("stable", "increasing_stress", "declining_mood", "improving_wellbeing")
CLASS_LABELS = ("Stable", "Increasing stress", "Declining mood", "Improving self-reported well-being")
ACTIVITY_CATEGORIES = {"forest_serenity":"Relaxation","rainfall_relaxation":"Relaxation","ocean_breathing":"Breathing","mountain_breeze":"Visualization","guided_breathing":"Breathing","mindfulness":"Mindfulness","study_break":"Study skills","time_management":"Study skills","sleep_routine":"Self-care","campus_support":"Human support"}
ACTIVITY_NAMES = {
    "forest_serenity": "Forest Serenity", "rainfall_relaxation": "Rainfall Relaxation",
    "ocean_breathing": "Ocean Breathing", "mountain_breeze": "Mountain Breeze",
    "guided_breathing": "Guided breathing", "mindfulness": "Mindfulness meditation",
    "study_break": "Study break", "time_management": "Time-management activity",
    "sleep_routine": "Sleep routine suggestion", "campus_support": "Campus support information",
}
SOUND_NAMES = {"forest": "Forest Serenity", "rain": "Rainfall Relaxation", "ocean": "Ocean Waves", "nature": "Nature sounds"}


def fetch_student_records(user_id: int, start: date, end: date, connect, has_consent) -> dict[str, Any]:
    """Fetch only the authenticated student's consented records for the requested interval."""
    with connect() as db:
        user = db.execute("SELECT id,first_name,last_name FROM users WHERE id=?", (user_id,)).fetchone()
        if not user:
            raise ValueError("Student account not found.")
        consented = has_consent(db, user_id)
        if not consented:
            raise PermissionError("Opt in to check-ins before generating a well-being report.")
        start_s, end_s = start.isoformat(), end.isoformat()
        checkins = [dict(x) for x in db.execute("SELECT * FROM wellbeing_checkins WHERE user_id=? AND checkin_date BETWEEN ? AND ? ORDER BY checkin_date", (user_id,start_s,end_s))]
        predictions = [dict(x) for x in db.execute("""SELECT p.trend,p.confidence,p.probabilities_json,p.model_version,p.created_at,c.checkin_date
            FROM cnn_predictions p JOIN wellbeing_checkins c ON c.id=p.checkin_id
            WHERE p.user_id=? AND c.checkin_date BETWEEN ? AND ? ORDER BY c.checkin_date,p.id""", (user_id,start_s,end_s))]
        for item in predictions:
            item["probabilities"] = json.loads(item.pop("probabilities_json"))
        recs = [dict(x) for x in db.execute("""SELECT r.id,r.activity,r.duration_minutes,r.reason,r.source,r.created_at,
            f.outcome,f.note,f.created_at AS feedback_at,
            (SELECT MAX(z.completed_at) FROM zen_sessions z WHERE z.recommendation_id=r.id AND z.user_id=r.user_id) AS session_completed_at
            FROM drl_recommendations r LEFT JOIN activity_feedback f ON f.id=(SELECT f2.id FROM activity_feedback f2 WHERE f2.recommendation_id=r.id ORDER BY f2.created_at DESC,f2.id DESC LIMIT 1)
            WHERE r.user_id=? AND date(r.created_at) BETWEEN ? AND ? ORDER BY r.created_at,r.id""", (user_id,start_s,end_s))]
        feedback = [dict(x) for x in db.execute("SELECT activity,outcome,note,created_at FROM activity_feedback WHERE user_id=? AND date(created_at) BETWEEN ? AND ? ORDER BY created_at", (user_id,start_s,end_s))]
        sessions = [dict(x) for x in db.execute("SELECT activity_id,activity_name,category,duration_minutes,sound_id,recommendation_id,completed_at FROM zen_sessions WHERE user_id=? AND date(completed_at) BETWEEN ? AND ? ORDER BY completed_at", (user_id,start_s,end_s))]
        previous_messages = db.execute("""SELECT m.companion,COUNT(*) AS n FROM conversation_messages m
            WHERE m.user_id=? AND m.role='assistant' AND date(m.created_at) BETWEEN ? AND ? GROUP BY m.companion""", (user_id,start_s,end_s)).fetchall()
        reported_indicators = [dict(x) for x in db.execute("""SELECT observation_date,metric,value FROM reported_indicators r
            WHERE r.user_id=? AND r.observation_date BETWEEN ? AND ? AND r.id=(
              SELECT MAX(r2.id) FROM reported_indicators r2 WHERE r2.user_id=r.user_id
              AND r2.observation_date=r.observation_date AND r2.metric=r.metric
            ) ORDER BY observation_date,metric""", (user_id,start_s,end_s))]
        preferences: Counter[str] = Counter()
        for row in checkins:
            preferences.update(json.loads(row.get("preferences_json") or "[]"))
        # The previous equivalent range is fetched only to make a clearly labelled comparison.
        span = (end - start).days + 1
        previous_start, previous_end = start - timedelta(days=span), start - timedelta(days=1)
        prev = [dict(x) for x in db.execute("SELECT checkin_date,mood,stress,sleep_hours,study_hours FROM wellbeing_checkins WHERE user_id=? AND checkin_date BETWEEN ? AND ? ORDER BY checkin_date", (user_id,previous_start.isoformat(),previous_end.isoformat()))]
        prev_sessions=[dict(x) for x in db.execute("SELECT duration_minutes FROM zen_sessions WHERE user_id=? AND date(completed_at) BETWEEN ? AND ?",(user_id,previous_start.isoformat(),previous_end.isoformat()))]
        prev_feedback=[dict(x) for x in db.execute("SELECT outcome FROM activity_feedback WHERE user_id=? AND date(created_at) BETWEEN ? AND ?",(user_id,previous_start.isoformat(),previous_end.isoformat()))]
    # Pseudonymous identifier: no name, email, or raw chat transcript appears in the report.
    with connect() as db:
        row=db.execute("SELECT student_code FROM report_subject_ids WHERE user_id=?",(user_id,)).fetchone()
        if row: pseudonym=row["student_code"]
        else:
            pseudonym="MC-"+uuid.uuid4().hex[:8].upper()
            db.execute("INSERT INTO report_subject_ids(user_id,student_code) VALUES(?,?)",(user_id,pseudonym))
    return {"student_id": pseudonym, "student_name": f"{user['first_name']} {user['last_name']}".strip(), "user": {"id":user_id}, "checkins": checkins, "reported_indicators": reported_indicators, "predictions": predictions,
            "recommendations": recs, "feedback": feedback, "sessions": sessions,
            "preferences": dict(preferences), "companion_turns": {x["companion"]: x["n"] for x in previous_messages},
            "previous_checkins": prev, "previous_sessions":prev_sessions, "previous_feedback":prev_feedback, "start": start_s, "end": end_s, "period_days": span}


def _mean(rows, key):
    vals = [float(row[key]) for row in rows if row.get(key) is not None]
    return sum(vals) / len(vals) if vals else None


def calculate_wellbeing_metrics(records: dict[str, Any]) -> dict[str, Any]:
    rows = records["checkins"]
    completed = [x for x in records["sessions"]]
    helpful = sum(x["outcome"] == "completed_helpful" for x in records["feedback"])
    activities_completed = sum(x["outcome"].startswith("completed_") for x in records["feedback"])
    names = Counter(x["activity_name"] for x in completed)
    return {"mood": _mean(rows,"mood"), "stress": _mean(rows,"stress"), "sleep_hours": _mean(rows,"sleep_hours"),
            "study_hours": _mean(rows,"study_hours"), "workload": _mean(rows,"academic_workload"),
            "checkins": len(rows), "sessions": len(completed), "session_minutes": sum(x["duration_minutes"] for x in completed),
            "activities_completed": activities_completed, "feedback_count": len(records["feedback"]), "helpful_feedback": helpful,
            "preferred_activity": names.most_common(1)[0][0] if names else None,
            "sleep_range": [min((float(x["sleep_hours"]) for x in rows),default=None),max((float(x["sleep_hours"]) for x in rows),default=None)],
            "mood_range": [min((float(x["mood"]) for x in rows),default=None),max((float(x["mood"]) for x in rows),default=None)],
            "stress_range": [min((float(x["stress"]) for x in rows),default=None),max((float(x["stress"]) for x in rows),default=None)]}


def generate_mood_chart(rows):
    return _line_chart(rows,"mood","Self-reported mood (1-5)","Mood / daily self-report","#2563EB", average=True)


def generate_stress_chart(rows):
    return _line_chart(rows,"stress","Self-reported stress (1-10)","Stress / daily self-report","#E11D48", average=True)


def generate_sleep_chart(rows):
    return _line_chart(rows,"sleep_hours","Reported sleep duration (hours)","Sleep duration","#15803D", average=True)


def generate_study_chart(rows):
    fig,axes=plt.subplots(3,1,figsize=(7.4,4.8),sharex=True)
    ax,ax2,ax3=axes
    if rows:
        x=[date.fromisoformat(r["checkin_date"]) for r in rows]
        ax.plot(x,[r["study_hours"] for r in rows],marker="o",color="#2563EB",label="Study hours")
        ax.plot(x,[r["academic_workload"] for r in rows],marker="s",color="#7C3AED",label="Workload (1-10)")
        ax.set_ylabel("Hours / workload scale");ax.legend(frameon=False,fontsize=7,ncol=2);ax.grid(axis="y",alpha=.18)
        ax2.bar(x,[r["study_breaks"] for r in rows],alpha=.55,color="#16A34A",label="Study breaks")
        ax2.set_ylabel("Break count");ax2.legend(frameon=False,fontsize=7);ax2.grid(axis="y",alpha=.18)
        ax3.plot(x,[r["physical_activity"] for r in rows],marker="D",color="#EA8B18",label="Physical activity")
        ax3.set_ylabel("Activity minutes");ax3.legend(frameon=False,fontsize=7);ax3.grid(axis="y",alpha=.18)
        if len(x)==1: ax.set_xlim(x[0]-timedelta(days=1),x[0]+timedelta(days=1))
    else:
        ax.text(.5,.5,"No check-ins were recorded.",ha="center",va="center",transform=ax.transAxes)
        ax2.axis("off");ax3.axis("off")
    fig.autofmt_xdate();fig.tight_layout();return _png(fig)


def _line_chart(rows,key,ylabel,title,color,average=False):
    fig,ax=plt.subplots(figsize=(7.4,2.5))
    if rows:
        x=[date.fromisoformat(r["checkin_date"]) for r in rows];y=[float(r[key]) for r in rows]
        ax.plot(x,y,marker="o",linewidth=2,color=color,label=title)
        if average: ax.axhline(float(np.mean(y)),linestyle="--",linewidth=1,color="#64748B",label=f"Period average {np.mean(y):.2f}")
        if len(x)==1: ax.set_xlim(x[0]-timedelta(days=1),x[0]+timedelta(days=1))
        ax.set_ylabel(ylabel);ax.legend(frameon=False,fontsize=8)
    else: ax.text(.5,.5,"No recorded observations for this period.",ha="center",va="center",transform=ax.transAxes)
    ax.grid(axis="y",alpha=.18);fig.autofmt_xdate();fig.tight_layout();return _png(fig)


def _recommendation_chart(recommendations):
    by_activity=Counter(ACTIVITY_NAMES.get(x["activity"],x["activity"].replace("_"," ").title()) for x in recommendations)
    completed=Counter(ACTIVITY_NAMES.get(x["activity"],x["activity"].replace("_"," ").title()) for x in recommendations if x.get("outcome") in {"completed_helpful","completed_neutral","completed_unhelpful"} or x.get("session_completed_at") is not None)
    fig,ax=plt.subplots(figsize=(7.1,2.7))
    if by_activity:
        labels=list(by_activity);ys=np.arange(len(labels));ax.barh(ys-.18,[by_activity[x] for x in labels],height=.34,color="#2563EB",label="Recommended");ax.barh(ys+.18,[completed[x] for x in labels],height=.34,color="#16A34A",label="Marked completed");ax.set_yticks(ys,labels);ax.invert_yaxis();ax.legend(frameon=False,ncol=2,fontsize=8);ax.set_xlabel("Recorded recommendations")
    else: ax.text(.5,.5,"No recorded recommendations.",ha="center",va="center",transform=ax.transAxes)
    ax.set_title("Recommended and completed activities",loc="left",fontsize=10,color="#172554");ax.grid(axis="x",alpha=.15);fig.tight_layout();return _png(fig)


def _bar_chart(labels,values,title):
    fig,ax=plt.subplots(figsize=(7.1,2.5))
    if labels:
        ax.barh(labels,values,color=["#2563EB" if i%2==0 else "#16A34A" for i in range(len(labels))]);ax.invert_yaxis();ax.set_xlabel("Count / probability")
    else: ax.text(.5,.5,"No recorded data in this period.",ha="center",va="center",transform=ax.transAxes)
    ax.set_title(title,loc="left",fontsize=10,color="#172554");ax.grid(axis="x",alpha=.15);fig.tight_layout();return _png(fig)


def _png(fig):
    data=BytesIO();fig.savefig(data,format="png",dpi=145,bbox_inches="tight",facecolor="white");plt.close(fig);data.seek(0);return data


def generate_cnn_summary(predictions, observation_count):
    if not predictions:
        return {"available":False,"text":"Insufficient observations for reliable temporal pattern analysis.","probabilities":None}
    latest=dict(predictions[-1])
    probs=latest.get("probabilities") or {}
    label=dict(zip(CLASSES,CLASS_LABELS)).get(latest["trend"],latest["trend"])
    return {"available":True,"text":f"The CNN identified a {label.lower()} pattern across the available chronological self-reported observation window.","trend":latest["trend"],"label":label,"confidence":float(latest["confidence"]),"date":latest["checkin_date"],"window_start":latest.get("window_start",latest["checkin_date"]),"window_end":latest.get("window_end",latest["checkin_date"]),"observation_count":observation_count,"probabilities":probs,"model_version":latest.get("model_version")}


def generate_drl_summary(recommendations):
    completed={"completed_helpful","completed_neutral","completed_unhelpful"}
    return {"recommendation_count":len(recommendations),"completed_count":sum(r.get("outcome") in completed for r in recommendations),"recommendations":recommendations}


def generate_zenmode_summary(sessions):
    counts=Counter(s["activity_name"] for s in sessions)
    return {"session_count":len(sessions),"minutes":sum(int(s["duration_minutes"]) for s in sessions),"breathing_sessions":sum(s["category"]=="Breathing" for s in sessions),"activity_counts":dict(counts),"most_used":counts.most_common(1)[0][0] if counts else None}


def generate_ollama_insights(records,metrics):
    rows=records["checkins"]
    # Avoid asking a low-resource model to infer a reflection when there is no student data.
    if not rows and not records.get("sessions") and not records.get("feedback") and not records.get("reported_indicators"):
        return _fallback_insights(records,metrics),"fallback"
    summary={"period":f"{records['start']} to {records['end']}","number_of_checkins":len(rows),
             "self_reported_averages":{k:metrics[k] for k in ("mood","stress","sleep_hours","study_hours","workload")},
             "checkin_values":[{k:r[k] for k in ("checkin_date","mood","stress","sleep_hours","study_hours","academic_workload","study_breaks","physical_activity")} for r in rows],
             "explicit_chat_indicators":records.get("reported_indicators",[]),
             "activities_completed":metrics["activities_completed"],"zen_sessions":metrics["sessions"],"student_feedback":[{k:x[k] for k in ("activity","outcome","note")} for x in records["feedback"]],"preferences":records["preferences"]}
    body=json.dumps({"model":os.getenv("OLLAMA_MODEL","llama3.2:1b-instruct-q2_K"),"stream":False,"format":"json","options":{"temperature":.25,"num_ctx":2048,"num_predict":500},"messages":[
        {"role":"system","content":"Write concise supportive report insights using only the supplied student record JSON. Return JSON with keys summary, went_well, attention, next_steps (3-5 strings), seven_day_plan (7 strings). Never infer absent records, invent metrics, diagnose, claim recovery, state causation, or provide treatment. Use non-clinical, optional suggestions. Explicitly distinguish no data from stable patterns."},
        {"role":"user","content":"Create a personalized reflection from this authorized, minimized student data. No raw conversation transcript is included. DATA="+json.dumps(summary,ensure_ascii=False)}
    ]}).encode()
    req=urllib.request.Request(os.getenv("OLLAMA_URL","http://127.0.0.1:11434/api/chat"),data=body,headers={"Content-Type":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=120) as response: answer=json.loads(response.read()).get("message",{}).get("content","")
        # Ollama can return a JSON object or plain text; only accept parsed fields.
        text=answer.strip().strip("`")
        if text.startswith("json"): text=text[4:].strip()
        result=json.loads(text)
        return _normalize_insights(result,records,metrics),"ollama"
    except Exception as exc:
        print(f"Ollama report insight generation unavailable ({type(exc).__name__}).")
        return _fallback_insights(records,metrics),"fallback"


def _normalize_insights(value,records,metrics):
    def clean(key,default):
        item=value.get(key,default)
        if isinstance(item,list): return [str(x)[:350] for x in item[:7]]
        return str(item)[:1200]
    return {"summary":clean("summary","Your report reflects only the observations you chose to record."),
            "went_well":clean("went_well",[]),"attention":clean("attention",[]),
            "next_steps":clean("next_steps",[]),"seven_day_plan":clean("seven_day_plan",[])}


def _fallback_insights(records,metrics):
    rows=records["checkins"];went=[];attention=[]
    if metrics["activities_completed"]: went.append(f"You marked {metrics['activities_completed']} activity session(s) completed.")
    if metrics["mood"] is not None: went.append("You recorded mood check-ins on " + str(metrics["checkins"]) + " day(s).")
    if metrics["sleep_hours"] is not None and metrics["sleep_range"][1]-metrics["sleep_range"][0]>=2: attention.append("Reported sleep duration varied across this period.")
    if metrics["stress"] is not None and metrics["stress_range"][1]-metrics["stress_range"][0]>=3: attention.append("Self-reported stress varied across this period.")
    if not attention: attention.append("No specific change is highlighted from the available records.")
    steps=["Break one large academic task into smaller steps.","Consider brief pauses between study blocks.","Choose an optional ZenMode activity if it feels useful.","Use a sleep routine that fits your schedule.","Contact qualified campus support if you would like to talk with someone."]
    plan=["Choose one priority and a short break.","Try an optional breathing practice.","Review your workload and split one task.","Take a study pause or short walk if it suits you.","Consider a mindfulness session.","Plan a realistic study and rest schedule.","Reflect on what felt useful and adjust your next week."]
    if not rows: return {"summary":"No check-in observations were recorded in this reporting period. Other sections reflect only recorded activity data.","went_well":went,"attention":attention,"next_steps":steps,"seven_day_plan":plan}
    return {"summary":f"This report contains {len(rows)} voluntary check-in(s). The listed averages and charts describe only those records; they do not establish a cause or clinical condition.","went_well":went,"attention":attention,"next_steps":steps,"seven_day_plan":plan}


def _period_comparison(current,previous,current_sessions=None,previous_sessions=None,current_feedback=None,previous_feedback=None):
    result=[]
    fields=[("Mood","mood"),("Self-reported stress","stress"),("Sleep duration (hours)","sleep_hours"),("Study duration (hours)","study_hours")]
    for label,key in fields:
        a,b=_mean(current,key),_mean(previous,key)
        if a is None or b is None: status="Insufficient data for comparison"
        elif math.isclose(a,b,rel_tol=.05,abs_tol=.05): status="Relatively unchanged"
        elif a>b: status="Increased"
        else: status="Decreased"
        result.append([label,f"{a:.2f}" if a is not None else "--",f"{b:.2f}" if b is not None else "--",status])
    current_sessions=current_sessions or [];previous_sessions=previous_sessions or []
    current_feedback=current_feedback or [];previous_feedback=previous_feedback or []
    measures=[("ZenMode completed sessions",len(current_sessions),len(previous_sessions)),
             ("ZenMode minutes",sum(x["duration_minutes"] for x in current_sessions),sum(x["duration_minutes"] for x in previous_sessions)),
             ("Activities marked completed",sum(x["outcome"].startswith("completed_") for x in current_feedback),sum(x["outcome"].startswith("completed_") for x in previous_feedback))]
    has_previous=bool(previous or previous_sessions or previous_feedback)
    for label,a,b in measures:
        status="Insufficient data for comparison" if not has_previous else "Relatively unchanged" if a==b else "Increased" if a>b else "Decreased"
        result.append([label,str(a),str(b) if has_previous else "--",status])
    return result


def _fmt(value,digits=2): return f"{value:.{digits}f}" if value is not None else "Not recorded"


def create_pdf_report(records,period,insights,insight_source,report_date=None):
    report_date=report_date or date.today().isoformat();metrics=calculate_wellbeing_metrics(records);rows=records["checkins"]
    cnn=generate_cnn_summary(records["predictions"],len(rows));drl=generate_drl_summary(records["recommendations"]);zen=generate_zenmode_summary(records["sessions"])
    buffer=BytesIO();doc=SimpleDocTemplate(buffer,pagesize=A4,rightMargin=17*mm,leftMargin=17*mm,topMargin=20*mm,bottomMargin=19*mm,title="Student Well-being & Progress Report",author="SASTRA MindCare AI")
    base=getSampleStyleSheet();
    styles={"title":ParagraphStyle("CoverTitle",parent=base["Title"],fontName="Helvetica-Bold",fontSize=28,leading=34,textColor=NAVY,alignment=TA_CENTER,spaceAfter=9),
            "subtitle":ParagraphStyle("Subtitle",parent=base["Normal"],fontSize=14,leading=20,textColor=GREEN,alignment=TA_CENTER,spaceAfter=16),
            "h1":ParagraphStyle("Section",parent=base["Heading1"],fontName="Helvetica-Bold",fontSize=18,leading=23,textColor=NAVY,spaceBefore=11,spaceAfter=8),
            "h2":ParagraphStyle("Subsection",parent=base["Heading2"],fontName="Helvetica-Bold",fontSize=12,leading=16,textColor=GREEN,spaceBefore=8,spaceAfter=5),
            "body":ParagraphStyle("Body",parent=base["BodyText"],fontSize=9,leading=13,textColor=colors.HexColor("#334155"),spaceAfter=5),
            "small":ParagraphStyle("Small",parent=base["BodyText"],fontSize=7.5,leading=10,textColor=MUTED,spaceAfter=4),
            "covermeta":ParagraphStyle("CoverMeta",parent=base["Normal"],fontSize=10,leading=17,textColor=NAVY,alignment=TA_CENTER)}
    story=[Spacer(1,22*mm),Paragraph("SASTRA MINDCARE AI",ParagraphStyle("Logo",parent=styles["h2"],fontSize=15,alignment=TA_CENTER,textColor=BLUE)),Spacer(1,17*mm),Paragraph("Student Well-being &amp;<br/>Progress Report",styles["title"]),Paragraph("Personal Academic Wellness Insights",styles["subtitle"]),Spacer(1,9*mm)]
    student_name=xml_escape(records.get("student_name") or records["student_id"])
    cover=[[Paragraph(f"<b>Student</b><br/>{student_name}",styles["covermeta"])],[Paragraph(f"<b>University</b><br/>SASTRA Deemed to be University",styles["covermeta"])],[Paragraph(f"<b>Reporting period</b><br/>{records['start']} to {records['end']} ({period.title()})",styles["covermeta"])],[Paragraph(f"<b>Generated</b><br/>{report_date}",styles["covermeta"])]]
    cover_table=Table(cover,colWidths=[150*mm]);cover_table.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),PALE),("BOX",(0,0),(-1,-1),.6,colors.HexColor("#BFDBFE")),("INNERGRID",(0,0),(-1,-1),.3,colors.white),("TOPPADDING",(0,0),(-1,-1),10),("BOTTOMPADDING",(0,0),(-1,-1),10)]));story += [cover_table,Spacer(1,13*mm),Paragraph("PRIVATE STUDENT WELL-BEING RECORD",ParagraphStyle("Confidential",parent=styles["covermeta"],fontName="Helvetica-Bold",textColor=GREEN)),Spacer(1,8*mm),Paragraph("This report contains private student information. Share it only when you choose.",styles["small"]),PageBreak()]
    story += [Paragraph("Executive summary",styles["h1"]),Paragraph(xml_escape(insights["summary"]),styles["body"]),Paragraph("The report distinguishes student-reported information, model-generated observations and AI-generated suggestions. It contains no raw chatbot transcript.",styles["small"])]
    story += [Paragraph("Student well-being snapshot",styles["h1"])]
    cards=[["Metric","Value","Observation basis"],["Average self-reported mood",_fmt(metrics["mood"])+(" / 5" if metrics["mood"] is not None else ""),f"{len(rows)} check-ins"],["Average self-reported stress",_fmt(metrics["stress"])+(" / 10" if metrics["stress"] is not None else ""),f"{len(rows)} check-ins"],["Average reported sleep",_fmt(metrics["sleep_hours"])+(" hours" if metrics["sleep_hours"] is not None else ""),f"{len(rows)} check-ins"],["Average study duration",_fmt(metrics["study_hours"])+(" hours/day" if metrics["study_hours"] is not None else ""),f"{len(rows)} check-ins"],["Daily check-ins",str(len(rows)),"Actual saved records"],["ZenMode sessions completed",str(zen["session_count"]),"Timer completions recorded"],["Completed activities",str(metrics["activities_completed"]),"Student feedback records"],["Feedback submitted",str(metrics["feedback_count"]),"Actual saved feedback"]]
    cards.insert(5,["Average academic workload",_fmt(metrics["workload"])+(" / 10" if metrics["workload"] is not None else ""),f"{len(rows)} check-ins"])
    story += [_table(cards,[66*mm,42*mm,53*mm]),Spacer(1,5)]
    indicators=records.get("reported_indicators",[])
    story += [Paragraph("Explicitly shared in chat",styles["h1"])]
    if indicators:
        labels={"mood":"Mood (self-reported / 5)","stress":"Stress (self-reported / 10)","sleep_hours":"Sleep duration (hours)","academic_workload":"Academic workload (/ 10)","study_hours":"Study duration (hours)","physical_activity":"Physical activity (minutes)","study_breaks":"Study breaks (count)"}
        story += [_table([["Date","Indicator","Reported value"]]+[[x["observation_date"],labels.get(x["metric"],x["metric"].replace("_"," ").title()),_fmt(float(x["value"]))] for x in indicators],[34*mm,82*mm,45*mm]),Paragraph("These values were explicitly shared in chat and saved with consent. They are shown as reported, without interpreting the rest of the conversation or inventing missing details.",styles["small"])]
    else:
        story += [Paragraph("No numeric well-being indicators were explicitly shared in chat for this period. General conversation content is not copied into this private report.",styles["body"])]
    story += [Paragraph("Mood trend analysis",styles["h1"]),Image(generate_mood_chart(rows),width=174*mm,height=59*mm)]
    if rows: story += [Paragraph(f"Average: {_fmt(metrics['mood'])}/5. Highest: {metrics['mood_range'][1]:.2f}; lowest: {metrics['mood_range'][0]:.2f}. Values are daily student self-reports.",styles["body"])]
    else: story += [Paragraph("No mood observations were recorded for this period.",styles["body"])]
    stress_body=f"Average self-reported stress: {_fmt(metrics['stress'])}/10. Highest: {metrics['stress_range'][1]:.2f}; lowest: {metrics['stress_range'][0]:.2f}. This is not a clinical measure." if rows else "No stress observations were recorded for this period."
    story += [KeepTogether([Paragraph("Stress pattern analysis",styles["h1"]),Image(generate_stress_chart(rows),width=174*mm,height=59*mm),Paragraph(stress_body,styles["body"])])]
    sleep_body=f"Average reported duration: {_fmt(metrics['sleep_hours'])} hours across {len(rows)} check-in(s). Observed range: {_fmt(metrics['sleep_range'][0])} to {_fmt(metrics['sleep_range'][1])} hours. Sleep consistency is not inferred when records are missing."
    story += [Paragraph("Sleep and study patterns",styles["h1"]),KeepTogether([Paragraph("Reported sleep duration",styles["h2"]),Image(generate_sleep_chart(rows),width=174*mm,height=56*mm),Paragraph(sleep_body,styles["body"])]),KeepTogether([Paragraph("Study duration, workload, breaks and physical activity",styles["h2"]),Image(generate_study_chart(rows),width=174*mm,height=105*mm),Paragraph("Study/rest observations describe reported hours, workload ratings, breaks and activity. They do not make health claims.",styles["body"])])]
    if rows:
        daily=[ ["Date","Mood / 5","Stress / 10","Sleep h","Workload / 10","Study h","Activity min","Breaks"] ]
        daily += [[r["checkin_date"],_fmt(r["mood"]),_fmt(r["stress"]),_fmt(r["sleep_hours"]),_fmt(r["academic_workload"]),_fmt(r["study_hours"]),_fmt(r["physical_activity"]),_fmt(r["study_breaks"])] for r in rows]
        story += [Paragraph("Daily self-reported levels",styles["h2"]),_table(daily,[23*mm,19*mm,21*mm,17*mm,25*mm,17*mm,24*mm,15*mm]),Paragraph("These are the values entered in voluntary check-ins. Sleep duration and stress values are self-reported observations, not medical or clinical measurements.",styles["small"])]
    story += [PageBreak(),Paragraph("CNN temporal well-being observations",styles["h1"])]
    if cnn["available"]:
        window_start=rows[0]["checkin_date"] if rows else cnn["date"];window_end=rows[-1]["checkin_date"] if rows else cnn["date"]
        story += [Paragraph(f"Machine-generated observation: {cnn['text']} Confidence: {cnn['confidence']:.1%}. Observation window: {window_start} to {window_end} ({len(rows)} chronological check-in(s)). Model confidence is not clinical certainty.",styles["body"])]
        probs=cnn["probabilities"] or {};story += [Image(_bar_chart([CLASS_LABELS[i] for i,c in enumerate(CLASSES)],[float(probs.get(c,0)) for c in CLASSES],"CNN class probability output"),width=170*mm,height=60*mm)]
        story += [_table([["Class","Probability"]]+[[CLASS_LABELS[i],f"{float(probs.get(c,0)):.1%}"] for i,c in enumerate(CLASSES)],[125*mm,36*mm])]
    else: story += [Paragraph("Insufficient observations for reliable temporal pattern analysis. The CNN requires at least seven chronological daily observations; no prediction has been fabricated.",styles["body"])]
    story += [Paragraph("The CNN output summarizes patterns in voluntarily reported data. It is not a clinical or psychiatric diagnosis.",styles["small"])]
    story += [Paragraph("DRL personalized support recommendations",styles["h1"])]
    if records["recommendations"]:
        table=[["Date","Activity / category","Duration","Reason","Completion / feedback"]]
        for item in records["recommendations"]:
            outcome=item.get("outcome") or ("Completed ZenMode" if item.get("session_completed_at") else "No feedback")
            completion=("Completed ZenMode" if item.get("session_completed_at") else outcome.replace("_"," "))+(f": {item['note']}" if item.get("note") else "")
            table.append([str(item["created_at"])[:10],ACTIVITY_NAMES.get(item["activity"],item["activity"].replace("_"," ").title())+" / "+ACTIVITY_CATEGORIES.get(item["activity"],"Support"),f"{item['duration_minutes']} min",item["reason"],completion])
        story += [_table(table,[22*mm,34*mm,16*mm,56*mm,34*mm]),Paragraph("Activities listed were selected by the shared DRL policy. Accepting, declining or completing an activity does not demonstrate improvement or causation.",styles["small"])]
        counts=Counter(ACTIVITY_NAMES.get(x["activity"],x["activity"].replace("_"," ").title()) for x in records["recommendations"])
        story += [Image(_recommendation_chart(records["recommendations"]),width=168*mm,height=65*mm)]
    else: story += [Paragraph("No DRL recommendations were recorded during this period.",styles["body"])]
    story += [PageBreak(),Paragraph("ZenMode progress",styles["h1"]),Paragraph(f"Completed timer sessions: {zen['session_count']}; breathing exercises completed: {zen['breathing_sessions']}. Recorded activity time: {zen['minutes']} minutes. Time spent is not a measure of well-being improvement.",styles["body"])]
    if zen["activity_counts"]:
        story += [Image(_bar_chart(list(zen["activity_counts"]),list(zen["activity_counts"].values()),"Completed ZenMode sessions"),width=168*mm,height=57*mm),Paragraph(xml_escape(f"Most frequently completed: {zen['most_used']}.") if zen['most_used'] else "No completed activity available.",styles["body"])]
    envs=Counter(SOUND_NAMES.get(s["sound_id"],s["sound_id"]) for s in records["sessions"] if s.get("sound_id"))
    story += [Paragraph(xml_escape("Environment usage: "+(", ".join(f"{k}: {v}" for k,v in envs.items()) if envs else "No completed session environment was recorded.")),styles["body"])]
    story += [PageBreak(),Paragraph("Personalized AI insights",styles["h1"]),Paragraph("What went well?",styles["h2"])]
    story += [_bullets(insights.get("went_well",[]),styles)]+[Paragraph("What could receive more attention?",styles["h2"]),_bullets(insights.get("attention",[]),styles)]
    story += [Paragraph("Suggested next steps",styles["h2"]),_bullets(insights.get("next_steps",[]),styles)]
    if insight_source=="fallback": story += [Paragraph("Ollama was unavailable when this report was generated. These general suggestions are not presented as Ollama-generated insights.",styles["small"])]
    story += [Paragraph("Optional seven-day well-being plan",styles["h1"]),Paragraph("A flexible reflection guide, not mandatory treatment or a clinical care plan.",styles["small"])]
    plan=insights.get("seven_day_plan",[]);story += [_table([["Day","Optional idea"]]+[[f"Day {i+1}",str(v)] for i,v in enumerate(plan[:7])],[22*mm,140*mm])]
    story += [Paragraph("Period-over-period comparison",styles["h1"]),Paragraph("Current and immediately preceding periods use equal date ranges. Differences are descriptive only; no statistical significance or causal effect is claimed.",styles["small"])]
    cmp=_period_comparison(rows,records["previous_checkins"],records["sessions"],records["previous_sessions"],records["feedback"],records["previous_feedback"]);story += [_table([["Measure","Current","Previous","Description"]]+cmp,[42*mm,30*mm,30*mm,60*mm])]
    previous_session_minutes=sum(x["duration_minutes"] for x in records["previous_sessions"])
    previous_completed=sum(x["outcome"].startswith("completed_") for x in records["previous_feedback"])
    story += [Paragraph("ZenMode period comparison",styles["h2"]),Paragraph(f"Current period: {zen['session_count']} completed sessions / {zen['minutes']} minutes; previous equivalent period: {len(records['previous_sessions'])} completed sessions / {previous_session_minutes} minutes. Completed feedback records: current {metrics['activities_completed']}, previous {previous_completed}.",styles["body"])]
    story += [Paragraph("Student feedback and reflection",styles["h1"])]
    if records["feedback"]:
        story += [_table([["Date","Activity","Outcome","Optional reflection"]]+[[x["created_at"][:10],ACTIVITY_NAMES.get(x["activity"],x["activity"].replace("_"," ").title()),x["outcome"].replace("_"," "),x.get("note") or "--"] for x in records["feedback"]],[22*mm,40*mm,36*mm,64*mm])]
    else: story += [Paragraph("No activity feedback was submitted during this period.",styles["body"])]
    prefs=[ACTIVITY_NAMES.get(x,x.replace("_"," ").title()) for x,n in records["preferences"].items() if n]
    story += [Paragraph("Preferred relaxation activities recorded in check-ins: "+(", ".join(prefs) if prefs else "No preference was recorded."),styles["body"])]
    turns=records["companion_turns"];story += [Paragraph("Assistant preference: " + (", ".join(f"{k.title()} {v} response(s)" for k,v in turns.items()) if turns else "No assistant response use was recorded in this period."),styles["body"])]
    story += [PageBreak(),Paragraph("Campus human support",styles["h1"]),Paragraph("SASTRA Student Wellness Activities &amp; Support (SWAS)",styles["h2"]),Paragraph("Phone: 04362-350023<br/>Email: deanswas@sastra.edu<br/>Website: https://sastra.edu/swas/<br/>Office location and support hours: consult the official SWAS website; they are not configured in this report.",styles["body"]),Paragraph("If you may be in immediate danger in India, call emergency number 112 or go to the nearest emergency department.",styles["body"]),Spacer(1,10),Paragraph("Final disclaimer",styles["h1"]),Paragraph("This report is generated using voluntarily provided student well-being information and AI-assisted analytical tools. It is intended for personal reflection and academic well-being support only. It does not constitute a clinical assessment, psychiatric diagnosis or medical advice. CNN outputs represent temporal patterns in self-reported observations and should not be interpreted as clinical conclusions. AI-generated recommendations are optional suggestions. Students experiencing significant distress are encouraged to contact qualified human support.",styles["body"])]
    def page(canvas:Canvas,doc):
        canvas.saveState();w,h=A4
        canvas.setFillColor(MUTED);canvas.setFont("Helvetica",7);canvas.drawRightString(w-17*mm,9*mm,f"Page {doc.page}")
        if doc.page>1:
            canvas.setFillColor(NAVY);canvas.rect(0,h-10*mm,w,10*mm,stroke=0,fill=1);canvas.setFillColor(colors.white);canvas.setFont("Helvetica-Bold",8);canvas.drawString(17*mm,h-6.5*mm,"SASTRA MINDCARE AI")
            canvas.setStrokeColor(colors.HexColor("#DBEAFE"));canvas.line(17*mm,14*mm,w-17*mm,14*mm);canvas.setFillColor(MUTED);canvas.setFont("Helvetica",7);canvas.drawString(17*mm,9*mm,"Private Student Well-being Record / Non-clinical reflection");canvas.restoreState()
    doc.build(story,onFirstPage=page,onLaterPages=page);buffer.seek(0);return buffer.getvalue()


def _table(data,widths):
    from reportlab.lib.styles import ParagraphStyle
    header=ParagraphStyle("ReportTableHead",fontName="Helvetica-Bold",fontSize=7,leading=9,textColor=colors.white)
    body=ParagraphStyle("ReportTableCell",fontName="Helvetica",fontSize=7,leading=9,textColor=colors.HexColor("#334155"))
    wrapped=[]
    for row_index,row in enumerate(data):
        style=header if row_index==0 else body
        wrapped.append([Paragraph(xml_escape(str(cell)).replace("\n","<br/>"),style) for cell in row])
    t=Table(wrapped,colWidths=widths,repeatRows=1,hAlign="LEFT")
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),NAVY),("GRID",(0,0),(-1,-1),.35,colors.HexColor("#CBD5E1")),("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,PALE]),("VALIGN",(0,0),(-1,-1),"TOP"),("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5)]))
    return t


def _bullets(items,styles):
    if not items: items=["No item was identified from available records."]
    return Table([[Paragraph("-",styles["body"]),Paragraph(xml_escape(str(item)),styles["body"])] for item in items],colWidths=[7*mm,155*mm],hAlign="LEFT")
