"use client";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import {
  trackPromptSubmitted,
  trackComparisonComplete,
  trackAttemptLimitReached,
  trackModalOpened,
} from "./lib/posthog";

type Section = "prompt" | "compare" | "analysis";

type Insights = {
  claude: string; openai: string; gemini: string;
  bestFor: string;
  claudeApproach: string; openaiApproach: string; geminiApproach: string;
  claudeRelevance: number; openaiRelevance: number; geminiRelevance: number;
  claudeFaithfulness: number; openaiFaithfulness: number; geminiFaithfulness: number;
  claudeSafety: number; openaiSafety: number; geminiSafety: number;
};

const TASK_CATEGORIES = [
  {
    id: "write",
    label: "Write",
    placeholder: "What do you need to communicate, and to whom? E.g. 'Reply to an enterprise client whose AI project is 3 weeks delayed — they have an exec review next Friday' or 'Pitch moving our team to Claude API to our CTO' or 'Announce a reorg to my team of 12'",
    systemContext: "You are a professional communication expert. Help the user craft whatever they need to communicate — this could be an email, message, announcement, pitch, memo, or any other format. Follow the user's lead on format and context.",
  },
  {
    id: "analyze",
    label: "Analyze",
    placeholder: "What situation, market, or decision do you want to understand better? E.g. 'Compare Anthropic vs OpenAI for enterprise API customers' or 'Assess risks of adopting a third-party LLM API in a HIPAA environment' or 'Summarize this pilot result for our CTO'",
    systemContext: "You are a senior strategy and analysis expert. Analyze whatever situation, market, document, or decision the user presents. Structure your thinking clearly and surface the insights that actually matter. Follow the user's lead on scope and depth.",
  },
  {
    id: "decide",
    label: "Decide",
    placeholder: "What are you weighing up? E.g. 'Should we standardize on one AI model or run Claude and GPT in parallel?' or 'I have two job offers — help me think through the tradeoffs' or 'Should we delay our product launch by 6 weeks?'",
    systemContext: "You are a trusted advisor helping someone think through a decision. Lay out the real tradeoffs, surface what they might be missing, and help them reach a confident conclusion. Follow the user's lead on the decision they're facing — personal or professional.",
  },
];

// ─── "How it works" step definitions ─────────────────────────────────────────
// Defined outside the component so the array isn't re-created on every render.
const HOW_IT_WORKS_STEPS = [
  {
    title: "You enter a prompt",
    desc: "Choose Write, Analyze, or Decide. Type what you need — up to 600 characters. The same prompt goes to every model so you're comparing apples to apples.",
    color: "#f5f5f7",
  },
  {
    title: "Safety screening",
    desc: "Before any paid model runs, your prompt passes through OpenAI's free moderation API. Flagged content is blocked before a single token is spent.",
    color: "#f5a623",
  },
  {
    title: "Sent to 3 models simultaneously",
    desc: "Your prompt reaches Anthropic, OpenAI, and Google's APIs at the exact same moment — not sequentially. The timing differences you see are real.",
    color: "#6ab4f5",
  },
  {
    title: "Models respond independently",
    desc: "Claude Sonnet 4.6, GPT-5.4, and Gemini 3.1 Pro each craft their response in isolation — they have no visibility into what the others are producing.",
    color: "#63d68d",
  },
  {
    title: "Claude Haiku scores all three",
    desc: "A fast Claude Haiku pass evaluates every response on three dimensions (0–100 each). Relevance: did it actually answer your question? Faithfulness: are the claims grounded, or made up? Safety: is it appropriate for professional use?",
    color: "#ff9f6b",
  },
  {
    title: "Results in Compare & Analyze",
    desc: "Compare shows responses side by side. Analyze breaks down timing, token usage, eval scores, approach descriptors, and an honest verdict on which model suited your prompt best.",
    color: "#a78bfa",
  },
];

const MODELS = [
  { key: "claude", label: "Claude Sonnet 4.6", maker: "Anthropic", dot: "#ff9f6b" },
  { key: "openai", label: "GPT-5.4",           maker: "OpenAI",    dot: "#63d68d" },
  { key: "gemini", label: "Gemini 3.1 Pro",    maker: "Google",    dot: "#6ab4f5" },
];

// Removed num field; renamed ANALYSIS → ANALYZE
const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "prompt",   label: "PROMPT"  },
  { id: "compare",  label: "COMPARE" },
  { id: "analysis", label: "ANALYZE" },
];

// ─── Attempt tracking (daily, resets at midnight UTC) ────────────────────────
// The server is the authoritative source (Vercel KV); localStorage is the UX
// layer that shows the gate immediately without a round-trip on page load.
// After each successful API call the server returns `attemptsLeft` which is
// used to keep localStorage in sync.

const FREE_LIMIT  = 10;         // must match DAILY_LIMIT in app/lib/rateLimit.ts
const STORAGE_KEY = "fp_daily"; // { date: "YYYY-MM-DD", count: number }

interface DailyRecord { date: string; count: number; }

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10); // "2026-04-01"
}

function getDaily(): DailyRecord {
  if (typeof window === "undefined") return { date: todayUTC(), count: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { date: todayUTC(), count: 0 };
    const parsed = JSON.parse(raw) as DailyRecord;
    // Different date = new day, reset counter
    if (parsed.date !== todayUTC()) return { date: todayUTC(), count: 0 };
    return parsed;
  } catch { return { date: todayUTC(), count: 0 }; }
}

function getAttempts() { return getDaily().count; }

function setAttemptCount(n: number) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayUTC(), count: n }));
}

function incrementAttempts() {
  const next = getAttempts() + 1;
  setAttemptCount(next);
  return next;
}

// ─── Browser fingerprint ──────────────────────────────────────────────────────
// Lightweight deterministic hash of browser/device characteristics.
// Survives incognito reopens on the same device because the canvas hash and
// screen properties don't change across sessions.  Sent as X-FP request header
// so the server can enforce the daily limit per-device, not just per-IP.
function buildFingerprint(): string {
  try {
    const parts: string[] = [
      navigator.userAgent.slice(0, 80),
      `${screen.width}x${screen.height}`,
      String(screen.colorDepth),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      String(navigator.hardwareConcurrency ?? 0),
    ];
    try {
      // Canvas fingerprint — varies by GPU/driver/OS rendering pipeline
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.font = "14px Arial";
        ctx.fillText("FP\u{1F52C}", 2, 14);
        parts.push(c.toDataURL().slice(-32));
      }
    } catch { /* canvas blocked */ }
    // FNV-1a 32-bit hash — fast, good distribution
    const str = parts.join("|");
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  } catch { return "unknown"; }
}
function stripMarkdown(t: string) {
  return t.replace(/#{1,6}\s+/g,"").replace(/\*\*(.+?)\*\*/g,"$1").replace(/\*(.+?)\*/g,"$1")
    .replace(/^[-*]\s+/gm,"• ").replace(/^(\d+)\.\s+/gm,"$1. ")
    .replace(/\|.+\|/g,"").replace(/---/g,"").replace(/\n{3,}/g,"\n\n").trim();
}
function estReadTime(outputTokens: number): string {
  if (!outputTokens) return "—";
  const words = outputTokens * 0.75;
  const mins  = words / 200;
  if (mins < 1) return `~${Math.round(mins * 60)}s read`;
  return `~${Math.round(mins)}m read`;
}

export default function Home() {
  const [section,   setSection]   = useState<Section>("prompt");
  const [task,      setTask]      = useState(TASK_CATEGORIES[0]);
  const [prompt,    setPrompt]    = useState("");
  const [responses, setResponses] = useState<Record<string,string>>({});
  const [insights,  setInsights]  = useState<Insights | null>(null);
  const [timing,    setTiming]    = useState<Record<string,number>>({});
  const [usage,     setUsage]     = useState<Record<string,{input:number;output:number}>>({});
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [attempts,       setAttempts]       = useState(getAttempts());
  // Gate is true immediately if the user has already exhausted today's limit on load
  const [gated,          setGated]          = useState(() => getAttempts() >= FREE_LIMIT);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  // Track per-card scroll-to-bottom to hide fade gradient when fully scrolled
  const [atBottom,  setAtBottom]  = useState<Record<string, boolean>>({});

  const hasRes    = Object.keys(responses).length > 0;
  const submitted = hasRes || loading; // prompt is locked after Compare is hit

  const getInsight  = (key: string) => insights?.[key as keyof Insights] as string ?? "";
  const getApproach = (key: string) => insights?.[`${key}Approach` as keyof Insights] as string ?? "";

  const resetComparison = () => {
    setResponses({}); setInsights(null); setTiming({}); setUsage({}); setError(""); setAtBottom({});
  };

  const goToSection = (s: Section) => {
    setSection(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // "+ New Prompt" — clears everything and returns to the prompt input
  const newPrompt = () => {
    resetComparison();
    setPrompt("");
    goToSection("prompt");
  };

  // Track per-card scroll position to hide bottom gradient when fully scrolled
  const onCardScroll = (key: string, el: HTMLDivElement) => {
    const hit = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    setAtBottom(prev => prev[key] === hit ? prev : { ...prev, [key]: hit });
  };

  // Refs to each card's scroll container — used to detect overflow on short responses
  const cardScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // After responses render, synchronously mark non-overflowing cards as atBottom
  // useLayoutEffect fires after DOM mutations but before paint, so measurements are accurate
  useLayoutEffect(() => {
    if (!hasRes) return;
    MODELS.forEach(m => {
      const el = cardScrollRefs.current[m.key];
      if (el && el.scrollHeight <= el.clientHeight + 4) {
        setAtBottom(prev => ({ ...prev, [m.key]: true }));
      }
    });
  }, [responses]);

  const compare = async () => {
    if (!prompt.trim()) return;
    // Client-side gate: fast check before spending a round-trip
    if (getAttempts() >= FREE_LIMIT) {
      trackAttemptLimitReached(FREE_LIMIT);
      setGated(true);
      return;
    }
    trackPromptSubmitted(prompt, task.id);
    setLoading(true);
    resetComparison();
    goToSection("compare");
    try {
      const fp  = buildFingerprint();
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FP": fp, // browser fingerprint for server-side per-device enforcement
        },
        body: JSON.stringify({ prompt, systemContext: task.systemContext }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 429 = server-enforced daily limit reached (e.g. via different browser/IP)
        if (res.status === 429) { trackAttemptLimitReached(FREE_LIMIT); setGated(true); return; }
        setError(data.error || "Something went wrong.");
        return;
      }
      // Sync localStorage with the server's authoritative attempt count
      if (typeof data.attemptsLeft === "number") {
        const used = FREE_LIMIT - data.attemptsLeft;
        setAttemptCount(used);
        setAttempts(used);
      } else {
        setAttempts(incrementAttempts());
      }
      setResponses({ claude: data.claude, openai: data.openai, gemini: data.gemini });
      setInsights(data.insights  || null);
      setTiming(data.timing      || {});
      setUsage(data.usage        || {});
      // Analytics: fire after all state is set so timing data is available
      if (data.timing && data.insights) {
        trackComparisonComplete({
          claudeTime:      data.timing.claude  ?? 0,
          openaiTime:      data.timing.openai  ?? 0,
          geminiTime:      data.timing.gemini  ?? 0,
          bestRelevance:   data.insights.bestRelevanceModel   ?? "",
          bestFaithfulness:data.insights.bestFaithfulnessModel ?? "",
          bestSafety:      data.insights.bestSafetyModel      ?? "",
          taskContext:     task.id,
        });
      }
    } catch { setError("Network error — check your connection."); }
    finally   { setLoading(false); }
  };

  // ─── Shared styles ────────────────────────────────────────────────────────
  const sectionHeader = (title: string, subtitle: string) => (
    <div style={{ padding: "40px 0 28px" }}>
      <h2 style={{ fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:700, color:"#f5f5f7", letterSpacing:"-0.025em", marginBottom:6 }}>
        {title}
      </h2>
      <p style={{ fontSize:13, color:"#a1a1a6", fontFamily:"'Figtree',sans-serif" }}>{subtitle}</p>
    </div>
  );

  // Small ghost button used for navigation
  const ghostBtn = (label: string, onClick: () => void) => (
    <button onClick={onClick}
      style={{ fontSize:12, color:"#8e8e93", background:"none", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontFamily:"'Sora',sans-serif", transition:"all 0.2s ease", whiteSpace:"nowrap" }}
      onMouseEnter={e => { e.currentTarget.style.color="#f5f5f7"; e.currentTarget.style.borderColor="rgba(255,255,255,0.24)"; }}
      onMouseLeave={e => { e.currentTarget.style.color="#8e8e93"; e.currentTarget.style.borderColor="rgba(255,255,255,0.1)"; }}>
      {label}
    </button>
  );

  // Small square icon button — symbol only, title tooltip for accessibility
  const iconBtn = (symbol: string, title: string, onClick: () => void) => (
    <button onClick={onClick} title={title}
      style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#8e8e93", background:"none", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, cursor:"pointer", transition:"all 0.2s ease", flexShrink:0, lineHeight:1 }}
      onMouseEnter={e => { e.currentTarget.style.color="#f5f5f7"; e.currentTarget.style.borderColor="rgba(255,255,255,0.24)"; }}
      onMouseLeave={e => { e.currentTarget.style.color="#8e8e93"; e.currentTarget.style.borderColor="rgba(255,255,255,0.1)"; }}>
      {symbol}
    </button>
  );

  // ─── Score helpers ────────────────────────────────────────────────────────
  const scoreColor = (s: number) => s >= 80 ? "#63d68d" : s >= 55 ? "#f5a623" : "#ff6b6b";
  const scoreLabel = (s: number) => s >= 80 ? "High" : s >= 55 ? "Medium" : "Low";
  const safetyLabel = (s: number) => s >= 80 ? "Safe" : s >= 55 ? "Low Risk" : "Flagged";
  const getScore = (model: string, metric: string): number =>
    (insights as unknown as Record<string, number>)?.[`${model}${metric}`] ?? 0;

  // ─── Eval row ─────────────────────────────────────────────────────────────
  const EvalRow = ({ label, score, labelFn }: { label: string; score: number; labelFn: (s: number) => string }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
      <span style={{ fontSize:12, letterSpacing:"0.04em", color:"#b0b0b8", fontFamily:"'Figtree',sans-serif", fontWeight:500 }}>
        {label}
      </span>
      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
        <span style={{ fontSize:15, fontWeight:700, color: insights ? scoreColor(score) : "#3a3a3c", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.02em" }}>
          {insights ? score : "—"}
        </span>
        {insights && (
          <span style={{
            fontSize:10, fontWeight:600, color: scoreColor(score),
            background: `${scoreColor(score)}18`,
            border: `1px solid ${scoreColor(score)}44`,
            borderRadius:4, padding:"1px 6px",
            fontFamily:"'Sora',sans-serif", letterSpacing:"0.04em", textTransform:"uppercase",
          }}>
            {labelFn(score)}
          </span>
        )}
      </div>
    </div>
  );

  // ─── Metric tile ──────────────────────────────────────────────────────────
  const MetricTile = ({ label, value }: { label: string; value: string }) => (
    <div>
      <div style={{ fontSize:10, letterSpacing:"0.08em", color:"#8e8e93", textTransform:"uppercase", marginBottom:6, fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
        {label}
      </div>
      <div style={{ fontSize:22, fontWeight:700, color:"#f5f5f7", fontFamily:"'Sora',sans-serif", letterSpacing:"-0.03em", lineHeight:1 }}>
        {value}
      </div>
    </div>
  );

  return (
    <>
      {/* ── Floating Top Nav ── */}
      <nav className="top-nav" style={{
        position:"fixed", top:0, left:0, right:0, zIndex:100,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 32px",
        background:"rgba(0,0,0,0.80)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
        borderBottom:"1px solid rgba(255,255,255,0.07)",
      }}>
        {/* Brand — logo mark + wordmark */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="4"  cy="11" r="3.5" fill="#ff9f6b"/>
            <circle cx="11" cy="11" r="3.5" fill="#63d68d"/>
            <circle cx="18" cy="11" r="3.5" fill="#6ab4f5"/>
            <line x1="7.5"  y1="11" x2="8.5"  y2="11" stroke="#2a2a2a" strokeWidth="1.5"/>
            <line x1="13.5" y1="11" x2="14.5" y2="11" stroke="#2a2a2a" strokeWidth="1.5"/>
          </svg>
          <span style={{ fontFamily:"'Sora',sans-serif", fontSize:17, fontWeight:700, letterSpacing:"-0.03em", color:"#f5f5f7" }}>
            Frontier Pulse
          </span>
        </div>

        {/* Right side: How it works (text on desktop, ⓘ on mobile) + counter (desktop only) */}
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {/* Desktop: text ghost button */}
          <div className="nav-how-text">
            {ghostBtn("How it works", () => { trackModalOpened("how_it_works"); setShowHowItWorks(true); })}
          </div>
          {/* Mobile: borderless white ⓘ — clean, no box */}
          <div className="nav-how-icon">
            <button
              onClick={() => { trackModalOpened("how_it_works"); setShowHowItWorks(true); }}
              aria-label="How it works"
              style={{ background:"none", border:"none", cursor:"pointer", padding:"4px 2px", lineHeight:1, fontSize:19, color:"#f5f5f7" }}>
              ⓘ
            </button>
          </div>
          {/* Counter — desktop nav only; mobile version lives in the textarea footer */}
          {attempts > 0 && !gated && (
            <span className="nav-counter-desktop" style={{
              fontSize:12, fontFamily:"'Sora',sans-serif", fontWeight:500,
              color:"#c7c7cc", letterSpacing:"0.01em",
            }}>
              {attempts}/{FREE_LIMIT}
            </span>
          )}
        </div>
      </nav>

      {/* ── Left Sidebar Nav (desktop) ── */}
      <aside className="side-nav-desktop" style={{
        position:"fixed", top:56, left:0, bottom:0, width:72,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        borderRight:"1px solid rgba(255,255,255,0.06)", zIndex:50, background:"#000",
      }}>
        {NAV_ITEMS.map((item, i) => {
          const isActive    = section === item.id;
          const isAvailable = item.id === "prompt" || hasRes || loading;
          return (
            <div key={item.id} style={{ display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
              {i > 0 && (
                <div style={{
                  width:1, height:28,
                  background: isAvailable ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.04)",
                  margin:"0 auto", transition:"background 0.4s ease",
                }} />
              )}
              <button onClick={() => isAvailable && goToSection(item.id)}
                style={{
                  display:"flex", flexDirection:"column", alignItems:"center", gap:6,
                  padding:"12px 0", width:"100%",
                  background:"none", border:"none", cursor: isAvailable ? "pointer" : "default",
                  opacity: isAvailable ? 1 : 0.22, transition:"opacity 0.4s ease",
                }}>
                {/* Active indicator dot */}
                <div style={{
                  width:6, height:6, borderRadius:"50%",
                  background: isActive ? "#f5f5f7" : "rgba(255,255,255,0.3)",
                  boxShadow: isActive ? "0 0 10px rgba(245,245,247,0.6)" : "none",
                  transition:"all 0.3s ease",
                }} />
                {/* Tab label — no numbers */}
                <span style={{
                  fontSize:9, letterSpacing:"0.12em", fontFamily:"'Sora',sans-serif",
                  color: isActive ? "#f5f5f7" : "rgba(255,255,255,0.52)",
                  fontWeight: isActive ? 700 : 500, transition:"all 0.3s ease",
                }}>{item.label}</span>
              </button>
            </div>
          );
        })}
      </aside>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="side-nav-mobile">
        {NAV_ITEMS.map(item => {
          const isActive    = section === item.id;
          const isAvailable = item.id === "prompt" || hasRes || loading;
          return (
            <button key={item.id} onClick={() => isAvailable && goToSection(item.id)}
              style={{
                display:"flex", flexDirection:"column", alignItems:"center", gap:3,
                padding:"6px 20px", background:"none", border:"none",
                cursor: isAvailable ? "pointer" : "default", opacity: isAvailable ? 1 : 0.22,
              }}>
              <span style={{
                fontSize:10, letterSpacing:"0.1em", fontFamily:"'Sora',sans-serif",
                color: isActive ? "#f5f5f7" : "#a1a1a6",
                fontWeight: isActive ? 700 : 500,
              }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* ── Main ── */}
      <main className="main-content" style={{ paddingTop:56, background:"#000" }}>
        <div style={{ maxWidth:1080, margin:"0 auto", padding:"0 24px 40px", position:"relative" }}>

          {/* ── Daily limit gate ── */}
          {gated && (
            <div style={{
              background:"#1c1c1e", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20,
              padding:"52px 40px", textAlign:"center", maxWidth:440, margin:"40px auto",
            }}>
              <div style={{
                width:44, height:44, borderRadius:"50%",
                background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
                display:"flex", alignItems:"center", justifyContent:"center",
                margin:"0 auto 24px", fontSize:20,
              }}>⏳</div>
              <h2 style={{ fontFamily:"'Sora',sans-serif", fontSize:20, fontWeight:600, marginBottom:12, color:"#f5f5f7", lineHeight:1.3 }}>
                You&apos;ve reached today&apos;s testing limit
              </h2>
              <p style={{ color:"#8e8e93", fontSize:14, lineHeight:1.7, marginBottom:0 }}>
                Thanks for exploring Frontier Pulse. You&apos;ve used all {FREE_LIMIT} comparisons for today.
                <br />
                Your limit resets at <strong style={{ color:"#c7c7cc" }}>12:00 AM UTC</strong> — see you then.
              </p>
            </div>
          )}

          {/* ── Sections container ── */}
          {!gated && (
            <div style={{ position:"relative", overflow:"hidden" }}>

              {/* ════════════════════════════════════
                  SECTION 1 — PROMPT
              ════════════════════════════════════ */}
              <div className={`section-transition ${section === "prompt" ? "section-visible" : "section-hidden"}`}>

                <section className="anim-hero anim-delay-1" style={{ textAlign:"center", padding:"52px 24px 40px", maxWidth:680, margin:"0 auto" }}>
                  <h1 style={{ fontFamily:"'Sora',sans-serif", fontSize:"clamp(22px,2.8vw,36px)", fontWeight:700, letterSpacing:"-0.03em", lineHeight:1.1, color:"#f5f5f7", marginBottom:10 }}>
                    Same prompt. Three minds.
                  </h1>
                  {/* Model names — brighter */}
                  <p style={{ fontSize:"clamp(11px,3.2vw,14px)", color:"#c7c7cc", fontFamily:"'Sora',sans-serif", letterSpacing:"0.02em", whiteSpace:"nowrap" }}>
                    Claude Sonnet 4.6 &nbsp;·&nbsp; GPT-5.4 &nbsp;·&nbsp; Gemini 3.1 Pro
                  </p>
                </section>

                {/* Task chips — size controlled by globals.css .task-chip */}
                <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4, marginBottom:32, scrollbarWidth:"none" }}>
                  {TASK_CATEGORIES.map(t => (
                    <button key={t.id} className={`task-chip${task.id === t.id ? " active" : ""}`}
                      onClick={() => { setTask(t); setPrompt(""); resetComparison(); }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* New Prompt button — appears above input once a compare has been run */}
                {submitted && (
                  <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
                    {iconBtn("+", "New Prompt", newPrompt)}
                  </div>
                )}

                {/* Input box */}
                <div style={{
                  background:"#1c1c1e", borderRadius:20,
                  border:"1px solid rgba(255,255,255,0.08)", overflow:"hidden",
                  marginBottom:12, transition:"border 0.2s ease",
                  opacity: submitted ? 0.75 : 1,
                }}>
                  <textarea
                    value={prompt}
                    readOnly={submitted}
                    onChange={e => !submitted && setPrompt(e.target.value.slice(0, 600))}
                    placeholder={task.placeholder}
                    rows={5}
                    onKeyDown={e => { if (!submitted && e.key === "Enter" && (e.metaKey || e.ctrlKey)) compare(); }}
                    style={{
                      width:"100%", padding:"20px 22px 12px",
                      background:"transparent", border:"none", outline:"none",
                      color:"#f5f5f7", fontSize:15, fontFamily:"'Figtree',sans-serif",
                      lineHeight:1.65, resize:"none", fontWeight:400,
                      cursor: submitted ? "default" : "text",
                      overflowY:"auto", scrollbarWidth:"thin",
                      scrollbarColor:"rgba(255,255,255,0.18) transparent",
                    }}
                  />
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"0 16px 16px 22px" }}>
                    {/* Desktop: keyboard shortcut hint */}
                    <span className="keyboard-hint" style={{ fontSize:11, color:"#8e8e93", fontFamily:"'Sora',sans-serif" }}>
                      {submitted ? "Running comparison…" : "⌘ Return to compare"}
                    </span>
                    {/* Mobile: attempt counter lives here — contextually near Compare */}
                    {!submitted && attempts > 0 && !gated && (
                      <span className="input-counter-mobile" style={{ fontSize:11, fontFamily:"'Sora',sans-serif", fontWeight:500, color:"#8e8e93" }}>
                        Attempt {attempts}/{FREE_LIMIT}
                      </span>
                    )}
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      {/* Char counter — brighter default */}
                      {!submitted && (
                        <span style={{
                          fontSize:11, fontFamily:"'Sora',sans-serif",
                          color: prompt.length >= 580 ? "#ff6b6b" : prompt.length >= 450 ? "#f5a623" : "#8e8e93",
                          transition:"color 0.2s",
                        }}>
                          {prompt.length} / 600
                        </span>
                      )}
                      {!submitted && (
                        <button className="compare-btn" onClick={compare} disabled={loading || !prompt.trim()}
                          style={{ width:"auto", padding:"10px 22px", fontSize:14 }}>
                          {loading ? "Comparing…" : "Compare →"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {error && <p style={{ fontSize:13, color:"#ff6b6b", marginBottom:16 }}>{error}</p>}
                {/* Disclaimer — brighter */}
                <p style={{ fontSize:11, color:"#8e8e93", marginBottom:40, fontFamily:"'Sora',sans-serif", letterSpacing:"0.01em" }}>
                  Sent to Anthropic, OpenAI &amp; Google APIs. Do not include personal or confidential information.
                </p>
              </div>

              {/* ════════════════════════════════════
                  SECTION 2 — LIVE COMPARISON
              ════════════════════════════════════ */}
              <div className={`section-transition ${section === "compare" ? "section-visible" : "section-hidden"}`}>
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                  {sectionHeader("Live Comparison", prompt.length > 90 ? `"${prompt.slice(0, 90)}…"` : `"${prompt}"`)}
                  {/* Two navigation icon buttons */}
                  <div style={{ display:"flex", gap:8, paddingTop:40 }}>
                    {iconBtn("↵", "Current Prompt", () => goToSection("prompt"))}
                    {iconBtn("+", "New Prompt", newPrompt)}
                  </div>
                </div>

                {/* Response cards */}
                {(loading || hasRes) && (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))", gap:16 }}>
                    {MODELS.map((m, i) => (
                      <div key={m.key} className={`model-card${responses[m.key] ? " has-response" : ""}`} style={{
                        animationDelay:`${i * 0.1}s`,
                        boxShadow:`inset 0 2px 0 ${m.dot}88`,
                        background:`linear-gradient(170deg, ${m.dot}0f 0%, var(--surface) 32%)`,
                      }}>

                        {/* Card header */}
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:7, height:7, borderRadius:"50%", background:m.dot, flexShrink:0, marginTop:2, boxShadow:`0 0 8px ${m.dot}88` }} />
                            <div>
                              <div style={{ fontFamily:"'Sora',sans-serif", fontSize:14, fontWeight:600, color:"#f5f5f7", lineHeight:1.2 }}>{m.label}</div>
                              {/* Maker name — brighter */}
                              <div style={{ fontSize:11, color:"#a1a1a6", marginTop:2 }}>{m.maker}</div>
                            </div>
                          </div>
                          {responses[m.key] && (
                            <button
                              onClick={() => navigator.clipboard.writeText(stripMarkdown(responses[m.key]))}
                              style={{ fontSize:11, color:"#a1a1a6", background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontFamily:"'Sora',sans-serif", transition:"all 0.15s" }}
                              onMouseEnter={e => { e.currentTarget.style.color="#f5f5f7"; e.currentTarget.style.background="rgba(255,255,255,0.14)"; }}
                              onMouseLeave={e => { e.currentTarget.style.color="#a1a1a6"; e.currentTarget.style.background="rgba(255,255,255,0.08)"; }}>
                              Copy
                            </button>
                          )}
                        </div>

                        {/* Loading skeleton */}
                        {loading && !responses[m.key] ? (
                          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:4 }}>
                              {[0,1,2].map(j => (
                                <div key={j} style={{ width:4, height:4, borderRadius:"50%", background:m.dot, animation:"dotBlink 1.2s ease infinite", animationDelay:`${j * 0.2}s` }} />
                              ))}
                            </div>
                            {[100,82,91,74,88].map((w,j) => (
                              <div key={j} className="skel" style={{ width:`${w}%`, animationDelay:`${j * 0.08}s` }} />
                            ))}
                          </div>
                        ) : (
                          <div style={{ position:"relative" }}>
                            <div
                              ref={el => { cardScrollRefs.current[m.key] = el; }}
                              style={{ maxHeight:400, overflowY:"auto", scrollbarWidth:"thin", scrollbarColor:"rgba(255,255,255,0.12) transparent" }}
                              onScroll={e => onCardScroll(m.key, e.currentTarget as HTMLDivElement)}
                            >
                              <div className="prose-apple">
                                <ReactMarkdown>{responses[m.key] || ""}</ReactMarkdown>
                              </div>
                            </div>
                            {/* Fade gradient — hidden when scrolled to bottom */}
                            {responses[m.key] && !atBottom[m.key] && (
                              <div style={{ position:"absolute", bottom:0, left:0, right:0, height:48, background:"linear-gradient(to bottom, transparent, #1c1c1e)", pointerEvents:"none", borderRadius:"0 0 4px 4px" }} />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* CTA to analysis — renamed */}
                {hasRes && !loading && (
                  <div style={{ textAlign:"center", marginTop:44 }}>
                    <button onClick={() => goToSection("analysis")}
                      style={{ background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:980, padding:"11px 32px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'Sora',sans-serif", color:"#f5f5f7", letterSpacing:"0.01em", transition:"all 0.25s ease" }}
                      onMouseEnter={e => { e.currentTarget.style.background="rgba(255,255,255,0.1)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.22)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background="rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.1)"; }}>
                      View Model Response Metrics &amp; Analysis →
                    </button>
                  </div>
                )}
              </div>

              {/* ════════════════════════════════════
                  SECTION 3 — MODEL RESPONSE METRICS & ANALYSIS
              ════════════════════════════════════ */}
              <div className={`section-transition ${section === "analysis" ? "section-visible" : "section-hidden"}`}>
                <div style={{ position:"relative" }}>
                  {sectionHeader("Model Response Metrics & Analysis", "Telemetry and honest model review — generated from this specific comparison")}
                  <div style={{ position:"absolute", top:44, right:0 }}>
                    {iconBtn("↵", "Back to responses", () => goToSection("compare"))}
                  </div>
                </div>

                {hasRes ? (
                  <div className="anim-hero anim-delay-1">

                    {/* ── The Verdict (hero) ── */}
                    <div style={{
                      marginBottom:32, padding:"24px 28px",
                      background:"rgba(255,255,255,0.05)",
                      border:"2px solid rgba(255,255,255,0.22)",
                      borderRadius:16,
                      boxShadow:"0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.1)",
                    }}>
                      <div style={{ fontSize:11, letterSpacing:"0.12em", color:"#a1a1a6", textTransform:"uppercase", fontFamily:"'Sora',sans-serif", fontWeight:600, marginBottom:12 }}>
                        The Verdict
                      </div>
                      <p style={{ fontSize:15, color: insights ? "#e8e8ed" : "#3a3a3c", lineHeight:1.8, fontFamily:"'Figtree',sans-serif", fontWeight:400 }}>
                        {insights?.bestFor || "Analysing responses…"}
                      </p>
                    </div>

                    {/* ── Telemetry cards ── */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))", gap:16, marginBottom:28 }}>
                      {MODELS.map(m => (
                        <div key={m.key} style={{
                          background:`linear-gradient(170deg, ${m.dot}0f 0%, #1c1c1e 32%)`,
                          border:"1px solid rgba(255,255,255,0.09)",
                          boxShadow:`inset 0 2px 0 ${m.dot}77`,
                          borderRadius:16,
                          padding:"22px 24px",
                        }}>

                          {/* Model header — bigger name, brighter maker */}
                          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
                            <div style={{ width:8, height:8, borderRadius:"50%", background:m.dot, boxShadow:`0 0 8px ${m.dot}88` }} />
                            <span style={{ fontSize:15, fontWeight:700, color:"#f5f5f7", fontFamily:"'Sora',sans-serif" }}>{m.label}</span>
                            <span style={{ fontSize:11, color:"#a1a1a6", fontFamily:"'Figtree',sans-serif" }}>· {m.maker}</span>
                          </div>

                          {/* 4-up metrics grid */}
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"18px 24px", marginBottom:22 }}>
                            <MetricTile label="Response Time" value={timing[m.key] ? `${(timing[m.key] / 1000).toFixed(1)}s` : "—"} />
                            <MetricTile label="Output Tokens" value={usage[m.key]?.output ? String(usage[m.key].output) : "—"} />
                            <MetricTile label="Est. Read"     value={estReadTime(usage[m.key]?.output ?? 0)} />
                            <MetricTile label="Input Tokens"  value={usage[m.key]?.input ? String(usage[m.key].input) : "—"} />
                          </div>

                          {/* Eval scores */}
                          <div style={{ borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:16, marginBottom:18 }}>
                            <div style={{ fontSize:11, letterSpacing:"0.08em", color:"#b0b0b8", textTransform:"uppercase", marginBottom:10, fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
                              Eval Scores
                            </div>
                            <EvalRow label="Relevance"    score={getScore(m.key, "Relevance")}    labelFn={scoreLabel}  />
                            <EvalRow label="Faithfulness" score={getScore(m.key, "Faithfulness")} labelFn={scoreLabel}  />
                            <EvalRow label="Safety"       score={getScore(m.key, "Safety")}       labelFn={safetyLabel} />
                          </div>

                          {/* Approach */}
                          <div style={{ borderTop:"1px solid rgba(255,255,255,0.08)", paddingTop:16 }}>
                            <div style={{ fontSize:11, letterSpacing:"0.08em", color:"#b0b0b8", textTransform:"uppercase", marginBottom:8, fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
                              Approach
                            </div>
                            <p style={{ fontSize:13, color: insights ? "#c7c7cc" : "#3a3a3c", fontFamily:"'Figtree',sans-serif", lineHeight:1.65 }}>
                              {getApproach(m.key) || "Analysing…"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* ── Model Output Summary ── */}
                    <div style={{ marginBottom:28 }}>
                      <div style={{ fontSize:14, letterSpacing:"-0.01em", color:"#c7c7cc", fontFamily:"'Sora',sans-serif", fontWeight:600, paddingBottom:14 }}>
                        Model Output Summary
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))", gap:16 }}>
                        {MODELS.map(m => (
                          <div key={m.key} style={{ padding:"18px 20px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", boxShadow:`inset 0 2px 0 ${m.dot}44`, borderRadius:14 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:10 }}>
                              <div style={{ width:6, height:6, borderRadius:"50%", background:m.dot, flexShrink:0, boxShadow:`0 0 6px ${m.dot}88` }} />
                              <span style={{ fontSize:12, color:m.dot, fontFamily:"'Sora',sans-serif", letterSpacing:"0.04em", fontWeight:600 }}>
                                {m.label}
                              </span>
                            </div>
                            <p style={{ fontSize:14, color: insights ? "#c7c7cc" : "#3a3a3c", lineHeight:1.72, fontFamily:"'Figtree',sans-serif" }}>
                              {getInsight(m.key) || "Analysing response…"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* ── Metric legend — static (no collapse) ── */}
                    <div style={{ border:"1px solid rgba(255,255,255,0.08)", borderRadius:14, overflow:"hidden" }}>
                      <div style={{ padding:"14px 20px", background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
                        <span style={{ fontSize:13, color:"#c7c7cc", fontWeight:600, fontFamily:"'Sora',sans-serif" }}>
                          What do these metrics mean?
                        </span>
                      </div>
                      <div style={{ padding:"20px 24px 24px", background:"rgba(255,255,255,0.01)" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:"18px 36px" }}>
                          {[
                            { name:"Response Time",  def:"How long the model took to generate its full answer from the moment you hit Compare." },
                            { name:"Output Tokens",  def:"The number of text chunks in the response. Roughly 1 token ≈ ¾ of a word." },
                            { name:"Est. Read",      def:"Estimated time to read the response at an average pace of 200 words per minute." },
                            { name:"Input Tokens",   def:"The size of everything sent to the model — your prompt plus the task instructions." },
                            { name:"Relevance",      def:"How directly and completely the response addresses your specific question. Low = generic or off-topic." },
                            { name:"Faithfulness",   def:"How grounded the claims are in verifiable facts. Low = possible hallucinated details or unsupported statistics." },
                            { name:"Safety",         def:"How appropriate the response is for professional use. 100 = fully neutral and brand-safe." },
                            { name:"Approach",       def:"A structural descriptor of how the model chose to format and present its answer." },
                          ].map(({ name, def }) => (
                            <div key={name} style={{ display:"flex", flexDirection:"column", gap:5 }}>
                              <span style={{ fontSize:12, fontWeight:700, color:"#c7c7cc", fontFamily:"'Sora',sans-serif", letterSpacing:"0.02em" }}>{name}</span>
                              <span style={{ fontSize:12, color:"#8e8e93", fontFamily:"'Figtree',sans-serif", lineHeight:1.65 }}>{def}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                  </div>
                ) : (
                  /* Empty state */
                  <div style={{ textAlign:"center", padding:"60px 0", color:"#3a3a3c" }}>
                    <div style={{ fontSize:11, fontFamily:"'Sora',sans-serif", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:16 }}>
                      Run a comparison first
                    </div>
                    <button onClick={() => goToSection("prompt")}
                      style={{ fontSize:12, color:"#8e8e93", background:"none", border:"none", cursor:"pointer", fontFamily:"'Figtree',sans-serif", textDecoration:"underline" }}>
                      Go to prompt →
                    </button>
                  </div>
                )}
              </div>

            </div>
          )}

        </div>
      </main>

      {/* ── "How it works" modal ── */}
      {showHowItWorks && (
        // Backdrop doubles as the flex centering container — avoids fixed-inside-transform bugs
        <div
          onClick={() => setShowHowItWorks(false)}
          style={{
            position:"fixed", inset:0, zIndex:200,
            background:"rgba(0,0,0,0.80)",
            backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)",
            display:"flex", alignItems:"center", justifyContent:"center",
            padding:"20px",
            animation:"fadeIn 0.2s ease both",
          }}
        >
          {/* Modal card — stopPropagation so clicks inside don't close */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width:"100%", maxWidth:540,
              maxHeight:"calc(100vh - 80px)",
              overflowY:"auto",
              scrollbarWidth:"thin",
              scrollbarColor:"rgba(255,255,255,0.15) transparent",
              background:"#1c1c1e",
              border:"1px solid rgba(255,255,255,0.12)",
              borderRadius:24,
              padding:"28px 30px 30px",
              animation:"fadeUp 0.3s cubic-bezier(0.22,1,0.36,1) both",
              position:"relative",
            }}
          >
            {/* Header */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
              <div>
                <h2 style={{ fontFamily:"'Sora',sans-serif", fontSize:19, fontWeight:700, color:"#f5f5f7", letterSpacing:"-0.025em", marginBottom:4 }}>
                  How Frontier Pulse works
                </h2>
                <p style={{ fontSize:12, color: hasRes ? "#63d68d" : "#6e6e73", fontFamily:"'Figtree',sans-serif" }}>
                  {hasRes ? "Showing live data from your last run" : "Run a comparison to see live data here"}
                </p>
              </div>
              {iconBtn("✕", "Close", () => setShowHowItWorks(false))}
            </div>

            {/* Steps */}
            <div style={{ display:"flex", flexDirection:"column" }}>
              {HOW_IT_WORKS_STEPS.map((step, i) => (
                <div key={i} className="hiw-step" style={{ animationDelay:`${i * 0.06}s`, display:"flex", gap:14 }}>

                  {/* Left: circle + connector line */}
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                    <div style={{
                      width:28, height:28, borderRadius:"50%", flexShrink:0,
                      background:`${step.color}16`, border:`1.5px solid ${step.color}50`,
                      display:"flex", alignItems:"center", justifyContent:"center",
                    }}>
                      <span style={{ fontSize:10, fontWeight:700, color:step.color, fontFamily:"'Sora',sans-serif" }}>{i + 1}</span>
                    </div>
                    {i < HOW_IT_WORKS_STEPS.length - 1 && (
                      <div style={{ width:1, flex:1, minHeight:16, background:"rgba(255,255,255,0.07)", margin:"4px 0" }} />
                    )}
                  </div>

                  {/* Right: content */}
                  <div style={{ paddingBottom: i < HOW_IT_WORKS_STEPS.length - 1 ? 16 : 0, paddingTop:3, minWidth:0 }}>
                    <div style={{ fontFamily:"'Sora',sans-serif", fontSize:13, fontWeight:600, color:"#f5f5f7", marginBottom:4, lineHeight:1.3 }}>
                      {step.title}
                    </div>
                    <p style={{ fontFamily:"'Figtree',sans-serif", fontSize:12, color:"#8e8e93", lineHeight:1.7, margin:0 }}>
                      {step.desc}
                    </p>

                    {/* ── Step 1: show current prompt if one exists ── */}
                    {i === 0 && prompt && (
                      <div style={{ marginTop:8, padding:"8px 12px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8 }}>
                        <span style={{ fontSize:12, color:"#c7c7cc", fontFamily:"'Figtree',sans-serif", fontStyle:"italic" }}>
                          &ldquo;{prompt.slice(0, 110)}{prompt.length > 110 ? "…" : ""}&rdquo;
                        </span>
                      </div>
                    )}

                    {/* ── Step 3: model chips ── */}
                    {i === 2 && (
                      <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>
                        {MODELS.map(m => (
                          <div key={m.key} style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 10px", background:`${m.dot}12`, border:`1px solid ${m.dot}30`, borderRadius:100 }}>
                            <div style={{ width:5, height:5, borderRadius:"50%", background:m.dot, flexShrink:0 }} />
                            <span style={{ fontSize:11, color:m.dot, fontFamily:"'Sora',sans-serif", fontWeight:600, whiteSpace:"nowrap" }}>{m.label}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Step 4: live response times ── */}
                    {i === 3 && hasRes && Object.keys(timing).length > 0 && (
                      <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
                        {MODELS.map(m => (
                          <div key={m.key} style={{ padding:"6px 12px", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:8, textAlign:"center" }}>
                            <div style={{ fontSize:10, color:"#6e6e73", fontFamily:"'Sora',sans-serif", marginBottom:3 }}>{m.label}</div>
                            <div style={{ fontSize:14, color: m.dot, fontFamily:"'Sora',sans-serif", fontWeight:700 }}>
                              {timing[m.key] ? `${(timing[m.key]/1000).toFixed(1)}s` : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ── Step 5: live eval scores ── */}
                    {i === 4 && insights && insights.claudeRelevance > 0 && (
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:10 }}>
                        {MODELS.map(m => (
                          <div key={m.key} style={{ padding:"8px 10px", background:`${m.dot}0c`, border:`1px solid ${m.dot}25`, borderRadius:10 }}>
                            <div style={{ fontSize:10, color:m.dot, fontFamily:"'Sora',sans-serif", fontWeight:700, marginBottom:6 }}>{m.label}</div>
                            {(["Relevance","Faithfulness","Safety"] as const).map(metric => (
                              <div key={metric} style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                                <span style={{ fontSize:10, color:"#6e6e73", fontFamily:"'Figtree',sans-serif" }}>{metric.slice(0,4)}</span>
                                <span style={{ fontSize:10, color: scoreColor(getScore(m.key, metric)), fontFamily:"'Sora',sans-serif", fontWeight:600 }}>
                                  {getScore(m.key, metric) || "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div style={{ marginTop:20, padding:"12px 16px", background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:10 }}>
              <p style={{ fontSize:11, color:"#6e6e73", fontFamily:"'Figtree',sans-serif", lineHeight:1.65, margin:0 }}>
                Your prompt is never stored. Content is sent directly to Anthropic, OpenAI, and Google APIs and discarded after the response is returned.
              </p>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
