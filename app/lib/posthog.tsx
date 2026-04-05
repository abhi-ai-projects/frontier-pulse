"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";

// Initialize PostHog once on the client
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    posthog.init("phc_vu2HMzsgToeKfChwV7ZdkCdYZrAUNKEqA4xjZbTRjA7g", {
      api_host: "https://us.i.posthog.com",
      capture_pageview: true,          // auto page view on load
      capture_pageleave: true,         // track when users leave
      autocapture: false,              // we'll track manually for precision
      persistence: "memory",           // no cookies — avoids GDPR consent requirement
    });
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

// Typed event helpers — import these in page.tsx instead of calling posthog directly
export function trackPromptSubmitted(prompt: string, taskContext: string) {
  posthog.capture("prompt_submitted", {
    prompt_length: prompt.length,
    task_context: taskContext,
  });
}

export function trackComparisonComplete(data: {
  claudeTime: number;
  openaiTime: number;
  geminiTime: number;
  bestRelevance: string;
  bestFaithfulness: string;
  bestSafety: string;
  taskContext: string;
}) {
  posthog.capture("comparison_complete", {
    claude_time_ms: data.claudeTime,
    openai_time_ms: data.openaiTime,
    gemini_time_ms: data.geminiTime,
    best_relevance: data.bestRelevance,
    best_faithfulness: data.bestFaithfulness,
    best_safety: data.bestSafety,
    task_context: data.taskContext,
  });
}

export function trackAttemptLimitReached(attemptsUsed: number) {
  posthog.capture("attempt_limit_reached", {
    attempts_used: attemptsUsed,
  });
}

export function trackModalOpened(modalName: "how_it_works" | "about") {
  posthog.capture("modal_opened", { modal: modalName });
}
