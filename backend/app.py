from __future__ import annotations

import hashlib
import json
import re
import os
import sqlite3
import threading
import urllib.error
import urllib.request
import wave
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")

from backend.model import CLASSES, FEATURES, cnn_service
from backend.recommender import ACTIVITIES, recommender
from backend.storage import checkins as load_checkins, connect, has_consent, init_db, latest_prediction, latest_recommendation

app = FastAPI(title="SASTRA MindCare shared services", version="1.0.0")
_tts_voices: dict[str, Any] = {}
_tts_locks = {"pixel": threading.Lock(), "luna": threading.Lock()}
@app.on_event("startup")
def startup() -> None:
    init_db()
    try:
        from piper import PiperVoice
        voice_dir = Path(__file__).resolve().parent / "voices"
        defaults = {"pixel": voice_dir / "en_US-hfc_male-medium.onnx", "luna": voice_dir / "en_US-hfc_female-medium.onnx"}
        for companion in ("pixel", "luna"):
            configured = os.getenv("MINDCARE_PIXEL_VOICE_PATH" if companion == "pixel" else "MINDCARE_LUNA_VOICE_PATH")
            model_file = Path(configured).expanduser() if configured else defaults[companion]
            if model_file.is_file():
                _tts_voices[companion] = PiperVoice.load(str(model_file), use_cuda=False)
    except Exception as exc:
        print(f"Local Piper TTS unavailable ({type(exc).__name__}).")


def require_user(request: Request) -> int:
    token = request.cookies.get("uday_session")
    if not token:
        raise HTTPException(status_code=401, detail="Please log in to continue.")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        row = db.execute("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?", (token_hash, int(datetime.now().timestamp() * 1000))).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Your session has expired. Please log in again.")
    return int(row["user_id"])


class CheckinInput(BaseModel):
    consent: bool
    checkin_date: date = Field(default_factory=date.today)
    mood: float = Field(ge=1, le=5)
    stress: float = Field(ge=1, le=10)
    sleep_hours: float = Field(ge=0, le=24)
    academic_workload: float = Field(ge=1, le=10)
    study_hours: float = Field(ge=0, le=24)
    physical_activity: float = Field(ge=0, le=600)
    study_breaks: float = Field(ge=0, le=20)
    preferences: list[str] = Field(default_factory=list, max_length=10)


class ChatInput(BaseModel):
    companion: str = Field(pattern="^(pixel|luna)$")
    message: str = Field(min_length=1, max_length=1200)
    conversation_id: int | None = None


class FeedbackInput(BaseModel):
    recommendation_id: int | None = None
    activity: str
    outcome: str = Field(pattern="^(completed_helpful|completed_neutral|completed_unhelpful|declined)$")
    note: str | None = Field(default=None, max_length=400)


class ConsentInput(BaseModel):
    consent: bool


class ZenSessionInput(BaseModel):
    activity_id: str = Field(min_length=1, max_length=60)
    activity_name: str = Field(min_length=1, max_length=100)
    category: str = Field(min_length=1, max_length=40)
    duration_minutes: int = Field(ge=1, le=60)
    sound_id: str | None = Field(default=None, max_length=40)
    recommendation_id: int | None = None


class ReportGenerateInput(BaseModel):
    period: str = Field(pattern="^(weekly|monthly|custom)$")
    start_date: date | None = None
    end_date: date | None = None


class TTSInput(BaseModel):
    text: str = Field(min_length=1, max_length=1200)


def latest_context(user_id: int) -> dict[str, Any]:
    with connect() as db:
        consent = has_consent(db, user_id)
        rows = load_checkins(db, user_id, 14) if consent else []
        prediction = latest_prediction(db, user_id) if consent else None
        rec = latest_recommendation(db, user_id) if consent else None
        feedback_rows = db.execute("SELECT activity,outcome FROM activity_feedback WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 10", (user_id,)).fetchall() if consent else []
    return {"consented": consent, "observations": rows, "prediction": prediction, "recommendation": rec, "feedback": [dict(row) for row in reversed(feedback_rows)]}


def generate_recommendation(user_id: int) -> dict[str, Any] | None:
    ctx = latest_context(user_id)
    if not ctx["consented"] or not ctx["observations"] or not cnn_service.scaler:
        return None
    row = ctx["observations"][-1]
    trend = ctx["prediction"]["trend"] if ctx["prediction"] else "unknown"
    prefs = json.loads(row.get("preferences_json") or "[]")
    candidate = recommender.recommend(row, trend, ctx["feedback"], prefs, cnn_service.scaler)
    if not candidate:
        return None
    with connect() as db:
        cur = db.execute("INSERT INTO drl_recommendations(user_id,checkin_id,activity,duration_minutes,reason,source) VALUES(?,?,?,?,?,?)", (user_id, row["id"], candidate["id"], candidate["minutes"], candidate["reason"], candidate["source"]))
        rec_id = cur.lastrowid
    candidate["recommendation_id"] = int(rec_id)
    return candidate


def support_details() -> dict[str, str]:
    return {"name": "SASTRA Student Wellness Activities & Support (SWAS)", "phone": "04362-350023", "email": "deanswas@sastra.edu", "url": "https://sastra.edu/swas/", "emergency": "112"}


SAFETY_PATTERNS = [
    r"\b(suicid\w*|self[- ]harm|hurt myself|harm myself|kill myself|end my life|don't want to live|do not want to live|don't want to be alive|do not want to be alive)\b",
    r"\b(?:w(?:an|na)t|wanna|wana)\s+(?:(?:to|2)\s+)?d(?:ie|ye)\b",
    r"\b(?:better off dead|wish (?:i|we) (?:were|was) dead|not worth living|end it all)\b",
    r"\b(can't keep myself safe|cannot keep myself safe|in immediate danger|going to hurt myself)\b",
]


def safety_response(message: str) -> bool:
    return any(re.search(pattern, message, flags=re.IGNORECASE) for pattern in SAFETY_PATTERNS)


def ollama_reply(companion: str, message: str, history: list[dict[str, str]], context: dict[str, Any]) -> tuple[str, str]:
    if companion == "pixel":
        personality = "You are Pixel: friendly, energetic, warm, encouraging, and conversational."
    else:
        personality = "You are Luna: gentle, calm, reassuring, patient, and soft-spoken."
    context_payload = {
        "authorized_consent": context["consented"],
        "latest_self_reported_observation": {k: context["observations"][-1][k] for k in FEATURES + ["checkin_date"]} if context["observations"] else None,
        "explicitly_reported_in_this_message": context.get("explicitly_reported_in_this_message", {}),
        "recent_cnn_temporal_observation": context["prediction"],
        "latest_optional_activity_recommendation": context["recommendation"],
    }
    system = (
        f"{personality} You are a practical, non-clinical student well-being assistant. "
        "Answer the student's LATEST message directly and in plain, natural language. "
        "First identify what they are actually asking; do not change the topic or reinterpret ordinary questions as illness, danger, or a crisis. "
        "For everyday problems (including hostel food), give relevant, realistic options and one gentle follow-up question only if useful. "
        "Use at most 3 short sentences unless the student asks for detail. Do not produce random names, stories, unrelated advice, or a numbered list unless requested. "
        "Use earlier turns only to resolve references in the latest message; disregard unrelated or mistaken earlier assistant replies. "
        "You support academic stress, exams, assignments, study planning, balance, sleep routines, and self-care. "
        "Never diagnose, prescribe treatment, claim recovery, make clinical/crisis decisions, or invent student numbers. "
        "Treat CNN results only as uncertain patterns in voluntary self-reports; state no prediction if there is insufficient history. "
        "Recommendations are optional. If asked for professional help, direct the student to SASTRA SWAS. "
        "The context JSON is the only authorized structured student data; do not infer missing values. "
        f"\nAUTHORIZED CONTEXT JSON:\n{json.dumps(context_payload, ensure_ascii=False)}"
    )
    turns = [{"role": "system", "content": system}]
    # Small quantized local models are easily distracted by long or stale transcripts.
    # Keep only a few recent turns, bound their size, and reserve the last user turn for
    # the current message so old hallucinations cannot dominate the answer.
    recent_history = history[-6:]
    turns.extend(
        {
            "role": "user" if item["role"] == "student" else "assistant",
            "content": str(item["text"])[:700],
        }
        for item in recent_history
    )
    turns.append({"role": "user", "content": message})
    body = json.dumps({"model": os.getenv("OLLAMA_MODEL", "llama3.2:1b-instruct-q2_K"), "messages": turns, "stream": False, "options": {"temperature": 0.2, "num_ctx": 4096, "num_predict": 160, "repeat_penalty": 1.15}}).encode()
    request = urllib.request.Request(os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/chat"), data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            payload = json.loads(response.read())
        answer = payload.get("message", {}).get("content", "").strip()
        if answer:
            return answer, "ollama"
    except urllib.error.HTTPError as exc:
        detail = exc.read(1200).decode("utf-8", errors="replace")
        print(f"Ollama HTTP {exc.code}: {detail}")
    except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as exc:
        print(f"Ollama request unavailable ({type(exc).__name__}); using generic fallback.")
    # Explicitly report the fallback; this does not mimic generated intelligence.
    if companion == "pixel":
        return "I'm having trouble reaching the local assistant right now. I can still help you take one small step: choose the next task you want to handle, then leave room for a short break. You can also open ZenMode when that feels useful.", "fallback"
    return "I can’t reach the local assistant at the moment. We can still move gently, one step at a time. Choose one thing that feels most important, and pause for a small break if that would help.", "fallback"


INDICATOR_PATTERNS = {
    "mood": [(r"\bmood(?:\s+(?:level|is|was))?\s*(?:[:=]|of|at)?\s*(\d+(?:\.\d+)?)\s*(?:/\s*5)?\b", (1, 5))],
    "stress": [(r"\bstress(?:\s+(?:level|is|was))?\s*(?:[:=]|of|at)?\s*(\d+(?:\.\d+)?)\s*(?:/\s*10)?\b", (1, 10))],
    "sleep_hours": [(r"\b(?:sleep|sleeping|slept)\s+(?:for\s+|about\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", (0, 24))],
    "academic_workload": [(r"\b(?:academic\s+)?workload(?:\s+(?:level|is|was))?\s*(?:[:=]|of|at)?\s*(\d+(?:\.\d+)?)\s*(?:/\s*10)?\b", (1, 10))],
    "study_hours": [(r"\b(?:studied|study(?:ing)?|study\s+duration)\s+(?:for\s+|about\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", (0, 24))],
    "physical_activity": [(r"\b(?:physical\s+activity|exercise|walk(?:ed|ing)?)\s+(?:for\s+|about\s+|around\s+)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b", (0, 600))],
    "study_breaks": [(r"\b(?:study\s+)?breaks?(?:\s+(?:count|is|were))?\s*(?:[:=]|of|at)?\s*(\d+(?:\.\d+)?)\b", (0, 20))],
}


def extract_explicit_indicators(message: str) -> dict[str, float]:
    """Only parse numbers adjacent to explicit indicator labels; never infer missing fields."""
    result: dict[str, float] = {}
    for metric, patterns in INDICATOR_PATTERNS.items():
        for pattern, (low, high) in patterns:
            match = re.search(pattern, message, flags=re.IGNORECASE)
            if not match:
                continue
            value = float(match.group(1))
            if low <= value <= high:
                result[metric] = value
                break
    return result


def save_explicit_indicators(user_id: int, message: str) -> tuple[list[str], bool]:
    values = extract_explicit_indicators(message)
    if not values:
        return [], False
    today = date.today().isoformat()
    digest = hashlib.sha256(message.strip().encode("utf-8")).hexdigest()
    with connect() as db:
        if not has_consent(db, user_id):
            return [], False
        for metric, value in values.items():
            db.execute("INSERT INTO reported_indicators(user_id,observation_date,metric,value,source_message_hash) VALUES(?,?,?,?,?) ON CONFLICT(user_id,observation_date,metric,source_message_hash) DO NOTHING", (user_id, today, metric, value, digest))
        latest = db.execute("SELECT metric,value FROM reported_indicators WHERE user_id=? AND observation_date=? ORDER BY id", (user_id, today)).fetchall()
        accumulated = {row["metric"]: float(row["value"]) for row in latest}
        complete = all(feature in accumulated for feature in FEATURES)
        if not complete:
            return list(values), False
        db.execute("""INSERT INTO wellbeing_checkins(user_id,checkin_date,mood,stress,sleep_hours,academic_workload,study_hours,physical_activity,study_breaks,preferences_json)
          VALUES(?,?,?,?,?,?,?,?,?, '[]') ON CONFLICT(user_id,checkin_date) DO UPDATE SET mood=excluded.mood,stress=excluded.stress,sleep_hours=excluded.sleep_hours,academic_workload=excluded.academic_workload,study_hours=excluded.study_hours,physical_activity=excluded.physical_activity,study_breaks=excluded.study_breaks""",
          (user_id, today, *(accumulated[feature] for feature in FEATURES)))
        checkin = db.execute("SELECT * FROM wellbeing_checkins WHERE user_id=? AND checkin_date=?", (user_id, today)).fetchone()
        rows = load_checkins(db, user_id, 14)
        if len(rows) >= 7 and cnn_service.available:
            result = cnn_service.predict(rows)
            if result:
                db.execute("INSERT INTO cnn_predictions(user_id,checkin_id,trend,confidence,probabilities_json,model_version) VALUES(?,?,?,?,?,?)", (user_id, checkin["id"], result["trend"], result["confidence"], json.dumps(result["probabilities"]), result["model_version"]))
        return list(values), True


@app.get("/health")
def health():
    ollama_ok = False
    ollama_models: list[str] = []
    try:
        req = urllib.request.Request(os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/tags").rsplit("/api/", 1)[0] + "/api/tags")
        with urllib.request.urlopen(req, timeout=1) as response:
            ollama_ok = response.status == 200
            ollama_models = [item.get("name", "") for item in json.loads(response.read()).get("models", [])]
    except Exception: pass
    selected_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b-instruct-q2_K")
    return {"ok": True, "cnn_loaded": cnn_service.available, "cnn_error": cnn_service.error, "dqn_loaded": recommender.available, "dqn_error": recommender.error, "ollama_reachable": ollama_ok, "ollama_model": selected_model, "ollama_model_installed": selected_model in ollama_models, "local_voices_loaded": sorted(_tts_voices.keys())}


@app.post("/tts/{companion}")
def synthesize_speech(companion: str, data: TTSInput, request: Request):
    require_user(request)
    if companion not in ("pixel", "luna"):
        raise HTTPException(404, "Choose Pixel or Luna for voice output.")
    voice = _tts_voices.get(companion)
    if voice is None:
        raise HTTPException(503, "The local voice model is unavailable. Please check the Python backend logs.")
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", data.text).strip()
    if not cleaned:
        raise HTTPException(400, "There is no text to speak.")
    output = BytesIO()
    try:
        with _tts_locks[companion]:
            with wave.open(output, "wb") as wav_file:
                voice.synthesize_wav(cleaned, wav_file)
    except Exception as exc:
        print(f"Piper synthesis failed for {companion} ({type(exc).__name__}).")
        raise HTTPException(503, "Local voice synthesis failed.") from exc
    return Response(content=output.getvalue(), media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/conversations")
def list_conversations(request: Request):
    user_id = require_user(request)
    with connect() as db:
        rows = db.execute("""SELECT c.id,c.title,c.active_companion,c.created_at,c.updated_at,
            COUNT(m.id) AS message_count,
            (SELECT text FROM conversation_messages x WHERE x.conversation_id=c.id ORDER BY x.id DESC LIMIT 1) AS preview
            FROM conversations c LEFT JOIN conversation_messages m ON m.conversation_id=c.id
            WHERE c.user_id=? GROUP BY c.id ORDER BY c.updated_at DESC,c.id DESC""", (user_id,)).fetchall()
    return {"conversations": [dict(row) for row in rows]}


@app.post("/conversations")
def create_conversation(request: Request):
    user_id = require_user(request)
    with connect() as db:
        cursor = db.execute("INSERT INTO conversations(user_id) VALUES(?)", (user_id,))
        row = db.execute("SELECT id,title,active_companion,created_at,updated_at FROM conversations WHERE id=?", (cursor.lastrowid,)).fetchone()
    return dict(row)


@app.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: int, request: Request):
    user_id = require_user(request)
    with connect() as db:
        conversation = db.execute("SELECT id,title,active_companion,created_at,updated_at FROM conversations WHERE id=? AND user_id=?", (conversation_id,user_id)).fetchone()
        if not conversation: raise HTTPException(404, "Conversation not found.")
        messages = db.execute("SELECT id,role,text,companion,recommendation_json,created_at FROM conversation_messages WHERE conversation_id=? AND user_id=? ORDER BY id", (conversation_id,user_id)).fetchall()
    result = []
    for row in messages:
        item = dict(row)
        item["recommendation"] = json.loads(item.pop("recommendation_json")) if item.get("recommendation_json") else None
        result.append(item)
    return {"conversation": dict(conversation), "messages": result}


@app.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, request: Request):
    user_id = require_user(request)
    with connect() as db:
        cursor = db.execute("DELETE FROM conversations WHERE id=? AND user_id=?", (conversation_id,user_id))
    if not cursor.rowcount: raise HTTPException(404, "Conversation not found.")
    return {"deleted": True, "conversation_id": conversation_id}


@app.delete("/conversations")
def delete_all_conversations(request: Request):
    user_id = require_user(request)
    with connect() as db:
        cursor = db.execute("DELETE FROM conversations WHERE user_id=?", (user_id,))
    return {"deleted": True, "count": cursor.rowcount}


@app.post("/chat")
def chat(data: ChatInput, request: Request):
    user_id = require_user(request)
    message = data.message.strip()
    with connect() as db:
        if data.conversation_id is None:
            cursor = db.execute("INSERT INTO conversations(user_id,active_companion) VALUES(?,?)", (user_id,data.companion))
            conversation_id = int(cursor.lastrowid)
        else:
            owned = db.execute("SELECT id FROM conversations WHERE id=? AND user_id=?", (data.conversation_id,user_id)).fetchone()
            if not owned: raise HTTPException(404, "Conversation not found.")
            conversation_id = int(owned["id"])
        history = [dict(row) for row in db.execute("SELECT role,text,companion FROM conversation_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 16", (conversation_id,)).fetchall()][::-1]
    if safety_response(message):
        answer = ("I am really glad you told me. You deserve immediate support from a person who can be with you. If you may be in immediate danger, call India emergency number 112 now or go to the nearest emergency department. At SASTRA, you can contact Student Wellness Activities & Support (SWAS) at 04362-350023 or deanswas@sastra.edu. If possible, please also tell someone you trust nearby. I can stay with you while you reach out.")
        source = "safety"
        recommendation = None
    else:
        extracted, completed_observation = save_explicit_indicators(user_id, message)
        context = latest_context(user_id)
        context["explicitly_reported_in_this_message"] = extract_explicit_indicators(message) if extracted else {}
        wants_activity = bool(re.search(r"\b(recommend|suggest|activity|exercise|zen ?mode|what should i try)\b", message, re.I))
        recommendation = latest_recommendation_record(user_id) if wants_activity else None
        if completed_observation or (wants_activity and recommendation is None): recommendation = generate_recommendation(user_id)
        context["recommendation"] = recommendation or context["recommendation"]
        answer, source = ollama_reply(data.companion, message, history, context)
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        db.execute("INSERT INTO conversation_messages(conversation_id,user_id,role,text,companion) VALUES(?,?, 'student',?,?)", (conversation_id,user_id,message,data.companion))
        db.execute("INSERT INTO conversation_messages(conversation_id,user_id,role,text,companion,recommendation_json) VALUES(?,?, 'assistant',?,?,?)", (conversation_id,user_id,answer,data.companion,json.dumps(recommendation,ensure_ascii=False) if recommendation else None))
        db.execute("UPDATE conversations SET active_companion=?,updated_at=?,title=CASE WHEN title='New conversation' THEN ? ELSE title END WHERE id=? AND user_id=?", (data.companion,now,message[:80],conversation_id,user_id))
    return {"reply": answer, "source": source, "companion": data.companion, "recommendation": recommendation, "safety": source == "safety", "conversation_id": conversation_id}


def latest_recommendation_record(user_id: int) -> dict[str, Any] | None:
    with connect() as db:
        row = db.execute("SELECT * FROM drl_recommendations WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1", (user_id,)).fetchone()
    if not row: return None
    try:
        item = next(x for x in ACTIVITIES if x["id"] == row["activity"])
        return {**item, "reason": row["reason"], "recommendation_id": row["id"], "source": row["source"]}
    except StopIteration: return None


@app.post("/checkins")
def save_checkin(data: CheckinInput, request: Request):
    user_id = require_user(request)
    if not data.consent:
        raise HTTPException(400, "Consent is required to save this voluntary check-in.")
    allowed_prefs = {x["id"] for x in ACTIVITIES}
    if any(item not in allowed_prefs for item in data.preferences):
        raise HTTPException(400, "Choose from the listed activity preferences.")
    values = [data.mood, data.stress, data.sleep_hours, data.academic_workload, data.study_hours, data.physical_activity, data.study_breaks]
    if not all(np.isfinite(values)):
        raise HTTPException(400, "Enter valid numeric check-in values.")
    with connect() as db:
        db.execute("INSERT INTO mindcare_consent(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING", (user_id,))
        db.execute("""INSERT INTO wellbeing_checkins(user_id,checkin_date,mood,stress,sleep_hours,academic_workload,study_hours,physical_activity,study_breaks,preferences_json)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,checkin_date) DO UPDATE SET mood=excluded.mood,stress=excluded.stress,sleep_hours=excluded.sleep_hours,academic_workload=excluded.academic_workload,study_hours=excluded.study_hours,physical_activity=excluded.physical_activity,study_breaks=excluded.study_breaks,preferences_json=excluded.preferences_json""",
          (user_id, data.checkin_date.isoformat(), *values, json.dumps(data.preferences)))
        row = db.execute("SELECT * FROM wellbeing_checkins WHERE user_id=? AND checkin_date=?", (user_id, data.checkin_date.isoformat())).fetchone()
        checkin = dict(row)
        records = load_checkins(db, user_id, 14)
        if cnn_service.available and len(records) >= 7:
            result = cnn_service.predict(records)
            if result:
                db.execute("INSERT INTO cnn_predictions(user_id,checkin_id,trend,confidence,probabilities_json,model_version) VALUES(?,?,?,?,?,?)", (user_id, checkin["id"], result["trend"], result["confidence"], json.dumps(result["probabilities"]), result["model_version"]))
        prediction = latest_prediction(db, user_id)
    rec = generate_recommendation(user_id)
    return {"saved": True, "checkin_date": data.checkin_date.isoformat(), "observations_available": len(records), "cnn": prediction if len(records) >= 7 else None, "cnn_status": "available" if len(records) >= 7 and cnn_service.available else "insufficient_history" if len(records) < 7 else "model_unavailable", "recommendation": rec}


@app.get("/checkins")
def get_checkins(request: Request):
    user_id = require_user(request)
    with connect() as db:
        if not has_consent(db, user_id): return {"consented": False, "observations": []}
        return {"consented": True, "observations": load_checkins(db, user_id, 400)}


@app.post("/recommendations")
def create_recommendation(request: Request):
    user_id = require_user(request)
    item = generate_recommendation(user_id)
    if item is None:
        return {"recommendation": None, "message": "A voluntary check-in is needed before a personalized activity can be selected."}
    return {"recommendation": item}


@app.get("/recommendations")
def get_recommendation(request: Request):
    user_id = require_user(request)
    ctx = latest_context(user_id)
    return {"recommendation": ctx["recommendation"], "feedback": ctx["feedback"]}


@app.post("/activity-feedback")
def save_feedback(data: FeedbackInput, request: Request):
    user_id = require_user(request)
    if data.activity not in {x["id"] for x in ACTIVITIES}:
        raise HTTPException(400, "Unknown activity.")
    with connect() as db:
        if not has_consent(db, user_id): raise HTTPException(403, "Opt in to save activity feedback.")
        if data.recommendation_id is not None:
            owned = db.execute("SELECT 1 FROM drl_recommendations WHERE id=? AND user_id=?", (data.recommendation_id, user_id)).fetchone()
            if not owned: raise HTTPException(404, "Recommendation not found.")
        db.execute("INSERT INTO activity_feedback(user_id,recommendation_id,activity,outcome,note) VALUES(?,?,?,?,?)", (user_id, data.recommendation_id, data.activity, data.outcome, data.note.strip() if data.note else None))
    return {"saved": True}


@app.post("/consent")
def update_consent(data: ConsentInput, request: Request):
    user_id = require_user(request)
    if data.consent:
        with connect() as db: db.execute("INSERT INTO mindcare_consent(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING", (user_id,))
        return {"consented": True}
    with connect() as db:
        db.execute("DELETE FROM mindcare_consent WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM wellbeing_checkins WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM cnn_predictions WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM drl_recommendations WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM activity_feedback WHERE user_id=?", (user_id,))
        db.execute("DELETE FROM reported_indicators WHERE user_id=?", (user_id,))
        report_files=[row["file_path"] for row in db.execute("SELECT file_path FROM generated_reports WHERE user_id=?",(user_id,))]
        db.execute("DELETE FROM generated_reports WHERE user_id=?",(user_id,))
        db.execute("DELETE FROM report_subject_ids WHERE user_id=?",(user_id,))
        db.execute("DELETE FROM zen_sessions WHERE user_id=?",(user_id,))
    for report_path in report_files:
        try:
            from backend.services.report_service import REPORT_DIR
            resolved=Path(report_path).resolve()
            if REPORT_DIR in resolved.parents: resolved.unlink(missing_ok=True)
        except OSError: pass
    return {"consented": False, "deleted": True}


@app.get("/dashboard")
def dashboard(request: Request):
    user_id = require_user(request)
    with connect() as db:
        consent = has_consent(db, user_id)
        if not consent: return {"consented": False, "labels": [], "datasets": [], "predictions": [], "recommendations": [], "feedback": [], "message": "Opt in and add check-ins to view your own trends."}
        rows = db.execute("SELECT * FROM wellbeing_checkins WHERE user_id=? ORDER BY checkin_date", (user_id,)).fetchall()
        predictions = db.execute("SELECT p.trend,p.confidence,p.probabilities_json,p.created_at,c.checkin_date FROM cnn_predictions p JOIN wellbeing_checkins c ON c.id=p.checkin_id WHERE p.user_id=? ORDER BY c.checkin_date", (user_id,)).fetchall()
        recs = db.execute("SELECT id,activity,duration_minutes,reason,created_at FROM drl_recommendations WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (user_id,)).fetchall()
        feedback = db.execute("SELECT f.activity,f.outcome,f.note,f.created_at,r.reason FROM activity_feedback f LEFT JOIN drl_recommendations r ON r.id=f.recommendation_id WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT 50", (user_id,)).fetchall()
    labels = [r["checkin_date"] for r in rows]
    fields = ["mood", "stress", "sleep_hours", "academic_workload", "study_hours", "physical_activity", "study_breaks"]
    datasets = [{"label": key.replace("_", " ").title(), "data": [r[key] for r in rows]} for key in fields]
    return {"consented": True, "labels": labels, "datasets": datasets, "predictions": [{**dict(p), "probabilities": json.loads(p["probabilities_json"])} for p in predictions], "recommendations": [dict(r) for r in recs], "feedback": [dict(r) for r in feedback]}



@app.post("/api/reports/generate")
def generate_report(data: ReportGenerateInput, request: Request):
    user_id = require_user(request)
    if data.period == "weekly":
        end = date.today(); start = end - timedelta(days=6)
    elif data.period == "monthly":
        end = date.today(); start = end - timedelta(days=29)
    else:
        if data.start_date is None or data.end_date is None:
            raise HTTPException(400, "Choose both dates for a custom report.")
        start,end=data.start_date,data.end_date
    if start > end: raise HTTPException(400,"The start date must be on or before the end date.")
    if (end-start).days > 365: raise HTTPException(400,"Custom reports can cover up to 366 days.")
    from backend.services.report_service import fetch_student_records,calculate_wellbeing_metrics,generate_ollama_insights,create_pdf_report,REPORT_DIR
    try: records=fetch_student_records(user_id,start,end,connect,has_consent)
    except PermissionError as exc: raise HTTPException(403,str(exc)) from exc
    except ValueError as exc: raise HTTPException(404,str(exc)) from exc
    metrics=calculate_wellbeing_metrics(records)
    insights,source=generate_ollama_insights(records,metrics)
    pdf=create_pdf_report(records,data.period,insights,source)
    REPORT_DIR.mkdir(parents=True,exist_ok=True)
    report_id=__import__("uuid").uuid4().hex
    path=(REPORT_DIR/f"{user_id}-{report_id}.pdf").resolve()
    if REPORT_DIR not in path.parents: raise HTTPException(500,"Report storage path is invalid.")
    path.write_bytes(pdf)
    try:
        with connect() as db:
            db.execute("INSERT INTO generated_reports(id,user_id,period,start_date,end_date,file_path) VALUES(?,?,?,?,?,?)",(report_id,user_id,data.period,start.isoformat(),end.isoformat(),str(path)))
    except Exception:
        path.unlink(missing_ok=True); raise
    return {"report_id":report_id,"period":data.period,"start_date":start.isoformat(),"end_date":end.isoformat(),"generated_at":datetime.now(timezone.utc).isoformat(),"size_bytes":len(pdf),"insight_source":source,"metrics":metrics,"download_url":f"/api/reports/{report_id}/download"}


@app.get("/api/reports/history")
def report_history(request: Request):
    user_id=require_user(request)
    with connect() as db:
        rows=db.execute("SELECT id,period,start_date,end_date,created_at FROM generated_reports WHERE user_id=? ORDER BY created_at DESC LIMIT 50",(user_id,)).fetchall()
    return {"reports":[dict(row) for row in rows]}


@app.get("/api/reports/{report_id}/download")
def download_report(report_id:str,request:Request,inline:bool=False):
    user_id=require_user(request)
    if not re.fullmatch(r"[a-f0-9]{32}",report_id): raise HTTPException(404,"Report not found.")
    with connect() as db:
        row=db.execute("SELECT period,start_date,end_date,file_path FROM generated_reports WHERE id=? AND user_id=?",(report_id,user_id)).fetchone()
        user=db.execute("SELECT first_name,last_name FROM users WHERE id=?",(user_id,)).fetchone()
    if not row: raise HTTPException(404,"Report not found.")
    from backend.services.report_service import REPORT_DIR
    path=Path(row["file_path"]).resolve()
    if REPORT_DIR not in path.parents or not path.is_file(): raise HTTPException(404,"Report file is unavailable.")
    student_name=" ".join(part for part in (user["first_name"],user["last_name"]) if part) if user else "Student"
    safe_name=re.sub(r"[^A-Za-z0-9_-]+","_",student_name).strip("-_") or "Student"
    filename=f"{safe_name}_Wellbeing_Report_{row['start_date']}_to_{row['end_date']}.pdf"
    return FileResponse(path,media_type="application/pdf",filename=filename,content_disposition_type="inline" if inline else "attachment",headers={"Cache-Control":"no-store, private"})


@app.get("/report")
def legacy_report_download(request:Request,period:str="weekly"):
    """Backward-compatible direct PDF route used by older app links."""
    user_id=require_user(request)
    if period not in ("weekly","monthly"): raise HTTPException(400,"Choose weekly or monthly.")
    end=date.today();start=end-timedelta(days=6 if period=="weekly" else 29)
    from backend.services.report_service import fetch_student_records,calculate_wellbeing_metrics,generate_ollama_insights,create_pdf_report
    try: records=fetch_student_records(user_id,start,end,connect,has_consent)
    except PermissionError as exc: raise HTTPException(403,str(exc)) from exc
    except ValueError as exc: raise HTTPException(404,str(exc)) from exc
    metrics=calculate_wellbeing_metrics(records);insights,source=generate_ollama_insights(records,metrics)
    pdf=create_pdf_report(records,period,insights,source)
    return StreamingResponse(BytesIO(pdf),media_type="application/pdf",headers={"Content-Disposition":f"attachment; filename=mindcare-{period}-report.pdf","Cache-Control":"no-store, private"})


@app.post("/zen-session")
def save_zen_session(data:ZenSessionInput,request:Request):
    user_id=require_user(request)
    if data.category not in {"Breathing","Mindfulness","Relaxation","Visualization","Quick Sessions"}: raise HTTPException(400,"Unknown activity category.")
    with connect() as db:
        if not has_consent(db,user_id): raise HTTPException(403,"Opt in to save activity progress.")
        if data.recommendation_id is not None and not db.execute("SELECT 1 FROM drl_recommendations WHERE id=? AND user_id=?",(data.recommendation_id,user_id)).fetchone(): raise HTTPException(404,"Recommendation not found.")
        db.execute("INSERT INTO zen_sessions(user_id,activity_id,activity_name,category,duration_minutes,sound_id,recommendation_id) VALUES(?,?,?,?,?,?,?)",(user_id,data.activity_id,data.activity_name,data.category,data.duration_minutes,data.sound_id,data.recommendation_id))
    return {"saved":True}

