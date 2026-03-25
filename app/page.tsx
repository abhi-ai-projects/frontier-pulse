"use client";
import { useState } from "react";

type Tab = "task" | "cost" | "content";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("task");

  const tabs: { id: Tab; label: string; description: string }[] = [
    { id: "task", label: "Task Compare", description: "Compare models on real enterprise tasks" },
    { id: "cost", label: "Cost Insights", description: "See what each model actually costs at scale" },
    { id: "content", label: "Your Content", description: "Test with your own real content" },
  ];

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
        <div className="flex gap-2 mb-10 border-b border-white/10 pb-0">
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

        {/* Tab Description */}
        <p className="text-gray-500 text-sm mb-8">
          {tabs.find((t) => t.id === activeTab)?.description}
        </p>

        {/* Tab Content */}
        {activeTab === "task" && (
          <div className="text-gray-400 text-sm">Task Compare coming next...</div>
        )}
        {activeTab === "cost" && (
          <div className="text-gray-400 text-sm">Cost Insights coming next...</div>
        )}
        {activeTab === "content" && (
          <div className="text-gray-400 text-sm">Your Content coming next...</div>
        )}

      </div>
    </main>
  );
}