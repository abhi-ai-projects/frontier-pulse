"use client";
import { useState } from "react";

type Tab = "task" | "cost" | "content";

const TASK_CATEGORIES = [
  {
    id: "email",
    label: "Customer Email",
    icon: "✉️",
    placeholder: "Describe the email you need to write. E.g. 'Reply to an unhappy enterprise customer whose implementation was delayed by 3 weeks'",
    systemContext: "You are a professional enterprise customer success manager. Write clear, empathetic, and actionable responses.",
  },
  {
    id: "summary",
    label: "Strategy Summary",
    icon: "📋",
    placeholder: "Paste a strategy document, meeting notes, or long brief you want summarized for leadership...",
    systemContext: "You are a management consultant. Summarize clearly for a C-suite audience. Be concise, structured, and insight-driven.",
  },
  {
    id: "analysis",
    label: "Competitive Analysis",
    icon: "🔍",
    placeholder: "Describe a market, product, or competitor you want analyzed. E.g. 'Compare Anthropic vs OpenAI for enterprise API customers'",
    systemContext: "You are a senior strategy analyst. Provide structured, balanced, and evidence-based competitive analysis.",
  },
  {
    id: "pitch",
    label: "Executive Pitch",
    icon: "🎯",
    placeholder: "Describe what you need to pitch and to whom. E.g. 'Pitch adopting Claude API to our CTO as a replacement for our current OpenAI setup'",
    systemContext: "You are an expert at crafting executive-level business pitches. Be persuasive, concise, and ROI-focused.",
  },
  {
    id: "risk",
    label: "Risk Assessment",
    icon: "⚠️",
    placeholder: "Describe a decision, project, or initiative you want risk-assessed. E.g. 'Risks of migrating our customer data pipeline to a new cloud provider'",
    systemContext: "You are a risk management expert. Identify risks clearly, rate their severity, and suggest mitigations.",
  },
];

const MODELS = ["Claude", "GPT-4o", "Gemini"];

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("task");
  const [selectedTask, setSelectedTask] = useState(TASK_CATEGORIES[0]);
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const tabs: { id: Tab; label: string; description: string }[] = [
    { id: "task", label: "Task Compare", description: "Compare models on real enterprise tasks" },
    { id: "cost", label: "Cost Insights", description: "See what each model actually costs at scale" },
    { id: "content", label: "Your Content", description: "Test with your own real content" },
  ];

  const handleCompare = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResponses({});
    // Real API calls coming next session
    setTimeout(() => {
      setResponses({
        Claude: "Claude's response will appear here once API keys are connected.",
        "GPT-4o": "GPT-4o's response will appear here once API keys are connected.",
        Gemini: "Gemini's response will appear here once API keys are connected.",
      });
      setLoading(false);
    }, 1200);
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-12">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold tracking-tight mb-2">Frontier Pulse</h1>
          <p className="text-gray-400 text-sm">
            Compare Claude, GPT-4o, and Gemini — side by side, on what actually matters
          </p>
        </div>

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
            <div className="flex gap-3 mb-10">
              <textarea
                className="flex-1 bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-white/40 transition"
                rows={4}
                placeholder={selectedTask.placeholder}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <button
                onClick={handleCompare}
                disabled={loading || !prompt.trim()}
                className="bg-white text-black font-semibold px-6 rounded-xl text-sm hover:bg-gray-200 transition disabled:opacity-40 self-start mt-0"
              >
                {loading ? "Comparing..." : "Compare →"}
              </button>
            </div>

            {/* Response Panels */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {MODELS.map((model) => (
                <div
                  key={model}
                  className="bg-white/5 border border-white/10 rounded-2xl p-5 min-h-56"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-white">{model}</h2>
                    {responses[model] && (
                      <button
                        onClick={() => navigator.clipboard.writeText(responses[model])}
                        className="text-xs text-gray-500 hover:text-white transition"
                      >
                        Copy
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
                    {loading
                      ? "Generating..."
                      : responses[model] || "Response will appear here after you compare."}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* COST INSIGHTS TAB */}
        {activeTab === "cost" && (
          <div className="text-gray-400 text-sm">Cost Insights coming soon...</div>
        )}

        {/* YOUR CONTENT TAB */}
        {activeTab === "content" && (
          <div className="text-gray-400 text-sm">Your Content coming soon...</div>
        )}

      </div>
    </main>
  );
}