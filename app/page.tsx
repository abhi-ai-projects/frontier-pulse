"use client";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

type Tab = "task" | "cost" | "content";

const TASK_CATEGORIES = [
  {
    id: "email",
    label: "Customer Email",
    icon: "✉️",
    placeholder:
      "Describe the email you need to write. E.g. 'Reply to an unhappy enterprise customer whose implementation was delayed by 3 weeks'",
    systemContext:
      "You are a professional enterprise customer success manager. Write clear, empathetic, and actionable responses.",
  },
  {
    id: "summary",
    label: "Strategy Summary",
    icon: "📋",
    placeholder:
      "Paste a strategy document, meeting notes, or long brief you want summarized for leadership...",
    systemContext:
      "You are a management consultant. Summarize clearly for a C-suite audience. Be concise, structured, and insight-driven.",
  },
  {
    id: "analysis",
    label: "Competitive Analysis",
    icon: "🔍",
    placeholder:
      "Describe a market, product, or competitor you want analyzed. E.g. 'Compare Anthropic vs OpenAI for enterprise API customers'",
    systemContext:
      "You are a senior strategy analyst. Provide structured, balanced, and evidence-based competitive analysis.",
  },
  {
    id: "pitch",
    label: "Executive Pitch",
    icon: "🎯",
    placeholder:
      "Describe what you need to pitch and to whom. E.g. 'Pitch adopting Claude API to our CTO as a replacement for our current OpenAI setup'",
    systemContext:
      "You are an expert at crafting executive-level business pitches. Be persuasive, concise, and ROI-focused.",
  },
  {
    id: "risk",
    label: "Risk Assessment",
    icon: "⚠️",
    placeholder:
      "Describe a decision, project, or initiative you want risk-assessed. E.g. 'Risks of migrating our customer data pipeline to a new cloud provider'",
    systemContext:
      "You are a risk management expert. Identify risks clearly, rate their severity, and suggest mitigations.",
  },
];

const MODELS = [
  { key: "claude", label: "Claude", subtitle: "Thorough & judgment-driven", color: "from-orange-500/10" },
  { key: "openai", label: "GPT-5.4", subtitle: "Structured & send-ready", color: "from-green-500/10" },
  { key: "gemini", label: "Gemini", subtitle: "Contextual & thorough", color: "from-blue-500/10" },
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

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [selectedTask, setSelectedTask] = useState(TASK_CATEGORIES[0]);
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [attemptsUsed, setAttemptsUsed] = useState(getAttempts());

  const tabs: { id: Tab; label: string; description: string }[] = [
    {
      id: "task",
      label: "Task Compare",
      description: "Compare models on real enterprise tasks",
    },
    {
      id: "cost",
      label: "Cost Insights",
      description: "See what each model actually costs at scale",
    },
    {
      id: "content",
      label: "Your Content",
      description: "Test with your own real content",
    },
  ];

  const handleCompare = async (overridePrompt?: string) => {
    const activePrompt = overridePrompt || prompt;
    if (!activePrompt.trim()) return;

    // Free attempt gate
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

  return (
    <main className="min-h-screen bg-black text-white px-6 py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2">
            Frontier Pulse
          </h1>
          <p className="text-gray-400 text-sm">
            Compare Claude, GPT-5.4, and Gemini — side by side, on what actually matters
          </p>
          {attemptsUsed > 0 && !showLoginPrompt && (
            <p className="text-xs text-gray-600 mt-2">
              {remainingAttempts} free comparison
              {remainingAttempts !== 1 ? "s" : ""} remaining
            </p>
          )}
        </div>

        {/* Login Prompt */}
        {showLoginPrompt && (
          <div className="mb-10 bg-white/5 border border-white/20 rounded-2xl p-8 text-center">
            <h2 className="text-xl font-semibold mb-2">
              You&apos;ve used your 3 free comparisons
            </h2>
            <p className="text-gray-400 text-sm mb-6">
              Sign in with Google to continue using Frontier Pulse for free.
            </p>
            <button className="bg-white text-black font-semibold px-8 py-3 rounded-xl text-sm hover:bg-gray-200 transition">
              Sign in with Google
            </button>
            <p className="text-xs text-gray-600 mt-4">
              No payment required. Your data is never stored.
            </p>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-10 border-b border-white/10">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-all ${
                activeTab === tab.id
                  ? "bg-white text-black"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* TASK COMPARE TAB */}
        {activeTab === "task" && (
          <div>
            {/* Task Category Selector */}
            <div className="flex flex-wrap gap-3 mb-8">
              {TASK_CATEGORIES.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    setSelectedTask(task);
                    setPrompt("");
                    setResponses({});
                    setError("");
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all border ${
                    selectedTask.id === task.id
                      ? "bg-white text-black border-white"
                      : "border-white/20 text-gray-400 hover:border-white/40 hover:text-white"
                  }`}
                >
                  <span>{task.icon}</span>
                  <span>{task.label}</span>
                </button>
              ))}
            </div>

            {/* Prompt Input */}
            <div className="flex gap-3 mb-4">
              <textarea
                className="flex-1 bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-white/40 transition"
                rows={4}
                placeholder={selectedTask.placeholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <button
                onClick={() => handleCompare()}
                disabled={loading || !prompt.trim() || showLoginPrompt}
                className="bg-white text-black font-semibold px-6 rounded-xl text-sm hover:bg-gray-200 transition disabled:opacity-40 self-start"
              >
                {loading ? "Comparing..." : "Compare →"}
              </button>
            </div>

            {/* Error */}
            {error && (
              <p className="text-red-400 text-xs mb-6">{error}</p>
            )}

            {/* Privacy Note */}
            <p className="text-xs text-gray-600 mb-8">
              Your input is sent to Anthropic, OpenAI, and Google APIs for
              processing. Do not include confidential or personally identifiable
              information.
            </p>

            {/* Response Panels */}
            {(loading || Object.keys(responses).length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {MODELS.map((model) => (
                  <div
                    key={model.key}
                    className={`bg-gradient-to-b ${model.color} to-white/5 border border-white/10 rounded-2xl p-5 min-h-56`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h2 className="text-sm font-semibold text-white">
                          {model.label}
                        </h2>
                        <p className="text-xs text-gray-500 mt-0.5">{model.subtitle}</p>
                      </div>
                      {responses[model.key] && (
                        <button
                          onClick={() => {
                            const raw = responses[model.key] || "";
                            const plain = raw
                              .replace(/#{1,6}\s+/g, "")
                              .replace(/\*\*(.+?)\*\*/g, "$1")
                              .replace(/\*(.+?)\*/g, "$1")
                              .replace(/^[-*]\s+/gm, "• ")
                              .replace(/^(\d+)\.\s+/gm, "$1. ")
                              .replace(/\|.+\|/g, "")
                              .replace(/---/g, "")
                              .replace(/\n{3,}/g, "\n\n")
                              .trim();
                            navigator.clipboard.writeText(plain);
                          }}
                          className="text-xs text-gray-500 hover:text-white transition"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                    {loading ? (
                      <p className="text-sm text-gray-500 animate-pulse">
                        Generating...
                      </p>
                    ) : (
                      <div className="text-sm text-gray-300 leading-relaxed prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>
                          {responses[model.key] || ""}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* COST INSIGHTS TAB */}
        {activeTab === "cost" && (
          <div className="text-gray-400 text-sm">
            Cost Insights coming soon...
          </div>
        )}

        {/* YOUR CONTENT TAB */}
        {activeTab === "content" && (
          <div className="text-gray-400 text-sm">
            Your Content coming soon...
          </div>
        )}
      </div>
    </main>
  );
}