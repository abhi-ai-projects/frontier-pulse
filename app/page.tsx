"use client";
import { useState, useEffect, useLayoutEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";

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
    systemContext: "You are a professional communication expert. Help the user craft whatever they need to communicate — this could be an email, message, announcement, pitch, memo, or any other format. Follow the user's lead on format and context. Do not default to email unless the user specifies it.",
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

const MODELS = [
  { key: "claude", label: "Claude Sonnet 4.6", maker: "Anthropic", dot: "#ff9f6b" },
  { key: "openai", label: "GPT-5.4",           maker: "OpenAI",    dot: "#63d68d" },
  { key: "gemini", label: "Gemini 2.5 Pro",    maker: "Google",    dot: "#6ab4f5" },
];

// Removed num field; renamed ANALYSIS → ANALYZE
const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "prompt",   label: "PROMPT"  },
  { id: "compare",  label: "COMPARE" },
  { id: "analysis", label: "ANALYZE" },
];

const FREE_LIMIT  = 3;
const STORAGE_KEY = "fp_attempts";

function getAttempts() {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
}
function incrementAttempts() {
  const n = getAttempts() + 1;
  localStorage.setItem(STORAGE_KEY, String(n));
  return n;
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
  const [gated,     setGated]     = useState(false);
  const [attempts,  setAttempts]  = useState(getAttempts());
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
    if (getAttempts() >= FREE_LIMIT) { setGated(true); return; }
    setLoading(true);
    resetComparison();
    goToSection("compare");
    try {
      const res  = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, systemContext: task.systemContext }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong."); return; }
      setAttempts(incrementAttempts());
      setResponses({ claude: data.claude, openai: data.openai, gemini: data.gemini });
      setInsights(data.insights  || null);
      setTiming(data.timing      || {});
      setUsage(data.usage        || {});
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
      <nav style={{
        position:"fixed", top:0, left:0, right:0, zIndex:100,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        padding:"10px 32px",
        background:"rgba(0,0,0,0.80)", backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)",
        borderBottom:"1px solid rgba(255,255,255,0.07)",
      }}>
        {/* Brand */}
        <span style={{
          fontFamily:"'Sora',sans-serif", fontSize:22, fontWeight:800,
          letterSpacing:"-0.04em", color:"#f5f5f7",
          background:"linear-gradient(90deg, #f5f5f7 60%, rgba(255,255,255,0.55))",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent",
        }}>
          Frontier Pulse
        </span>
        {/* Attempt counter */}
        <div style={{ minWidth:110, display:"flex", justifyContent:"flex-end" }}>
          {attempts > 0 && !gated && (
            <span style={{
              fontSize:12, fontFamily:"'Sora',sans-serif", fontWeight:500,
              color: attempts >= FREE_LIMIT ? "#ff9f6b" : "#c7c7cc",
              letterSpacing:"0.01em",
            }}>
              Attempt {attempts} of {FREE_LIMIT}
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

          {/* ── Freemium Gate ── */}
          {gated && (
            <div style={{
              background:"#1c1c1e", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20,
              padding:"48px 40px", textAlign:"center", maxWidth:480, margin:"40px auto",
            }}>
              <div style={{ width:44,height:44,borderRadius:"50%",background:"rgba(0,113,227,0.15)",border:"1px solid rgba(0,113,227,0.3)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:20 }}>⊕</div>
              <h2 style={{ fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:600,marginBottom:8 }}>You've used 3 free comparisons</h2>
              <p style={{ color:"#8e8e93",fontSize:14,marginBottom:28,lineHeight:1.6 }}>Sign in with Google to keep going — no payment needed.</p>
              <button style={{ background:"#0071e3",color:"#fff",border:"none",borderRadius:980,padding:"12px 28px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Figtree',sans-serif" }}>
                Continue with Google
              </button>
              <p style={{ marginTop:14,fontSize:11,color:"#6e6e73" }}>Your content is never stored.</p>
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
                  <p style={{ fontSize:14, color:"#c7c7cc", fontFamily:"'Sora',sans-serif", letterSpacing:"0.05em" }}>
                    Claude Sonnet 4.6 &nbsp;·&nbsp; GPT-5.4 &nbsp;·&nbsp; Gemini 2.5 Pro
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
                    {/* Hint — brighter */}
                    <span style={{ fontSize:11, color:"#8e8e93", fontFamily:"'Sora',sans-serif" }}>
                      {submitted ? "Running comparison…" : "⌘ Return to compare"}
                    </span>
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
                <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
                  {sectionHeader("Model Response Metrics & Analysis", "Telemetry and honest model review — generated from this specific comparison")}
                  {iconBtn("↵", "Back to responses", () => goToSection("compare"))}
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
    </>
  );
}
