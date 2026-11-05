from __future__ import annotations

import io
import os
import tempfile
import warnings
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ["mood", "stress", "sleep_hours", "academic_workload", "study_hours", "physical_activity", "study_breaks"]
CLASSES = ["stable", "increasing_stress", "declining_mood", "improving_wellbeing"]
MODEL_PATH = Path(os.getenv("MINDCARE_CNN_PATH", ROOT / "wellbeing_cnn.pth"))
SCALER_PATH = Path(os.getenv("MINDCARE_SCALER_PATH", ROOT / "feature_scaler.pkl"))


class Wellbeing1DCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv1d(7, 32, kernel_size=3, padding=1)
        self.conv2 = nn.Conv1d(32, 64, kernel_size=3, padding=1)
        self.pool = nn.MaxPool1d(kernel_size=2)
        self.adaptive_pool = nn.AdaptiveAvgPool1d(4)
        self.fc1 = nn.Linear(256, 64)
        self.dropout = nn.Dropout(p=0.3)
        self.fc2 = nn.Linear(64, 4)

    def forward(self, x):
        x = torch.relu(self.conv1(x))
        x = self.pool(x)
        x = torch.relu(self.conv2(x))
        x = self.adaptive_pool(x).flatten(1)
        x = self.dropout(torch.relu(self.fc1(x)))
        return self.fc2(x)


class CNNService:
    def __init__(self):
        self.model: Wellbeing1DCNN | None = None
        self.scaler: StandardScaler | None = None
        self.error: str | None = None
        try:
            import joblib
            self.scaler = joblib.load(SCALER_PATH)
            if list(self.scaler.mean_.shape) != [7]:
                raise ValueError("Expected a seven-feature scaler")
            state: dict[str, Any]
            if MODEL_PATH.is_dir():
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_STORED) as archive:
                    for file in MODEL_PATH.rglob("*"):
                        if file.is_file():
                            archive.write(file, file.relative_to(MODEL_PATH).as_posix())
                buffer.seek(0)
                checkpoint = torch.load(buffer, map_location="cpu", weights_only=False)
            else:
                checkpoint = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
            if checkpoint.get("feature_columns") != FEATURES:
                raise ValueError("The checkpoint feature order does not match the integration schema")
            self.model = Wellbeing1DCNN()
            self.model.load_state_dict(checkpoint["model_state_dict"], strict=True)
            self.model.eval()
        except Exception as exc:
            self.error = str(exc)
            self.model = None

    @property
    def available(self) -> bool:
        return self.model is not None and self.scaler is not None

    def predict(self, rows: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not self.available or len(rows) < 7:
            return None
        sequence = np.asarray([[float(row[name]) for name in FEATURES] for row in rows[-14:]], dtype=np.float64)
        # The original training scaler was fitted to flattened daily observations.
        scaled = self.scaler.transform(sequence).astype(np.float32)
        tensor = torch.from_numpy(scaled.T[None, :, :])
        with torch.inference_mode():
            probs = torch.softmax(self.model(tensor), dim=1)[0].cpu().numpy()
        index = int(np.argmax(probs))
        return {"trend": CLASSES[index], "confidence": float(probs[index]), "probabilities": {name: float(probs[i]) for i, name in enumerate(CLASSES)}, "model_version": "Wellbeing1DCNN-best-epoch-22"}


cnn_service = CNNService()
