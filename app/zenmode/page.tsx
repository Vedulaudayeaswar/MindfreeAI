"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AudioLines, ArrowLeft, ArrowRight, Check, Clock3, CloudRain, Headphones, Heart, Leaf, Pause, Play, RotateCcw, SkipBack, SkipForward, Sparkles, Waves, Wind } from "lucide-react";

type Category = "Breathing" | "Mindfulness" | "Relaxation" | "Visualization" | "Quick Sessions";
type Exercise = { id: string; category: Category; name: string; minutes: number; focus: string; level: "Easy" | "Medium" | "Advanced"; steps: string[] };

const exercises: Exercise[] = [
  { id: "478", category: "Breathing", name: "4-7-8 Breathing", minutes: 5, focus: "Deep Relaxation", level: "Easy", steps: ["Breathe in quietly through your nose for 4 counts", "Hold your breath gently for 7 counts", "Exhale completely through your mouth for 8 counts", "Repeat the cycle with a soft focus on your breath"] },
  { id: "box", category: "Breathing", name: "Box Breathing", minutes: 5, focus: "Focus & Calm", level: "Medium", steps: ["Breathe in through your nose for 4 counts", "Hold gently for 4 counts", "Breathe out slowly for 4 counts", "Pause for 4 counts, then repeat"] },
  { id: "triangle", category: "Breathing", name: "Triangle Breathing", minutes: 6, focus: "Balance", level: "Easy", steps: ["Breathe in slowly for 4 counts", "Hold gently for 4 counts", "Breathe out for 6 counts", "Pause comfortably for 2 counts, then repeat"] },
  { id: "awareness", category: "Mindfulness", name: "Mindful Awareness", minutes: 10, focus: "Present Moment", level: "Medium", steps: ["Settle into a comfortable position", "Notice the feeling of your feet on the floor", "Name one sound, one sensation, and one breath", "Let your attention return gently whenever it wanders"] },
  { id: "kindness", category: "Mindfulness", name: "Loving Kindness", minutes: 12, focus: "Compassion", level: "Easy", steps: ["Bring to mind a place where you feel at ease", "Silently offer yourself a kind wish", "Extend that wish to someone you care about", "Close by noticing how the words feel"] },
  { id: "walking", category: "Mindfulness", name: "Walking Meditation", minutes: 15, focus: "Movement", level: "Medium", steps: ["Choose a safe, comfortable walking path", "Notice your feet as they meet the ground", "Let your breath find a natural rhythm", "When your mind wanders, return to the next step"] },
  { id: "body-scan", category: "Relaxation", name: "Body Scan", minutes: 15, focus: "Deep Relaxation", level: "Easy", steps: ["Get comfortable and soften your gaze", "Bring attention to your feet and legs", "Gently notice your torso, shoulders, and hands", "Finish by sensing your whole body at rest"] },
  { id: "muscle", category: "Relaxation", name: "Muscle Relaxation", minutes: 20, focus: "Tension Release", level: "Medium", steps: ["Notice where your body is holding tension", "Gently tense your hands, then release them", "Repeat with shoulders, jaw, and legs if comfortable", "Finish with a few easy, unforced breaths"] },
  { id: "nidra", category: "Relaxation", name: "Yoga Nidra", minutes: 25, focus: "Deep Rest", level: "Advanced", steps: ["Lie down somewhere comfortable and safe", "Notice the support beneath your body", "Move your attention slowly from one area to another", "Rest quietly and return gently when you are ready"] },
  { id: "peaceful", category: "Visualization", name: "Peaceful Place", minutes: 12, focus: "Inner Sanctuary", level: "Easy", steps: ["Imagine a place where you feel comfortable", "Notice its colors, light, and shapes", "Imagine the sounds and sensations around you", "Stay for a few breaths, then return to the room"] },
  { id: "golden", category: "Visualization", name: "Golden Light", minutes: 18, focus: "Gentle Imagery", level: "Medium", steps: ["Picture a soft, warm light in your mind", "Imagine it surrounding you like a gentle glow", "Let the image remind you to slow down", "Release the image and notice the room around you"] },
  { id: "chakra", category: "Visualization", name: "Chakra Journey", minutes: 30, focus: "Guided Imagery", level: "Advanced", steps: ["Settle in and follow a slow, comfortable breath", "Picture a calm color moving through your body", "Pause at each area only for as long as feels right", "End by noticing your surroundings and your feet"] },
  { id: "quick-calm", category: "Quick Sessions", name: "Quick Calm", minutes: 2, focus: "A Short Reset", level: "Easy", steps: ["Pause and let your shoulders drop", "Take one slow breath in", "Breathe out a little longer than you breathed in", "Notice one small thing that feels steady"] },
  { id: "stress-release", category: "Quick Sessions", name: "Stress Release", minutes: 3, focus: "Tension Release", level: "Easy", steps: ["Notice how you are feeling, without judging it", "Unclench your jaw and relax your hands", "Take three gentle, unhurried breaths", "Choose one manageable next step"] },
  { id: "time-plan", category: "Quick Sessions", name: "Study Time Plan", minutes: 10, focus: "One manageable next step", level: "Easy", steps: ["Write down the tasks you want to handle", "Choose the next deadline or smallest useful step", "Break that task into one short study block", "Add a brief break and adjust the plan to fit your day"] },
];

const categoryIcons: Record<Category, typeof Wind> = { Breathing: Wind, Mindfulness: Sparkles, Relaxation: Heart, Visualization: Sparkles, "Quick Sessions": Clock3 };
const durationOptions = [2, 5, 10, 15, 20, 30];
const ratios = [
  { value: "4-4-4-4", label: "4-4-4-4 (Box)", names: ["Breathe in", "Hold", "Breathe out", "Pause"] },
  { value: "4-7-8", label: "4-7-8 (Relaxing)", names: ["Breathe in", "Hold", "Breathe out"] },
  { value: "6-6-6-6", label: "6-6-6-6 (Deep)", names: ["Breathe in", "Hold", "Breathe out", "Pause"] },
  { value: "4-4-6-2", label: "4-4-6-2 (Triangle)", names: ["Breathe in", "Hold", "Breathe out", "Pause"] },
];
const soundOptions = [
  { id: "nature", label: "Nature", icon: Leaf, src: "/audio/nature.m4a" },
  { id: "rain", label: "Rain", icon: CloudRain, src: "/audio/rain.m4a" },
  { id: "ocean", label: "Ocean", icon: Waves, src: "/audio/ocean.m4a" },
  { id: "forest", label: "Forest", icon: Wind, src: "/audio/forest.m4a" },
] as const;

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export default function ZenModePage() {
  const [selectedId, setSelectedId] = useState("478");
  const selected = exercises.find((exercise) => exercise.id === selectedId) ?? exercises[0];
  const [minutes, setMinutes] = useState(selected.minutes);
  const [secondsLeft, setSecondsLeft] = useState(selected.minutes * 60);
  const [ratio, setRatio] = useState("4-7-8");
  const [stepIndex, setStepIndex] = useState(0);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [phaseElapsed, setPhaseElapsed] = useState(0);
  const [breaths, setBreaths] = useState(0);
  const [running, setRunning] = useState(false);
  const [soundId, setSoundId] = useState<string | null>(null);
  const [volume, setVolume] = useState(50);
  const [recommendationId, setRecommendationId] = useState<number | null>(null);
  const [recommendedActivity, setRecommendedActivity] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const completionLogged = useRef(false);

  const activeRatio = ratios.find((item) => item.value === ratio) ?? ratios[1];
  const isBreathing = selected.category === "Breathing";
  const phaseDurations = useMemo(() => ratio.split("-").map(Number), [ratio]);
  const guideSteps = isBreathing
    ? phaseDurations.map((count, index) => `${activeRatio.names[index] ?? "Breathe"} ${index === 0 ? "gently " : ""}${activeRatio.names[index] === "Breathe out" ? "for" : "for"} ${count} counts${index === 0 ? " through your nose" : index === 2 ? " through your mouth" : ""}`)
    : selected.steps;
  const currentStep = guideSteps[Math.min(stepIndex, guideSteps.length - 1)];
  const breathPhase = activeRatio.names[phaseIndex] ?? "Breathe";
  const audioOption = soundOptions.find((option) => option.id === soundId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const exercise = params.get("exercise");
    const sound = params.get("sound");
    const recommendation = Number(params.get("recommendation"));
    const activityId = params.get("activity_id") ?? "";
    if (exercise && exercises.some((item) => item.id === exercise)) selectExercise(exercises.find((item) => item.id === exercise)!);
    if (sound && soundOptions.some((item) => item.id === sound)) setSoundId(sound);
    if (Number.isFinite(recommendation) && recommendation > 0) setRecommendationId(recommendation);
    setRecommendedActivity(activityId);
    // Deep links select an existing exercise/audio preset and keep the active chat on the server session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          setRunning(false);
          return 0;
        }
        return current - 1;
      });
      if (isBreathing) {
        setPhaseElapsed((current) => {
          const currentLength = phaseDurations[phaseIndex] ?? 4;
          if (current + 1 >= currentLength) {
            const nextPhase = (phaseIndex + 1) % phaseDurations.length;
            setPhaseIndex(nextPhase);
            setStepIndex(nextPhase);
            if (phaseIndex === phaseDurations.length - 1) setBreaths((count) => count + 1);
            return 0;
          }
          return current + 1;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, isBreathing, phaseDurations, phaseIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    if (secondsLeft !== 0 || completionLogged.current) return;
    completionLogged.current = true;
    void fetch("/api/mindcare/zen-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activity_id: selected.id, activity_name: selected.name, category: selected.category, duration_minutes: minutes, sound_id: soundId, recommendation_id: recommendationId }) }).catch(() => undefined);
  }, [secondsLeft, selected.id, selected.name, selected.category, minutes, soundId, recommendationId]);


  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioOption) {
      audio.pause();
      audio.removeAttribute("src");
      return;
    }
    audio.pause();
    audio.src = audioOption.src;
    audio.loop = true;
    audio.load();
  }, [audioOption]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioOption) return;
    if (running) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [running, audioOption]);

  function selectExercise(exercise: Exercise) {
    setRunning(false);
    completionLogged.current = false;
    setSelectedId(exercise.id);
    setMinutes(exercise.minutes);
    setSecondsLeft(exercise.minutes * 60);
    setStepIndex(0);
    setPhaseIndex(0);
    setPhaseElapsed(0);
    setBreaths(0);
    if (exercise.id === "box") setRatio("4-4-4-4");
    if (exercise.id === "478") setRatio("4-7-8");
    if (exercise.id === "triangle") setRatio("4-4-6-2");
  }

  function changeDuration(value: number) {
    setMinutes(value);
    setSecondsLeft(value * 60);
    setRunning(false);
    setBreaths(0);
    setPhaseIndex(0);
    setPhaseElapsed(0);
  }

  function resetSession() {
    completionLogged.current = false;
    setRunning(false);
    setSecondsLeft(minutes * 60);
    setBreaths(0);
    setStepIndex(0);
    setPhaseIndex(0);
    setPhaseElapsed(0);
  }

  function toggleTimer() {
    if (secondsLeft === 0) { resetSession(); return; }
    if (!running && secondsLeft === minutes * 60) completionLogged.current = false;
    setRunning(!running);
  }

  async function sendActivityFeedback(outcome: "completed_helpful" | "completed_neutral" | "completed_unhelpful") {
    if (!recommendationId || !recommendedActivity) return;
    try {
      const response = await fetch("/api/mindcare/activity-feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recommendation_id: recommendationId, activity: recommendedActivity, outcome }) });
      const data = await response.json();
      setFeedbackMessage(response.ok ? "Thank you. Your feedback is saved with your consent." : data.detail || "Feedback could not be saved.");
    } catch { setFeedbackMessage("Feedback could not be saved right now."); }
  }

  function changeStep(direction: -1 | 1) {
    const next = Math.min(guideSteps.length - 1, Math.max(0, stepIndex + direction));
    setStepIndex(next);
    if (isBreathing) {
      setPhaseIndex(next);
      setPhaseElapsed(0);
    }
  }

  const status = secondsLeft === 0 ? "Session complete — well done" : running ? (isBreathing ? `${breathPhase}…` : "Take your time…") : secondsLeft < minutes * 60 ? "Paused when you need it" : "Ready to begin…";

  return (
    <main className="zen-page">
      <header className="zen-header">
        <a href="/" className="zen-brand"><span>SASTRA</span><small>MINDCARE AI</small></a>
        <nav className="zen-nav" aria-label="MindCare navigation"><a href="/">Home</a><a href="/chat">AI Companion</a><a href="/zenmode" aria-current="page">ZenMode</a></nav>
        <a href="/chat" className="zen-back-link"><ArrowLeft size={16} /> Back to chat</a>
      </header>

      <div className="zen-heading"><div><span className="zen-eyebrow">A MINDFUL PAUSE FOR SASTRA STUDENTS</span><h1>ZenMode</h1><p>Find your center and breathe through the stress.</p></div><div className="zen-badge"><Headphones size={17} /> Your pace, your practice</div></div>

      <div className="zen-layout">
        <aside className="zen-sidebar" aria-label="ZenMode exercises and audio settings">
          <section className="zen-audio-card">
            <div className="zen-card-title"><AudioLines size={17} /><h2>Audio settings</h2></div>
            <div className="zen-audio-meta"><span>Nature sound</span><b>{audioOption?.label ?? "Off"}</b></div>
            <label className="zen-volume"><span>Volume</span><span>{volume}%</span><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Audio volume" style={{ "--volume": `${volume}%` } as React.CSSProperties} /></label>
            <div className="zen-sound-label">NATURE SOUNDS</div>
            <div className="zen-sound-options">{soundOptions.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={soundId === id ? "active" : ""} onClick={() => setSoundId(soundId === id ? null : id)} aria-pressed={soundId === id}><Icon size={15} /><span>{label}</span></button>)}</div>
            <audio ref={audioRef} preload="none" />
          </section>
          <div className="zen-exercise-heading"><div className="zen-card-title"><Activity size={17} /><h2>Exercises</h2></div><span>{exercises.length} practices</span></div>
          <div className="zen-exercise-list">{(Object.keys(categoryIcons) as Category[]).map((category) => {
            const Icon = categoryIcons[category];
            return <section className="zen-category" key={category}><h3><Icon size={14} />{category}</h3>{exercises.filter((exercise) => exercise.category === category).map((exercise) => <button type="button" className={`zen-exercise ${selectedId === exercise.id ? "selected" : ""}`} key={exercise.id} onClick={() => selectExercise(exercise)} aria-pressed={selectedId === exercise.id}><span className="zen-exercise-icon"><Icon size={17} /></span><span className="zen-exercise-copy"><b>{exercise.name}</b><small>{exercise.minutes} minutes · {exercise.focus}</small><em className={exercise.level.toLowerCase()}>{exercise.level}</em></span><ArrowRight size={15} className="zen-exercise-arrow" /></button>)}</section>;
          })}</div>
        </aside>

        <section className="zen-session" aria-label="Guided session">
          <div className="zen-session-top">
            <div className="zen-selected-meta"><span>{selected.category.toUpperCase()} / {selected.level.toUpperCase()}</span><h2>{selected.name}</h2><p>{selected.focus} · a gentle, non-clinical practice</p></div>
            <div className={`zen-timer-orbit ${running && isBreathing ? `phase-${phaseIndex}` : ""}`}><div className="zen-timer-core"><span className="zen-time">{timeLabel(secondsLeft)}</span><b>{status}</b><small>Breaths: {breaths}</small></div></div>
          </div>

          <article className="zen-guide-card">
            <div className="zen-guide-head"><div><span className="zen-eyebrow">YOUR GUIDED PRACTICE</span><h3>{isBreathing ? `${ratio} Technique` : selected.name}</h3></div><span className="zen-guide-duration"><Clock3 size={15} />{minutes} min</span></div>
            <div className={`zen-phase-display ${isBreathing ? `phase-${phaseIndex}` : ""} ${running ? "active" : ""}`}><span className="zen-phase-number">{String(stepIndex + 1).padStart(2, "0")}</span><p>{currentStep}</p><span className="zen-step-count">{stepIndex + 1} / {guideSteps.length}</span></div>
            <div className="zen-step-list">{guideSteps.map((step, index) => <div key={`${index}-${step}`} className={`zen-step ${stepIndex === index ? "current" : ""} ${stepIndex > index ? "complete" : ""}`}><span>{stepIndex > index ? <Check size={15} /> : index + 1}</span><p>{step}</p></div>)}</div>
            <div className="zen-controls"><button type="button" onClick={() => changeStep(-1)} disabled={stepIndex === 0}><SkipBack size={16} />Previous</button><button type="button" className="zen-start" onClick={toggleTimer}>{running ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}{secondsLeft === 0 ? "Begin again" : running ? "Pause" : secondsLeft < minutes * 60 ? "Resume" : "Start"}</button><button type="button" onClick={() => changeStep(1)} disabled={stepIndex === guideSteps.length - 1}>Next<SkipForward size={16} /></button><button type="button" className="zen-reset" onClick={resetSession}><RotateCcw size={15} />Reset</button></div>
          </article>

          {secondsLeft === 0 && recommendationId && <section className="zen-feedback-card"><b>How did this activity feel for you?</b><span>Your feedback is optional. Declining an activity is never treated as a negative outcome.</span><div><button type="button" onClick={() => sendActivityFeedback("completed_helpful")}>Helpful</button><button type="button" onClick={() => sendActivityFeedback("completed_neutral")}>Neutral</button><button type="button" onClick={() => sendActivityFeedback("completed_unhelpful")}>Not helpful</button></div>{feedbackMessage && <small role="status">{feedbackMessage}</small>}</section>}

          <section className="zen-preferences" aria-label="Session preferences">
            <label><span>Duration</span><select value={minutes} onChange={(event) => changeDuration(Number(event.target.value))}>{durationOptions.map((option) => <option key={option} value={option}>{option} min</option>)}</select></label>
            <label><span>Breathing ratio</span><select value={ratio} onChange={(event) => { setRatio(event.target.value); setStepIndex(0); setPhaseIndex(0); setPhaseElapsed(0); }}>{ratios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <div className="zen-preference-note"><span>Selected audio</span><b>{audioOption ? `${audioOption.label} sounds · ${volume}%` : "Quiet practice"}</b></div>
          </section>
          <p className="zen-wellbeing-note"><Heart size={14} />Choose what feels comfortable. You can pause, change activities, or stop at any time. ZenMode offers general well-being practices, not clinical care.</p>
        </section>
      </div>
    </main>
  );
}
