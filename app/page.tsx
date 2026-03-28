"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

type Tab = "task" | "cost" | "content";

const TASK_CATEGORIES = [
  { id: "email",    label: "Customer Email",      icon: "✦", placeholder: "E.g. 'Reply to an enterprise client whose implementation is 3 weeks delayed — they have an exec review next Friday'", systemContext: "You are a professional enterprise customer success manager. Write clear, empathetic, and actionable responses." },
  { id: "summary",  label: "Strategy Summary",    icon: "✦", placeholder: "Paste a strategy doc, meeting notes, or brief to summarize for C-suite leadership...", systemContext: "You are a management consultant. Summarize clearly for a C-suite audience. Be concise, structured, and insight-driven." },
  { id: "analysis", label: "Competitive Analysis",icon: "✦", placeholder: "E.g. 'Compare Anthropic vs OpenAI for enterprise API customers'", systemContext: "You are a senior strategy analyst. Provide structured, balanced, and evidence-based competitive analysis." },
  { id: "pitch",    label: "Executive Pitch",     icon: "✦", placeholder: "E.g. 'Pitch adopting Claude API to our CTO as a replacement for our OpenAI setup'", systemContext: "You are an expert at crafting executive-level business pitches. Be persuasive, concise, and ROI-focused." },
  { id: "risk",     label: "Risk Assessment",     icon: "✦", placeholder: "E.g. 'Risks of a healthcare company adopting a third-party LLM API for processing patient intake forms'", systemContext: "You are a risk management expert. Identify risks clearly, rate their severity, and suggest mitigations." },
];

const MODELS = [
  { key: "claude", label: "Claude",  maker: "Anthropic", desc: "Judgment-driven",    dot: "#ff9f6b" },
  { key: "openai", label: "GPT-5.4", maker: "OpenAI",    desc: "Structured & precise", dot: "#63d68d" },
  { key: "gemini", label: "Gemini",  maker: "Google",    desc: "Contextually thorough", dot: "#6ab4f5" },
];

const FREE_LIMIT = 3;
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

export default function Home() {
  const [activeTab, setActiveTab]       = useState<Tab>("task");
  const [prevTab,   setPrevTab]         = useState<Tab>("task");
  const [task,      setTask]            = useState(TASK_CATEGORIES[0]);
  const [prompt,    setPrompt]          = useState("");
  const [responses, setResponses]       = useState<Record<string,string>>({});
  const [loading,   setLoading]         = useState(false);
  const [error,     setError]           = useState("");
  const [gated,     setGated]           = useState(false);
  const [attempts,  setAttempts]        = useState(getAttempts());

  const switchTab = (t: Tab) => { setPrevTab(activeTab); setActiveTab(t); };

  const compare = async () => {
    if (!prompt.trim()) return;
    if (getAttempts() >= FREE_LIMIT) { setGated(true); return; }
    setLoading(true); setError(""); setResponses({});
    try {
      const res  = await fetch("/api/compare", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ prompt, systemContext: task.systemContext }) });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Something went wrong."); return; }
      setAttempts(incrementAttempts());
      setResponses({ claude: data.claude, openai: data.openai, gemini: data.gemini });
    } catch { setError("Network error — check your connection."); }
    finally  { setLoading(false); }
  };

  const remaining = Math.max(0, FREE_LIMIT - attempts);
  const hasRes    = Object.keys(responses).length > 0;

  return (
    <>
      {/* ── Floating Nav ── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 32px",
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}>
        <span style={{ fontFamily:"'Sora',sans-serif", fontSize:15, fontWeight:600, letterSpacing:"-0.02em", color:"#f5f5f7" }}>
          Frontier Pulse
        </span>
        <div style={{ display:"flex", gap:2, background:"rgba(255,255,255,0.05)", borderRadius:100, padding:3 }}>
          {(["task","cost","content"] as Tab[]).map(t => (
            <button key={t} className={`nav-pill${activeTab===t?" active":""}`} onClick={()=>switchTab(t)}>
              {{ task:"Task Compare", cost:"Cost Insights", content:"Your Content" }[t]}
            </button>
          ))}
        </div>
        <div style={{ width:120, display:"flex", justifyContent:"flex-end" }}>
          {attempts > 0 && !gated && (
            <span style={{ fontSize:11, color:"#6e6e73", fontFamily:"'Sora',sans-serif" }}>
              {remaining} left
            </span>
          )}
        </div>
      </nav>

      {/* ── Main ── */}
      <main style={{ paddingTop:56, minHeight:"100vh", background:"#000" }}>

        {/* ── Hero ── */}
        <section style={{ textAlign:"center", padding:"80px 24px 64px", maxWidth:680, margin:"0 auto" }}>
          <p className="anim-hero anim-delay-1" style={{ fontFamily:"'Sora',sans-serif", fontSize:11, fontWeight:500, letterSpacing:"0.14em", textTransform:"uppercase", color:"#6e6e73", marginBottom:20 }}>
            AI Model Intelligence
          </p>
          <h1 className="anim-hero anim-delay-2" style={{ fontFamily:"'Sora',sans-serif", fontSize:"clamp(44px,7vw,80px)", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.05, color:"#f5f5f7", marginBottom:20 }}>
            Compare what<br/>
            <span style={{ color:"#a1a1a6" }}>actually matters.</span>
          </h1>
          <p className="anim-hero anim-delay-3" style={{ fontSize:17, fontWeight:300, color:"#6e6e73", lineHeight:1.65, maxWidth:480, margin:"0 auto" }}>
            Claude, GPT-5.4, and Gemini. Side by side. On the work you actually do.
          </p>
        </section>

        {/* ── Content ── */}
        <div style={{ maxWidth:1080, margin:"0 auto", padding:"0 24px 100px", position:"relative" }}>

          {/* TASK TAB */}
          <div className={`section-transition ${activeTab==="task" ? "section-visible" : "section-hidden"}`}>

            {/* Gate */}
            {gated && (
              <div style={{ background:"#1c1c1e", border:"1px solid rgba(255,255,255,0.08)", borderRadius:20, padding:"48px 40px", textAlign:"center", marginBottom:40, maxWidth:480, margin:"0 auto 40px" }}>
                <div style={{ width:44,height:44,borderRadius:"50%",background:"rgba(0,113,227,0.15)",border:"1px solid rgba(0,113,227,0.3)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 20px",fontSize:20 }}>⊕</div>
                <h2 style={{ fontFamily:"'Sora',sans-serif",fontSize:20,fontWeight:600,marginBottom:8 }}>You've used 3 free comparisons</h2>
                <p style={{ color:"#6e6e73",fontSize:14,marginBottom:28,lineHeight:1.6 }}>Sign in with Google to keep going — no payment needed.</p>
                <button style={{ background:"#0071e3",color:"#fff",border:"none",borderRadius:980,padding:"12px 28px",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'Figtree',sans-serif" }}>
                  Continue with Google
                </button>
                <p style={{ marginTop:14,fontSize:11,color:"#3a3a3c" }}>Your content is never stored.</p>
              </div>
            )}

            {/* Task Chips */}
            <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:32,scrollbarWidth:"none" }}>
              {TASK_CATEGORIES.map(t => (
                <button key={t.id} className={`task-chip${task.id===t.id?" active":""}`}
                  onClick={()=>{ setTask(t); setPrompt(""); setResponses({}); setError(""); }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Input Area */}
            <div style={{ background:"#1c1c1e", borderRadius:20, border:"1px solid rgba(255,255,255,0.08)", overflow:"hidden", marginBottom:12, transition:"border 0.2s ease" }}>
              <textarea
                value={prompt}
                onChange={e=>setPrompt(e.target.value)}
                placeholder={task.placeholder}
                rows={5}
                onKeyDown={e=>{ if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)) compare(); }}
                style={{ width:"100%", padding:"20px 22px 12px", background:"transparent", border:"none", outline:"none", color:"#f5f5f7", fontSize:15, fontFamily:"'Figtree',sans-serif", lineHeight:1.65, resize:"none", fontWeight:400 }}
              />
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 16px 16px 22px" }}>
                <span style={{ fontSize:11,color:"#3a3a3c",fontFamily:"'Sora',sans-serif" }}>⌘ Return to compare</span>
                <button className="compare-btn" onClick={compare} disabled={loading||!prompt.trim()||gated}
                  style={{ width:"auto",padding:"10px 22px",fontSize:14 }}>
                  {loading ? "Comparing..." : "Compare →"}
                </button>
              </div>
            </div>

            {error && <p style={{ fontSize:13,color:"#ff6b6b",marginBottom:16 }}>{error}</p>}

            <p style={{ fontSize:11,color:"#3a3a3c",marginBottom:40,fontFamily:"'Sora',sans-serif",letterSpacing:"0.01em" }}>
              Sent to Anthropic, OpenAI &amp; Google APIs. Do not include personal or confidential information.
            </p>

            {/* Response Cards */}
            {(loading || hasRes) && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))", gap:16 }}>
                {MODELS.map((m,i)=>(
                  <div key={m.key} className={`model-card${responses[m.key]?" has-response":""}`}
                    style={{ animationDelay:`${i*0.1}s` }}>

                    {/* Card Header */}
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18 }}>
                      <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                        <div style={{ width:8,height:8,borderRadius:"50%",background:m.dot,flexShrink:0,
                          boxShadow: responses[m.key] ? `0 0 8px ${m.dot}` : "none",
                          transition:"box-shadow 0.4s ease" }} />
                        <div>
                          <div style={{ fontFamily:"'Sora',sans-serif",fontSize:14,fontWeight:600,color:"#f5f5f7",lineHeight:1.2 }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize:11,color:"#6e6e73",marginTop:2 }}>{m.maker} · {m.desc}</div>
                        </div>
                      </div>
                      {responses[m.key] && (
                        <button onClick={()=>navigator.clipboard.writeText(stripMarkdown(responses[m.key]))}
                          style={{ fontSize:11,color:"#6e6e73",background:"rgba(255,255,255,0.06)",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontFamily:"'Sora',sans-serif",transition:"all 0.15s" }}
                          onMouseEnter={e=>{e.currentTarget.style.color="#f5f5f7";e.currentTarget.style.background="rgba(255,255,255,0.1)"}}
                          onMouseLeave={e=>{e.currentTarget.style.color="#6e6e73";e.currentTarget.style.background="rgba(255,255,255,0.06)"}}>
                          copy
                        </button>
                      )}
                    </div>

                    {/* Loading Skeleton */}
                    {loading && !responses[m.key] ? (
                      <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:4 }}>
                          {[0,1,2].map(j=>(
                            <div key={j} style={{ width:4,height:4,borderRadius:"50%",background:m.dot,
                              animation:`dotBlink 1.2s ease infinite`,animationDelay:`${j*0.2}s` }} />
                          ))}
                        </div>
                        {[100,82,91,74,88].map((w,j)=>(
                          <div key={j} className="skel" style={{ width:`${w}%`,animationDelay:`${j*0.08}s` }} />
                        ))}
                      </div>
                    ) : (
                      <div className="prose-apple">
                        <ReactMarkdown>{responses[m.key]||""}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Empty State */}
            {!loading && !hasRes && !gated && (
              <div style={{ textAlign:"center",padding:"48px 0",color:"#3a3a3c" }}>
                <div style={{ fontSize:11,fontFamily:"'Sora',sans-serif",letterSpacing:"0.1em",textTransform:"uppercase" }}>
                  Enter a prompt above to begin
                </div>
              </div>
            )}
          </div>

          {/* COST TAB */}
          <div className={`section-transition ${activeTab==="cost"?"section-visible":"section-hidden"}`}>
            <div style={{ textAlign:"center",padding:"80px 0",color:"#3a3a3c" }}>
              <p style={{ fontFamily:"'Sora',sans-serif",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase" }}>Coming soon</p>
              <h2 style={{ fontFamily:"'Sora',sans-serif",fontSize:32,fontWeight:700,letterSpacing:"-0.03em",marginTop:12,color:"#6e6e73" }}>Cost Insights</h2>
            </div>
          </div>

          {/* CONTENT TAB */}
          <div className={`section-transition ${activeTab==="content"?"section-visible":"section-hidden"}`}>
            <div style={{ textAlign:"center",padding:"80px 0",color:"#3a3a3c" }}>
              <p style={{ fontFamily:"'Sora',sans-serif",fontSize:11,letterSpacing:"0.1em",textTransform:"uppercase" }}>Coming soon</p>
              <h2 style={{ fontFamily:"'Sora',sans-serif",fontSize:32,fontWeight:700,letterSpacing:"-0.03em",marginTop:12,color:"#6e6e73" }}>Your Content</h2>
            </div>
          </div>

        </div>
      </main>
    </>
  );
}