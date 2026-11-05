"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LogOut, Menu, Search, X } from "lucide-react";
import { Bodies, Body, Engine, World, type Body as MatterBody, type Engine as MatterEngine } from "matter-js";

const services = [
  { id: "check-in", title: "Daily Well-being Check-In", type: "health" },
  { id: "trends", title: "Mood & Stress Trends", type: "design" },
  { id: "breaks", title: "Personalized Study Breaks", type: "managed" },
  { id: "mindfulness", title: "Mindfulness & Relaxation", type: "seo" },
  { id: "balance", title: "Time & Study-Life Balance", type: "placeholder" },
  { id: "campus-support", title: "Campus Support Pathways", type: "placeholder" }
] as const;

function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > window.innerHeight - 120);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    fetch("/api/auth/me").then((response) => response.ok ? response.json() : null)
      .then((result) => setLoggedIn(Boolean(result?.user))).catch(() => setLoggedIn(false));
  }, []);
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setLoggedIn(false);
  };
  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <a className="brand" href="#top" aria-label="SASTRA MindCare AI home"><span>MINDCARE</span><small>SASTRA AI</small></a>
      <nav className={`site-nav ${open ? "open" : ""}`} aria-label="Main navigation">
        <a className="active" href="#top" onClick={() => setOpen(false)}>Home</a>
        <a href="#about" onClick={() => setOpen(false)}>About</a>
        <a href="#services" onClick={() => setOpen(false)}>Activities</a>
        <a href="/zenmode" onClick={() => setOpen(false)}>ZenMode</a>
        <a href="#faq" onClick={() => setOpen(false)}>FAQs</a>
      </nav>
      {loggedIn
        ? <button className="header-cta" type="button" onClick={logout}><span className="mini-avatar"><LogOut size={15} /></span><span>Log out</span></button>
        : <a className="header-cta" href="/login"><span className="mini-avatar">✦</span><span>Student login</span><i className="status-dot" /></a>}
      <button className="menu-toggle" type="button" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
        {open ? <X size={19} /> : <Menu size={20} />}
      </button>
    </header>
  );
}

function Hero() {
  return <main className="hero" id="top">
    <div className="hero-grid" aria-hidden="true" /><div className="shape shape-one" aria-hidden="true" /><div className="shape shape-two" aria-hidden="true" />
    <section className="hero-content" aria-labelledby="hero-title">
      <div className="copy"><p className="eyebrow">SASTRA DEEMED UNIVERSITY / STUDENT WELL-BEING</p><h1 id="hero-title">CARE FOR YOUR<br /><span>WELL-BEING</span></h1><svg className="underline" viewBox="0 0 620 30" aria-hidden="true"><path d="M8 17 C 150 7, 300 25, 612 14" /></svg><p className="intro">SASTRA MindCare AI offers a private space for voluntary check-ins, practical ways to manage academic stress, and gentle support for a healthier study-life balance.</p><div className="actions"><a className="button button-primary" href="#services">Explore support <span>↗</span></a></div></div>
      <div className="visual"><div className="visual-panel" aria-hidden="true" /><div className="bot-wrap"><img src="/robo.png?v=F69185E" alt="Friendly robot representing the MindCare AI assistant" /></div><div className="note"><span>A little support<br />for your study journey</span><svg viewBox="0 0 180 90" aria-hidden="true"><path d="M8 12 C 34 75, 99 84, 155 60" /><path d="M139 47 L158 60 L140 72" /></svg></div></div>
    </section><div className="scroll-cue" aria-hidden="true">TAKE A BREATH & EXPLORE <span>↓</span></div>
  </main>;
}

function ProblemSection() {
  const problems = ["Exams and deadlines are piling up", "It feels hard to switch off after studying", "Sleep and daily routines are becoming irregular", "There is too much to do and not enough time", "Stress is making it harder to focus", "You are unsure where to find support on campus"];
  return <section className="problem-section" id="about" aria-labelledby="problem-title"><div className="problem-copy"><h2 id="problem-title"><span>UNDER</span> <b>PRESSURE?</b></h2><p>Academic pressure, exams, and changing routines can feel overwhelming. Small, manageable steps and the right support can help you find a steadier rhythm.</p><span className="highlight">You don’t have to figure it out alone.</span></div><div className="checklist" aria-label="Common student stressors"><div className="checklist-strip" /><div className="checklist-rows">{problems.map((problem) => <div className="check-row" key={problem}><i aria-hidden="true">×</i><span>{problem}</span></div>)}</div></div></section>;
}

function Illustration({ type }: { type: (typeof services)[number]["type"] }) {
  if (type === "health") return <div className="illustration health-art"><span className="pill pill-a"><Check size={14} />Daily check-in</span><span className="pill pill-b">Mood: finding my rhythm</span><span className="pill pill-c">Sleep: 7 hours</span><span className="pill pill-d">Time for a short break</span></div>;
  if (type === "design") return <div className="illustration design-art"><div className="browser"><div className="browser-top"><i /><i /><i /></div><div className="browser-nav"><b /><span /><span /><span /></div><div className="browser-copy"><b /><span /><em /></div><div className="browser-features"><i /><i /><i /></div></div></div>;
  if (type === "managed") return <div className="illustration managed-art"><div className="calendar"><i className="ring ring-one" /><i className="ring ring-two" /><b>YOUR STUDY PLAN</b><small>M &nbsp; T &nbsp; W &nbsp; T &nbsp; F &nbsp; S &nbsp; S</small><span>1 &nbsp; 2 &nbsp; <strong>3</strong> &nbsp; 4 &nbsp; 5 &nbsp; 6 &nbsp; 7<br />8 &nbsp; 9 &nbsp; 10 &nbsp; <strong>11</strong> &nbsp; 12 &nbsp; 13 &nbsp; 14<br />15 &nbsp; 16 &nbsp; 17 &nbsp; <strong>18</strong> &nbsp; 19 &nbsp; 20 &nbsp; 21<br />22 &nbsp; 23 &nbsp; 24 &nbsp; 25 &nbsp; <strong>27</strong> &nbsp; 28</span><em>one step at a time</em></div></div>;
  if (type === "seo") return <div className="illustration seo-art"><div className="searchbar"><Search size={13} /> student support</div><div className="result featured"><b>Try a mindful pause</b><span /><span /></div><div className="result"><b>Take a short study break</b><span /><span /></div><div className="result"><b>Connect with campus support</b><span /></div></div>;
  return <div className="illustration placeholder-art"><div /><div /><div /></div>;
}

function ServiceCard({ service }: { service: typeof services[number] }) { return <article className="service-card"><Illustration type={service.type} /><h3>{service.title}</h3></article>; }

function ServicesSection() {
  const rail = useRef<HTMLDivElement>(null); const [canPrev, setCanPrev] = useState(false); const [canNext, setCanNext] = useState(true);
  const update = () => { const el = rail.current; if (!el) return; setCanPrev(el.scrollLeft > 4); setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4); };
  const move = (direction: number) => { const el = rail.current; if (!el) return; el.scrollBy({ left: direction * (el.clientWidth * .84), behavior: "smooth" }); };
  useEffect(() => { update(); const el = rail.current; el?.addEventListener("scroll", update, { passive: true }); window.addEventListener("resize", update); return () => { el?.removeEventListener("scroll", update); window.removeEventListener("resize", update); }; }, []);
  return <section className="services-section" id="services" aria-labelledby="services-title"><div className="services-intro"><div><span className="highlight">small steps, at your pace</span><h2 id="services-title"><span>SUPPORT</span> <b>THAT FITS</b></h2><p>Explore gentle ways to check in with yourself, notice patterns, and find helpful next steps. Suggestions can include study breaks, relaxation, time planning, and connecting with campus support.</p></div><div className="carousel-controls"><button type="button" aria-label="Previous support activities" disabled={!canPrev} onClick={() => move(-1)}><ArrowLeft size={20} /></button><button type="button" aria-label="Next support activities" disabled={!canNext} onClick={() => move(1)}><ArrowRight size={20} /></button></div></div><div className="services-viewport"><div className="services-rail" ref={rail} tabIndex={0}>{services.map((service) => <ServiceCard service={service} key={service.id} />)}</div></div></section>;
}

const fallingServices = ["Mood check-ins", "Study breaks", "Mindfulness", "Sleep patterns", "Time planning", "Stress trends", "Daily activity", "Study-life balance", "Self-care ideas", "Campus support"] as const;

function EverythingYouNeedSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<Array<HTMLDivElement | null>>([]);
  const startedRef = useRef(false);
  const engineRef = useRef<MatterEngine | null>(null);
  const bodiesRef = useRef<MatterBody[]>([]);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    if (!section || !stage) return;

    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const engine = Engine.create({ enableSleeping: true });
      engine.gravity.y = reducedMotion ? 0 : 1.05;
      engineRef.current = engine;
      const floor = Bodies.rectangle(width / 2, height + 15, width + 120, 30, { isStatic: true, friction: 0.9, restitution: 0.1 });
      const leftWall = Bodies.rectangle(-15, height / 2, 30, height + 200, { isStatic: true });
      const rightWall = Bodies.rectangle(width + 15, height / 2, 30, height + 200, { isStatic: true });
      const bodies = blockRefs.current.map((element, index) => {
        const w = element?.offsetWidth ?? 180;
        const h = element?.offsetHeight ?? 58;
        const x = Math.max(w / 2 + 8, Math.min(width - w / 2 - 8, 35 + ((index * 137) % Math.max(80, width - w - 70))));
        const y = reducedMotion ? height - 55 - (index % 3) * (h + 8) : -80 - index * 30;
        return Bodies.rectangle(x, y, w, h, { restitution: 0.22, friction: 0.62, frictionAir: 0.018, density: 0.0015, angle: reducedMotion ? ((index % 3) - 1) * 0.06 : (index % 5 - 2) * 0.08 });
      });
      bodiesRef.current = bodies;
      World.add(engine.world, [floor, leftWall, rightWall, ...bodies]);

      const sync = () => {
        bodies.forEach((body, index) => {
          const element = blockRefs.current[index];
          if (element) element.style.transform = `translate3d(${body.position.x - element.offsetWidth / 2}px, ${body.position.y - element.offsetHeight / 2}px, 0) rotate(${body.angle}rad)`;
        });
      };
      if (reducedMotion) {
        bodies.forEach((body, index) => Body.setPosition(body, { x: body.position.x, y: height - 55 - (index % 3) * 62 }));
        sync();
        return;
      }
      let last = performance.now();
      const tick = (now: number) => { const delta = Math.min(16.667, Math.max(1, now - last)); last = now; Engine.update(engine, delta); sync(); frameRef.current = requestAnimationFrame(tick); };
      frameRef.current = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) start(); }, { threshold: 0.25 });
    observer.observe(section);
    const resize = () => {
      const engine = engineRef.current;
      if (!engine || !stageRef.current) return;
      const width = stageRef.current.clientWidth;
      const height = stageRef.current.clientHeight;
      const statics = engine.world.bodies.filter((body) => body.isStatic);
      if (statics[0]) Body.setPosition(statics[0], { x: width / 2, y: height + 15 });
      if (statics[1]) Body.setPosition(statics[1], { x: -15, y: height / 2 });
      if (statics[2]) Body.setPosition(statics[2], { x: width + 15, y: height / 2 });
    };
    window.addEventListener("resize", resize);
    return () => { observer.disconnect(); window.removeEventListener("resize", resize); if (frameRef.current) cancelAnimationFrame(frameRef.current); if (engineRef.current) World.clear(engineRef.current.world, false); engineRef.current = null; bodiesRef.current = []; };
  }, []);

  return <section className="everything-section" ref={sectionRef} aria-labelledby="everything-title"><div className="everything-copy"><h2 id="everything-title">A LITTLE SUPPORT<br />CAN GO A LONG WAY</h2><p>Notice what affects your well-being, try a small supportive activity, and reflect on how it felt. MindCare AI offers non-clinical guidance while keeping qualified people at the heart of serious support.</p><span className="highlight">take it one step at a time</span></div><div className="physics-stage" ref={stageRef} aria-label="Student well-being check-in topics and support activities">{fallingServices.map((service, index) => <div className="falling-block" key={service} ref={(element) => { blockRefs.current[index] = element; }}>{service}</div>)}<div className="physics-floor" aria-hidden="true" /></div></section>;
}

const faqs = [
  ["what-is-mindcare", "What is SASTRA MindCare AI?", "It is a student well-being support concept for voluntary check-ins, practical stress-management activities, and pathways to qualified human support. It is designed for everyday, non-clinical support."],
  ["daily-checkin", "What can I include in a daily check-in?", "You may choose to share indicators such as mood, perceived stress, sleep, academic workload, study patterns, and daily activity. Check-ins are voluntary."],
  ["diagnosis", "Can MindCare AI diagnose a mental health condition?", "No. It is not a diagnostic tool and does not make clinical decisions. It can help reflect on self-reported patterns and suggest general well-being activities."],
  ["trends", "How are mood and stress trends used?", "A 1D CNN can examine sequences of self-reported indicators to notice changes over time. Those patterns are for non-clinical support only and are not a diagnosis."],
  ["recommendations", "How are activities recommended?", "A Deep Reinforcement Learning agent can be developed using simulated student profiles and feedback to personalize suggestions such as breaks, relaxation, mindfulness, and time planning."],
  ["assistant", "What can the conversational assistant help with?", "A locally deployed Ollama language model can offer empathetic conversation, academic stress-management ideas, and self-care suggestions. It should avoid diagnosis and treatment advice."],
  ["privacy", "How does the platform approach privacy?", "The design is intended to keep conversations with the local language model on the deployed system and use only voluntarily shared, non-clinical indicators. Students should be told clearly how any data is stored and used."],
  ["optional", "Do I have to complete check-ins or follow suggestions?", "No. Sharing information and trying suggested activities are optional. You can choose what feels useful for you."],
  ["serious-distress", "What if I am in serious distress?", "Please contact a qualified counsellor, campus student-support professional, or another trusted person directly. MindCare AI is not an emergency service and should not be relied on for urgent help."],
  ["human-support", "Can the AI replace a counsellor?", "No. The platform is intended to complement human support, not replace qualified professionals. Serious concerns should be directed to people who can provide appropriate care."],
  ["feedback", "Does my feedback change future suggestions?", "In the proposed system, feedback can help the recommendation agent learn which supportive activities feel relevant. Evaluation can compare these adaptive suggestions with fixed-rule recommendations."],
  ["progress", "What does progress tracking mean here?", "It can help you review your own check-in and activity patterns over time. It is a reflection aid, not a measure of clinical recovery or a score of your mental health."],
  ["campus", "Where can I find campus support?", "Use the university’s official student-support or counselling channels to find current contacts and services. If you feel unsafe or need urgent help, contact a trusted person or local emergency services right away."]
] as const;

function FaqSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  return <section className="faq-section" id="faq" aria-labelledby="faq-title"><div className="faq-layout"><div className="faq-sticky"><h2 id="faq-title"><span>GOOD QUESTIONS,</span><b>GENTLE<br />ANSWERS</b></h2><p className="faq-contact">Need more support? <a href="#contact">Find a human support pathway</a></p><span className="highlight faq-label">your well-being matters</span></div><div className="faq-list">{faqs.map(([id, question, answer]) => { const isOpen = openId === id; const answerId = `faq-answer-${id}`; return <article className={`faq-item ${isOpen ? "open" : ""}`} key={id}><div className="faq-question"><h3>{question}</h3><button type="button" aria-expanded={isOpen} aria-controls={answerId} aria-label={`${isOpen ? "Collapse" : "Expand"} answer: ${question}`} onClick={() => setOpenId(isOpen ? null : id)}><span aria-hidden="true">+</span></button></div><div className="faq-answer" id={answerId} role="region" aria-hidden={!isOpen}><p>{answer}</p></div></article>; })}</div></div></section>;
}

const footerPages = [["Home", "#top"], ["About MindCare", "#about"], ["Well-being activities", "#services"], ["ZenMode", "/zenmode"], ["AI companion", "/chat"], ["FAQs", "#faq"], ["Student login", "/login"], ["Register", "/register"], ["Human support", "#contact"]] as const;
const footerServices = [["Daily well-being check-in", "#services"], ["Mood & stress trends", "#services"], ["Study breaks", "#services"], ["Mindfulness", "#services"], ["Time planning", "#services"], ["Study-life balance", "#services"], ["Campus support pathways", "#faq"]] as const;

function ContactCtaSection() {
  return <section className="contact-cta" aria-labelledby="contact-cta-title"><div className="contact-words" id="contact-cta-title"><span>REACH OUT</span><b>REACH OUT</b></div><a className="contact-arrow" href="#contact" aria-label="Go to student support information"><ArrowRight size={76} strokeWidth={2.2} /></a></section>;
}

function FooterColumn({ title, links }: { title: string; links: readonly (readonly [string, string])[] }) {
  return <div className="footer-column"><h3>{title}</h3>{links.map(([label, href]) => <a href={href} key={label}>{label}</a>)}</div>;
}

function SiteFooter() {
  const year = new Date().getFullYear();
  return <footer className="site-footer" id="contact"><div className="footer-panel"><div className="footer-brand"><div className="footer-wordmark"><span>SASTRA</span><b>MINDCARE <strong>AI</strong></b></div><p>A student well-being support concept for voluntary reflection, practical self-care, and connection to qualified human support.</p><div className="footer-markers" aria-hidden="true"><i /><i /><i /></div></div><FooterColumn title="EXPLORE" links={footerPages} /><FooterColumn title="SUPPORT IDEAS" links={footerServices} /><div className="footer-column"><h3>STUDENT SUPPORT</h3><span className="footer-muted">Contact qualified campus support through official university channels.</span></div><div className="footer-column"><h3>IMPORTANT</h3><span className="footer-muted">MindCare AI is non-clinical and does not replace professional care.</span></div></div><p className="copyright">© {year} SASTRA MINDCARE AI. STUDENT WELL-BEING SUPPORT.</p></footer>;
}

export default function HomePage() { return <><Header /><Hero /><ProblemSection /><ServicesSection /><EverythingYouNeedSection /><FaqSection /><ContactCtaSection /><SiteFooter /></>; }
