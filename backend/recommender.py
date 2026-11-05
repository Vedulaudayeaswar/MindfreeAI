from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = Path(__file__).resolve().parent / "models" / "mindcare_dqn.pt"
ACTIVITIES = [
    {"id":"guided_breathing","title":"Guided breathing","minutes":5,"exercise":"478","sound":None},
    {"id":"forest_serenity","title":"Forest Serenity","minutes":5,"exercise":"peaceful","sound":"forest"},
    {"id":"rainfall_relaxation","title":"Rainfall Relaxation","minutes":5,"exercise":"body-scan","sound":"rain"},
    {"id":"ocean_breathing","title":"Ocean Breathing","minutes":5,"exercise":"478","sound":"ocean"},
    {"id":"mountain_breeze","title":"Mountain Breeze","minutes":5,"exercise":"awareness","sound":"nature"},
    {"id":"mindfulness_meditation","title":"Mindfulness meditation","minutes":10,"exercise":"awareness","sound":None},
    {"id":"study_break","title":"Study break","minutes":3,"exercise":"quick-calm","sound":None},
    {"id":"time_management","title":"Time-management activity","minutes":10,"exercise":"time-plan","sound":None},
    {"id":"sleep_routine","title":"Sleep routine suggestions","minutes":5,"exercise":"nidra","sound":None},
    {"id":"campus_support","title":"Campus human-support information","minutes":0,"exercise":None,"sound":None},
]
TREND_NAMES = ["stable", "increasing_stress", "declining_mood", "improving_wellbeing", "unknown"]
FEATURES = ["mood", "stress", "sleep_hours", "academic_workload", "study_hours", "physical_activity", "study_breaks"]


class QNetwork(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers = nn.Sequential(nn.Linear(32, 64), nn.ReLU(), nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 10))
    def forward(self, x): return self.layers(x)


class Recommender:
    def __init__(self):
        self.network = QNetwork()
        self.available = False
        self.error = None
        try:
            payload = torch.load(POLICY_PATH, map_location="cpu", weights_only=True)
            self.network.load_state_dict(payload["state_dict"])
            self.network.eval()
            self.available = True
        except Exception as exc:
            self.error = str(exc)

    def state(self, row, trend, feedback, preferences, scaler):
        values = np.asarray([[float(row[key]) for key in FEATURES]], dtype=float)
        normalized = np.clip(scaler.transform(values)[0], -3, 3) / 3
        trend_vec = np.zeros(5, dtype=np.float32)
        trend_vec[TREND_NAMES.index(trend) if trend in TREND_NAMES else 4] = 1
        feedback_vec = np.zeros(10, dtype=np.float32)
        for entry in feedback[-10:]:
            try:
                idx = next(i for i, item in enumerate(ACTIVITIES) if item["id"] == entry["activity"])
                if entry["outcome"] == "completed_helpful": feedback_vec[idx] = 1
                elif entry["outcome"] == "completed_unhelpful": feedback_vec[idx] = -1
            except (StopIteration, KeyError):
                pass
        preference_vec = np.array([1.0 if item["id"] in preferences else 0.0 for item in ACTIVITIES], dtype=np.float32)
        return np.concatenate([normalized.astype(np.float32), trend_vec, feedback_vec, preference_vec])

    def recommend(self, row, trend, feedback, preferences, scaler):
        if not self.available:
            return None
        state = torch.from_numpy(self.state(row, trend, feedback, preferences, scaler)[None, :])
        with torch.inference_mode():
            values = self.network(state)[0].numpy()
        # A previously helpful activity gets a modest preference bonus; a declined action is neutral.
        for index, activity in enumerate(ACTIVITIES):
            if activity["id"] in preferences: values[index] += 0.3
            if any(f.get("activity") == activity["id"] and f.get("outcome") == "completed_helpful" for f in feedback[-10:]): values[index] += 0.25
        index = int(np.argmax(values))
        item = ACTIVITIES[index]
        return {**item, "reason": "An optional activity selected from your latest consented check-in and activity preferences.", "source": "simulated_dqn"}


recommender = Recommender()
