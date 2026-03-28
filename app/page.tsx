"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

type Tab = "task" | "cost" | "content";

const TASK_CATEGORIES = [
  {
    id: "email",
    label: "Customer Email",
    icon: "✉",
    placeholder: "Describe the email you need to write. E.g. 'Reply to an unhappy enterprise customer whose implementation was delayed by 3 weeks'",
    systemContext: "You are a professional enterprise customer success manager. Write clear, empathetic, and actionable responses.",
  },
  {
    id: "summary",
    label: "Strategy Summary",
    icon: "◈",
    placeholder: "Paste a strategy document, meeting notes, or long brief you want summarized for leadership...",
    systemContext: "You are a management consultant. Summarize clearly for a C-suite audience. Be concise, structured, and insight-driven.",
  },
  {
    id: "analysis",
    label: "Competitive Analysis",
    icon: "⊹",
    placeholder: "Describe a market, product, or competitor you want analyzed. E.g. 'Compare Anthropic vs OpenAI for enterprise API customers'",
    systemContext: "You are a senior strategy analyst. Provide structured, balanced, and evidence-based competitive analysis.",
  },
  {
    id: "pitch",
    label: "Executive Pitch",
    icon: "◎",
    placeholder: "Describe what you need to pitch and to whom. E.g. 'Pitch adopting Claude API to our CTO as a replacement for our current OpenAI setup'",
    systemContext: "You are an expert at crafting executive-level business pitches. Be persuasive, concise, and ROI-focused.",
  },
  {
    id: "risk",
    label: "Risk Assessment",
    icon: "△",
    placeholder: "Describe a decision, project, or initiative you want risk-assessed. E.g. 'Risks of migrating our customer data pipeline to a new cloud provider'",
    systemContext: "You are a risk management expert. Identify risks clearly, rate their severity, and suggest mitigations.",
  },
];

const MODELS = [
  {
    key: "claude",
    label: "Claude",
    maker: "Anthropic",
    subtitle: "Judgment-driven",
    glowVar: "var(--claude-glow)",
    accentColor: "#e8673a",
    borderColor: "rgba(232, 103, 58, 0.3)",
  },
  {
    key: "openai",
    label: "GPT-5.4",
    maker: "OpenAI",
    subtitle: "Structured & precise",
    glowVar: "var(--openai-glow)",
    accentColor: "#4ade80",
    borderColor: "rgba(74, 222, 128, 0.2)",
  },
  {
    key: "gemini",
    label: "Gemini",
    maker: "Google",
    subtitle: "Contextually thorough",
    glowVar: "var(--gemini-glow)",
    accentColor: "#60a5fa",
    borderColor: "rgba(96, 165, 250, 0.2)",
  },
];

const FREE_LIMIT = 3;
const STORAGE_KEY = "fp_attempts";

function getAttempts(): number {
  if (typeof window === "undefined") return 0;
  return parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
}

function incrementAttempts(): number {
  const next = getAttempts() + 1;
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "• ")
    .replace(/^(\d+)\.\s+/gm, "$1. ")
    .replace(/\|.+\|/g, "")
    .replace(/---/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [selectedTask, setSelectedTask] = useState(TASK_CATEGORIES[0]);
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [attemptsUsed, setAttemptsUsed] = useState(getAttempts());

  const tabs: { id: Tab; label: string }[] = [
    { id: "task", label: "Task Compare" },
    { id: "cost", label: "Cost Insights" },
    { id: "content", label: "Your Content" },
  ];

  const handleCompare = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt || prompt;
    if (!activePrompt.trim()) return;

    const current = getAttempts();
    if (current >= FREE_LIMIT) {
      setShowLoginPrompt(true);
      return;
    }

    setLoading(true);
    setError("");
    setResponses({});

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: activePrompt,
          systemContext: selectedTask.systemContext,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      const newCount = incrementAttempts();
      setAttemptsUsed(newCount);
      setResponses({
        claude: data.claude,
        openai: data.openai,
        gemini: data.gemini,
      });
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const remainingAttempts = Math.max(0, FREE_LIMIT - attemptsUsed);
  const hasResponses = Object.keys(responses).length > 0;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-primary)", padding: "0 24px 80px" }}>

      {/* Subtle background gradient */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(232,103,58,0.06) 0%, transparent 70%)",
      }} />

      <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 1 }}>

        {/* Header */}
        <header className="fade-up fade-up-1" style={{ textAlign: "center", paddingTop: 72, paddingBottom: 48 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: "var(--accent)", boxShadow: "0 0 8px var(--accent)",
            }} />
            <span style={{ fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "var(--text-secondary)", fontFamily: "'DM Mono', monospace" }}>
              Frontier Model Intelligence
            </span>
          </div>
          <h1 style={{
            fontFamily: "'Instrument Serif', serif",
            fontSize: "clamp(40px, 6vw, 64px)",
            fontWeight: 400,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: "var(--text-primary)",
            marginBottom: 16,
          }}>
            Frontier Pulse
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto", lineHeight: 1.6 }}>
            Compare Claude, GPT-5.4, and Gemini side by side — on tasks that actually matter in enterprise work.
          </p>
          {attemptsUsed > 0 && !showLoginPrompt && (
            <p style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
              {remainingAttempts} free {remainingAttempts === 1 ? "comparison" : "comparisons"} remaining
            </p>
          )}
        </header>

        {/* Login Gate */}
        {showLoginPrompt && (
          <div className="fade-up" style={{
            marginBottom: 40,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: "48px 40px",
            textAlign: "center",
          }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", fontSize: 18 }}>◎</div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>You've used your 3 free comparisons</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 28 }}>Sign in with Google to continue — no payment required.</p>
            <button style={{
              background: "var(--text-primary)", color: "var(--bg)",
              border: "none", borderRadius: 10, padding: "12px 28px",
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              Continue with Google
            </button>
            <p style={{ marginTop: 16, fontSize: 11, color: "var(--text-muted)" }}>Your content is never stored.</p>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="fade-up fade-up-2" style={{ display: "flex", gap: 0, marginBottom: 40, borderBottom: "1px solid var(--border)" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "12px 20px",
                fontSize: 13,
                fontWeight: 500,
                fontFamily: "'DM Sans', sans-serif",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: activeTab === tab.id ? "var(--text-primary)" : "var(--text-secondary)",
                borderBottom: activeTab === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
                marginBottom: -1,
                transition: "all 0.2s ease",
                letterSpacing: "0.01em",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TASK COMPARE TAB */}
        {activeTab === "task" && (
          <div className="fade-up fade-up-3">

            {/* Task Pills */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}>
              {TASK_CATEGORIES.map((task) => (
                <button
                  key={task.id}
                  onClick={() => { setSelectedTask(task); setPrompt(""); setResponses({}); setError(""); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "8px 16px",
                    borderRadius: 100,
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: "'DM Sans', sans-serif",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    background: selectedTask.id === task.id ? "var(--text-primary)" : "transparent",
                    color: selectedTask.id === task.id ? "var(--bg)" : "var(--text-secondary)",
                    border: selectedTask.id === task.id ? "1px solid var(--text-primary)" : "1px solid var(--border)",
                  }}
                >
                  <span style={{ fontSize: 11 }}>{task.icon}</span>
                  {task.label}
                </button>
              ))}
            </div>

            {/* Input */}
            <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
              <textarea
                placeholder={selectedTask.placeholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                style={{
                  flex: 1,
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  fontSize: 14,
                  color: "var(--text-primary)",
                  fontFamily: "'DM Sans', sans-serif",
                  resize: "none",
                  outline: "none",
                  lineHeight: 1.6,
                  transition: "border 0.2s ease",
                }}
                onFocus={(e) => e.target.style.borderColor = "var(--border-hover)"}
                onBlur={(e) => e.target.style.borderColor = "var(--border)"}
              />
              <button
                onClick={() => handleCompare()}
                disabled={loading || !prompt.trim() || showLoginPrompt}
                style={{
                  padding: "14px 24px",
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif",
                  cursor: loading || !prompt.trim() ? "not-allowed" : "pointer",
                  border: "none",
                  background: loading || !prompt.trim() ? "var(--bg-elevated)" : "var(--accent)",
                  color: loading || !prompt.trim() ? "var(--text-muted)" : "#fff",
                  whiteSpace: "nowrap",
                  transition: "all 0.2s ease",
                  boxShadow: loading || !prompt.trim() ? "none" : "0 0 20px rgba(232, 103, 58, 0.3)",
                }}
              >
                {loading ? "Comparing..." : "Compare →"}
              </button>
            </div>

            {error && <p style={{ fontSize: 13, color: "#f87171", marginBottom: 16 }}>{error}</p>}

            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 36, fontFamily: "'DM Mono', monospace" }}>
              Content is sent to Anthropic, OpenAI, and Google APIs. Do not include confidential or personally identifiable information.
            </p>

            {/* Response Panels */}
            {(loading || hasResponses) && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                {MODELS.map((model, i) => (
                  <div
                    key={model.key}
                    className="fade-up"
                    style={{
                      animationDelay: `${i * 0.08}s`,
                      opacity: 0,
                      background: "var(--bg-panel)",
                      border: `1px solid ${hasResponses && responses[model.key] ? model.borderColor : "var(--border)"}`,
                      borderRadius: 16,
                      padding: "20px 22px",
                      minHeight: 220,
                      transition: "border 0.3s ease",
                      boxShadow: hasResponses && responses[model.key] ? `0 0 40px ${model.glowVar}` : "none",
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {/* Top accent line */}
                    <div style={{
                      position: "absolute", top: 0, left: 0, right: 0, height: 2,
                      background: hasResponses && responses[model.key]
                        ? `linear-gradient(90deg, transparent, ${model.accentColor}40, ${model.accentColor}, ${model.accentColor}40, transparent)`
                        : "transparent",
                      transition: "background 0.3s ease",
                    }} />

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: "50%",
                            background: model.accentColor,
                            display: "inline-block",
                            boxShadow: `0 0 6px ${model.accentColor}`,
                          }} />
                          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif" }}>
                            {model.label}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
                            {model.maker}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 16, fontFamily: "'DM Mono', monospace" }}>
                          {model.subtitle}
                        </p>
                      </div>
                      {responses[model.key] && (
                        <button
                          onClick={() => navigator.clipboard.writeText(stripMarkdown(responses[model.key]))}
                          style={{
                            fontSize: 11, color: "var(--text-muted)",
                            background: "none", border: "none", cursor: "pointer",
                            fontFamily: "'DM Mono', monospace",
                            padding: "4px 8px",
                            borderRadius: 6,
                            transition: "color 0.2s",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
                        >
                          copy
                        </button>
                      )}
                    </div>

                    {loading && !responses[model.key] ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
                        {[100, 85, 92, 70].map((w, i) => (
                          <div key={i} style={{
                            height: 12, borderRadius: 6,
                            background: "var(--bg-elevated)",
                            width: `${w}%`,
                            animation: "pulse-soft 1.5s ease infinite",
                            animationDelay: `${i * 0.1}s`,
                          }} />
                        ))}
                      </div>
                    ) : (
                      <div className="prose-dark" style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                        <ReactMarkdown>{responses[model.key] || ""}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {!loading && !hasResponses && (
              <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>◈</div>
                <p style={{ fontSize: 13, fontFamily: "'DM Mono', monospace" }}>
                  Select a task type, enter your prompt, and compare
                </p>
              </div>
            )}
          </div>
        )}

        {/* COST INSIGHTS TAB */}
        {activeTab === "cost" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>◎</div>
            <p style={{ fontSize: 13, fontFamily: "'DM Mono', monospace" }}>Cost Insights — coming soon</p>
          </div>
        )}

        {/* YOUR CONTENT TAB */}
        {activeTab === "content" && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>△</div>
            <p style={{ fontSize: 13, fontFamily: "'DM Mono', monospace" }}>Your Content — coming soon</p>
          </div>
        )}

      </div>
    </main>
  );
}