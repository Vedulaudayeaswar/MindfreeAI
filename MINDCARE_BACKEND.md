# SASTRA MindCare AI local integration

The existing Pixel/Luna chat and ZenMode UI use a shared Python service and the existing account SQLite database. Both companions share student check-ins, CNN observations, the DQN recommendation policy, Ollama, and persistent conversation history. Companion selection changes the response tone and TTS voice only.

## Run locally

Install Python dependencies once:

```powershell
python -m pip install -r backend/requirements.txt
```

Train the shared recommendation policy from simulated profiles only (the included trained checkpoint is already available):

```powershell
npm run train:drl
```

Run the Next.js app and the Python API in separate terminals:

```powershell
npm run dev
npm run backend
```

The app proxies `/api/mindcare/*` requests to `http://127.0.0.1:8000`. Ollama defaults to `http://127.0.0.1:11434/api/chat` and `llama3.2:latest` (the installed 3.2B Q4_K_M model); set `OLLAMA_URL` and `OLLAMA_MODEL` in `.env.local` to change these. See [README.md](README.md) for full setup, architecture, current model flows, API routes, and data/privacy details.

## Shared chat history

Conversation threads and full message transcripts are stored in the existing SQLite database (`data/accounts.sqlite` by default), under the authenticated user's account. Pixel and Luna messages remain in the same thread when the student switches companions. The `/history` page lists threads, displays full transcripts, and provides per-thread and delete-all actions. Deleting a conversation deletes its message rows via SQLite foreign-key cascade. These records are not held in Redis or an in-memory cache. Standard account deletion cascades to conversation records as well.

## Services and data

- **Chat:** `/chat` retrieves the last 16 persisted turns from the selected thread, shared structured student context, recent CNN result, and optional recommendation before calling Ollama. Serious distress messages take the shared safety path ahead of recommendation generation.
- **CNN:** the supplied `wellbeing_cnn.pth` and `feature_scaler.pkl` are loaded unchanged. Check-ins use the checkpoint's feature order: mood, stress, sleep hours, academic workload, study hours, physical activity, and study breaks. Inference uses up to 14 chronological check-ins after at least 7 exist. Outputs are patterns in self-reported data, not diagnoses.
- **Check-ins:** `/checkin` is voluntary. Saving opts the user in; revoking consent removes check-ins, CNN predictions, recommendations, activity feedback, completed ZenMode sessions, and generated report files. It does not delete conversations; use History to delete chat threads.
- **DRL:** `backend/models/mindcare_dqn.pt` is a shared DQN trained on simulated profiles, not student data. Recommendations are optional; declining is recorded neutrally.
- **ZenMode:** recommendations open the existing exercise/audio presets. Completed ZenMode timers create session records only with check-in consent; elapsed session totals are based on completed timers, not time merely spent on the page.
- **Dashboard/reports:** `/dashboard` returns charts built from actual saved check-ins and existing CNN/recommendation/feedback records. The dashboard generates A4 weekly, monthly, and custom-range PDFs through `/api/reports/generate`; `/api/reports/history` lists the authenticated student's saved reports and `/api/reports/{id}/download` enforces report ownership. PDFs include the signed-in student's name, consented check-ins, explicitly reported numeric chat indicators, CNN probabilities, DQN recommendations, completed ZenMode sessions, feedback, previous-period comparisons, and an Ollama summary when the local model can run. Fallback suggestions are explicitly labelled. Raw chat transcripts are not copied into reports. Report files are private and report history is removed when consent is revoked.
- **Voice:** Pixel uses the male local Piper ONNX model and Luna uses the female local Piper ONNX model. Override paths in `.env.local` with `MINDCARE_PIXEL_VOICE_PATH` and `MINDCARE_LUNA_VOICE_PATH` for compatible Piper ONNX voice models. The browser microphone uses browser speech recognition and fills the chat composer; audio is sent when the student presses Send. The bundled HFC voice models have a CC BY-NC-SA 4.0 dataset license; retain attribution and review that license before commercial use. Your own trained models must be compatible with Piper's ONNX voice format or be converted to that format.
- **Safety:** The shared response offers SASTRA SWAS at 04362-350023 / deanswas@sastra.edu and India emergency number 112. The text matcher is a basic safeguard, not a clinical risk detector; CNN and DQN do not make crisis decisions.

## Main API endpoints

`/health`, `/chat`, `/conversations`, `/conversations/{id}`, `/checkins`, `/recommendations`, `/activity-feedback`, `/consent`, `/dashboard`, `/api/reports/generate`, `/api/reports/history`, `/api/reports/{report_id}/download`, `/zen-session`, `/report?period=weekly|monthly`, and `/tts/{pixel|luna}`. Student endpoints validate the existing `uday_session` cookie against the SQLite `sessions` table and enforce thread ownership.

## Limitations

The supplied CNN report describes synthetic training sequences; high validation scores do not establish real-world efficacy. The DRL policy is also evaluated only in a synthetic simulator. The Ollama service must be running locally with a model that fits available memory. The bundled Piper voices are convenient defaults and may be replaced with the user's own compatible models.
