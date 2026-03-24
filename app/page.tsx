"use client";
import { useState } from "react";

const models = ["Claude", "GPT-4o", "Gemini"];

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleCompare = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setResponses({});
    // API calls coming next session
    setTimeout(() => {
      setResponses({
        Claude: "Claude response will appear here.",
        "GPT-4o": "GPT-4o response will appear here.",
        Gemini: "Gemini response will appear here.",
      });
      setLoading(false);
    }, 1000);
  };

  return (
    <main className="min-h-screen bg-black text-white px-6 py-12">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-2 tracking-tight">
          Frontier Pulse
        </h1>
        <p className="text-center text-gray-400 mb-10 text-sm">
          Compare Claude, GPT-4o, and Gemini side by side
        </p>

        {/* Prompt Input */}
        <div className="flex gap-3 mb-10">
          <textarea
            className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none focus:outline-none focus:border-white/40"
            rows={3}
            placeholder="Enter a prompt to compare models..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            onClick={handleCompare}
            disabled={loading}
            className="bg-white text-black font-semibold px-6 rounded-xl text-sm hover:bg-gray-200 transition disabled:opacity-50"
          >
            {loading ? "Comparing..." : "Compare"}
          </button>
        </div>

        {/* Response Panels */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {models.map((model) => (
            <div
              key={model}
              className="bg-white/5 border border-white/10 rounded-2xl p-5 min-h-48"
            >
              <h2 className="text-sm font-semibold text-gray-300 mb-3">
                {model}
              </h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                {loading
                  ? "Generating..."
                  : responses[model] || "Response will appear here."}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}