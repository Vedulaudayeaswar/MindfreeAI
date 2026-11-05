from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv("MINDCARE_DB_PATH", ROOT / "data" / "accounts.sqlite"))


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    try:
        with db:
            yield db
    finally:
        db.close()


def init_db() -> None:
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS mindcare_consent (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          consented_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS wellbeing_checkins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          checkin_date TEXT NOT NULL,
          mood REAL NOT NULL,
          stress REAL NOT NULL,
          sleep_hours REAL NOT NULL,
          academic_workload REAL NOT NULL,
          study_hours REAL NOT NULL,
          physical_activity REAL NOT NULL,
          study_breaks REAL NOT NULL,
          preferences_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, checkin_date)
        );
        CREATE TABLE IF NOT EXISTS cnn_predictions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          checkin_id INTEGER NOT NULL REFERENCES wellbeing_checkins(id) ON DELETE CASCADE,
          trend TEXT NOT NULL,
          confidence REAL NOT NULL,
          probabilities_json TEXT NOT NULL,
          model_version TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS drl_recommendations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          checkin_id INTEGER REFERENCES wellbeing_checkins(id) ON DELETE SET NULL,
          activity TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          reason TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'simulated_dqn',
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS activity_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          recommendation_id INTEGER REFERENCES drl_recommendations(id) ON DELETE SET NULL,
          activity TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK(outcome IN ('completed_helpful','completed_neutral','completed_unhelpful','declined')),
          note TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS reported_indicators (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          observation_date TEXT NOT NULL,
          metric TEXT NOT NULL,
          value REAL NOT NULL,
          source_message_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, observation_date, metric, source_message_hash)
        );
        CREATE TABLE IF NOT EXISTS conversations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT 'New conversation',
          active_companion TEXT NOT NULL DEFAULT 'pixel' CHECK(active_companion IN ('pixel','luna')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS conversation_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL CHECK(role IN ('student','assistant')),
          text TEXT NOT NULL,
          companion TEXT CHECK(companion IN ('pixel','luna')),
          recommendation_json TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS zen_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          activity_id TEXT NOT NULL,
          activity_name TEXT NOT NULL,
          category TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          sound_id TEXT,
          recommendation_id INTEGER REFERENCES drl_recommendations(id) ON DELETE SET NULL,
          completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS generated_reports (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          period TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          file_path TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS report_subject_ids (
          user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          student_code TEXT NOT NULL UNIQUE
        );
        CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON wellbeing_checkins(user_id, checkin_date);
        CREATE INDEX IF NOT EXISTS idx_predictions_user_time ON cnn_predictions(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_recommendations_user_time ON drl_recommendations(user_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_conversations_user_updated ON conversations(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_conversation_messages_thread ON conversation_messages(conversation_id, id);
        CREATE INDEX IF NOT EXISTS idx_zen_sessions_user_date ON zen_sessions(user_id, completed_at);
        CREATE INDEX IF NOT EXISTS idx_reports_user_created ON generated_reports(user_id, created_at DESC);
        """)
        columns = {row["name"] for row in db.execute("PRAGMA table_info(conversation_messages)")}
        if "recommendation_json" not in columns:
            db.execute("ALTER TABLE conversation_messages ADD COLUMN recommendation_json TEXT")


def has_consent(db: sqlite3.Connection, user_id: int) -> bool:
    return db.execute("SELECT 1 FROM mindcare_consent WHERE user_id=?", (user_id,)).fetchone() is not None


def checkins(db: sqlite3.Connection, user_id: int, limit: int = 14) -> list[dict[str, Any]]:
    rows = db.execute("SELECT * FROM wellbeing_checkins WHERE user_id=? ORDER BY checkin_date DESC LIMIT ?", (user_id, limit)).fetchall()
    return [dict(row) for row in reversed(rows)]


def latest_prediction(db: sqlite3.Connection, user_id: int) -> dict[str, Any] | None:
    row = db.execute("SELECT * FROM cnn_predictions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1", (user_id,)).fetchone()
    if not row:
        return None
    import json
    result = dict(row)
    result["probabilities"] = json.loads(result.pop("probabilities_json"))
    return result


def latest_recommendation(db: sqlite3.Connection, user_id: int) -> dict[str, Any] | None:
    row = db.execute("SELECT * FROM drl_recommendations WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1", (user_id,)).fetchone()
    return dict(row) if row else None
