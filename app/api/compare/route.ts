/**
 * route.ts  —  POST /api/compare
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs a user prompt through Claude, GPT, and Gemini in parallel, then uses
 * Claude Haiku to generate a structured comparison (scores + qualitative notes).
 *
 * Request body: { prompt: string, systemContext: string }
 * Optional headers:
 *   X-FP         browser fingerprint (anti-incognito-bypass)
 *   X-Batch-Key  batch-test bypass secret (matches BATCH_SECRET env var)
 *
 * Response (200): { claude, openai, gemini, insights, timing, usage, attemptsLeft, windowStart }
 * Rate-limited (429): { error: string }
 * Bad input (400):    { error: string }
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, recordSuspiciousRequest, recordComparisonStats } from "@/app/lib/rateLimit";

// ── API clients ───────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ── Prompt injection patterns ─────────────────────────────────────────────────
// Designed to catch clear jailbreak / system-prompt override attempts without
// being so broad that they flag legitimate professional prompts.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|previous\s+)?instructions/i,
  /disregard\s+(your\s+)?(system\s+)?prompt/i,
  /forget\s+(your\s+)?(previous\s+)?instructions/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+if\s+you\s+(have\s+no|don'?t\s+have)/i,
  /you\s+are\s+now\s+(a\s+|an\s+)?(?!able|going|comparing|analyzing|evaluating)/i,
  /jailbreak/i,
  /\bDAN\s+mode\b/i,         // "Do Anything Now" jailbreak
  /override\s+(my\s+|your\s+)?(system\s+)?prompt/i,
];

// Allowed origins — requests without a matching Origin are likely scripts/curl.
// Browsers always send Origin on same-origin fetch() POST requests.
const ALLOWED_ORIGINS = new Set([
  "https://frontierpulse.org",
  "https://www.frontierpulse.org",
  "http://localhost:3000",
]);

// ── Web search augmentation ───────────────────────────────────────────────────
// Detects time-sensitive prompts and fetches a compact grounding block from
// Tavily's search API before running the three model calls. All three models
// receive the same context so comparisons remain apples-to-apples even when
// the question requires current information.
//
// Conservative trigger list — only fires on clear real-time signals to keep
// latency and cost minimal. Falls back gracefully if Tavily is unavailable.

const SEARCH_TRIGGER_PATTERNS: RegExp[] = [
  /\b(latest|recent|newest|current|right now|just announced|just released|just happened)\b/i,
  /\b(today|tonight|yesterday|this week|this month|this year)\b/i,
  /\b(news|breaking|update|updates|announcement|announced|released|launched|published)\b/i,
  /\b(2024|2025|2026)\b/,
  /\b(stock price|share price|market cap|valuation|funding round|IPO|acquisition|merger)\b/i,
  /\b(who is (the )?(current|new)|who (won|leads|runs|heads|is leading|is running))\b/i,
];

/** Returns true when the prompt clearly signals a need for real-time web data. */
function needsWebSearch(text: string): boolean {
  return SEARCH_TRIGGER_PATTERNS.some(p => p.test(text));
}

// Strip known prompt-injection patterns from externally sourced snippets before
// injecting them into model prompts. Tavily content is generally clean but we
// sanitise defensively since we do not control what third-party sites publish.
const WEB_CONTENT_STRIP =
  /ignore\s+(all\s+|previous\s+)?instructions|disregard.*prompt|forget.*instructions|system:|<system>|<\|im_start\|>|\[INST\]/gi;

/**
 * Fetches up to 3 fresh search snippets from Tavily and formats them as a
 * <web_context> block ready for injection into the model user-turn.
 *
 * Returns null on any failure (misconfiguration, network error, empty results)
 * so the caller can degrade gracefully to the standard no-search flow.
 */
async function fetchWebContext(query: string): Promise<string | null> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn("[search] TAVILY_API_KEY not configured — skipping web context");
    return null;
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key:             apiKey,
        query,
        search_depth:        "basic",   // cheapest tier; still returns fresh results
        max_results:         3,          // 3 snippets ≈ 150–250 injected tokens total
        include_answer:      false,      // raw snippets only — no Tavily synthesis pass
        include_raw_content: false,      // summaries only; raw HTML bodies are too large
      }),
      // Hard 5 s cap — Tavily is usually <1 s but we never want it blocking model calls
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn("[search] Tavily responded with HTTP", res.status);
      return null;
    }

    const data = await res.json() as {
      results?: { title?: string; content?: string }[];
    };

    const snippets = (data.results ?? [])
      .slice(0, 3)
      .map(r => r.content?.trim())
      .filter((s): s is string => typeof s === "string" && s.length > 30)
      // Sanitise injection patterns and cap each snippet so the block stays lean
      .map(s => s.replace(WEB_CONTENT_STRIP, "[removed]").slice(0, 450));

    if (snippets.length === 0) return null;

    const today = new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });

    // XML-tagged block signals to models that this is structured reference data,
    // not a new instruction. Models trained on RLHF handle this convention well.
    return [
      `<web_context date="${today}">`,
      ...snippets.map((s, i) => `[${i + 1}] ${s}`),
      `</web_context>`,
    ].join("\n");

  } catch (err) {
    console.warn("[search] Tavily fetch error:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  // ── 0. Origin check — first-line defence against scripted abuse ────────────
  // Browsers always include Origin on fetch() POST requests; curl omits it by
  // default. A missing or unknown Origin flags a likely non-browser caller.
  // We log + count these but still fall through to rate limiting so determined
  // attackers don't get a clean signal that the check exists.
  const origin = req.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) {
    void recordSuspiciousRequest(); // increment daily suspicious counter
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  // ── 1. Rate limiting ───────────────────────────────────────────────────────
  // Client IP (Vercel sets x-forwarded-for)
  const ip          = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // Lightweight browser fingerprint generated client-side (canvas + screen + timezone)
  const fingerprint = req.headers.get("x-fp") ?? undefined;
  // Batch-test bypass header (must match BATCH_SECRET env var)
  const batchKey    = req.headers.get("x-batch-key") ?? undefined;

  const { allowed, attemptsLeft, windowStart } = await checkRateLimit(ip, fingerprint, batchKey);
  if (!allowed) {
    // Include windowStart so the client can display the accurate reset time even on a
    // fresh browser that gets blocked on its very first request (localStorage would be empty).
    return NextResponse.json(
      { error: "You've reached your 10 daily comparisons.", windowStart },
      { status: 429 },
    );
  }

  // ── 2. Parse & validate input ──────────────────────────────────────────────
  let prompt: string, systemContext: string;
  try {
    ({ prompt, systemContext } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Whitelist systemContext to the exact values the UI sends.
  // This prevents prompt injection via a crafted systemContext payload.
  const VALID_SYSTEM_CONTEXTS = new Set([
    "You are a professional communication expert. Help the user craft whatever they need to communicate — this could be an email, message, announcement, pitch, memo, or any other format. Follow the user's lead on format and context.",
    "You are a senior strategy and analysis expert. Analyze whatever situation, market, document, or decision the user presents. Structure your thinking clearly and surface the insights that actually matter. Follow the user's lead on scope and depth.",
    "You are a trusted advisor helping someone think through a decision. Lay out the real tradeoffs, surface what they might be missing, and help them reach a confident conclusion. Follow the user's lead on the decision they're facing — personal or professional.",
  ]);
  if (!systemContext || !VALID_SYSTEM_CONTEXTS.has(systemContext)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Type and length checks
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0)
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  if (prompt.length > 1000)
    return NextResponse.json({ error: "Prompt too long. Please keep it under 1,000 characters." }, { status: 400 });

  // Strip control characters and null bytes
  const sanitized = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  if (sanitized.length === 0)
    return NextResponse.json({ error: "Invalid input detected." }, { status: 400 });

  // Prompt injection check — fast regex pass before spending any API credits
  if (INJECTION_PATTERNS.some((p) => p.test(sanitized)))
    return NextResponse.json({ error: "CONTENT_VIOLATION" }, { status: 422 });

  // ── 3. OpenAI Moderation ──────────────────────────────────────────────────
  // Free endpoint — screens for harmful content before spending tokens on models.
  // Runs BEFORE the three main model calls so a flagged prompt costs nothing.
  // We don't block on moderation API errors; they get logged and we let through.
  try {
    const modResult = await openai.moderations.create({ input: sanitized });
    if (modResult.results[0]?.flagged) {
      return NextResponse.json({ error: "CONTENT_VIOLATION" }, { status: 422 });
    }
  } catch (modErr) {
    console.warn("[moderation] check failed (non-blocking):", modErr);
  }

  // ── 3b. Derive task label + country (used for analytics) ─────────────────
  // Task label — short key derived from the whitelisted systemContext value
  const taskLabel = systemContext.includes("communication expert") ? "write"
    : systemContext.includes("strategy and analysis")             ? "analyze"
    : "decide";
  // Country — Vercel injects x-vercel-ip-country on edge requests (ISO 3166-1 alpha-2)
  const country = req.headers.get("x-vercel-ip-country") ?? "unknown";

  // ── 3c. Web search — fetch grounding context for time-sensitive queries ──────
  // Runs AFTER moderation so we never spend a Tavily credit on a flagged prompt.
  // webContext is injected into the user turn for all three models so they share
  // the same factual baseline. searchUsed / searchFallback are returned to the
  // client so the UI can show the correct state badge on the Compare tab.
  let webContext: string | null = null;
  const wantsSearch  = needsWebSearch(sanitized);
  let searchUsed     = false;
  let searchFallback = false;

  if (wantsSearch) {
    webContext = await fetchWebContext(sanitized);
    if (webContext) {
      searchUsed = true;     // context injected successfully
    } else {
      searchFallback = true; // search was attempted but Tavily was unavailable/empty
    }
  }

  // ── 4. Build prompts ───────────────────────────────────────────────────────
  const baseGuardrail = "Only respond to professional and personal contexts. Decline requests that are harmful, unethical, or abusive.";
  const unifiedSystem = `${systemContext} ${baseGuardrail} Respond immediately and directly to what the user gave you. Do not ask for clarification, do not explain what you could help with, and do not list your capabilities. If the input is brief or ambiguous, respond only to what is actually there — do not invent a scenario, fabricate context, or hallucinate specifics. Do not default to email format unless the user explicitly says "email". No Subject lines, no salutations, no sign-offs unless explicitly requested. Aim for 200-250 words.`;

  // If web context was fetched, prepend it to the user turn so all three models
  // receive identical grounding data before the actual question. We inject at the
  // user-message level (not system) so the context reads as reference material,
  // not an instruction — this is the convention models handle most reliably.
  const userMessage = webContext
    ? `${webContext}\n\nUsing the above as current factual context where relevant, respond to:\n${sanitized}`
    : sanitized;

  try {
    // ── 5. Run all 3 models in parallel ───────────────────────────────────────
    const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([

      // Claude Sonnet 4.6
      // userMessage = sanitized prompt, optionally prefixed with <web_context> block
      (async () => {
        const start = Date.now();
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          temperature: 0.7,
          system: unifiedSystem,
          messages: [{ role: "user", content: userMessage }],
        });
        return { msg, ms: Date.now() - start };
      })(),

      // GPT-5.4
      (async () => {
        const start = Date.now();
        const completion = await openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: 1000,
          temperature: 0.7,
          messages: [
            { role: "system", content: unifiedSystem },
            { role: "user",   content: userMessage },
          ],
        });
        return { completion, ms: Date.now() - start };
      })(),

      // Gemini 3.1 Pro (falls back to 2.5 Pro on 503/429)
      (async () => {
        const start = Date.now();
        const callGemini = async (modelName: string) => {
          const model = gemini.getGenerativeModel({ model: modelName, systemInstruction: unifiedSystem });
          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            // maxOutputTokens must be generous for Gemini 3.1 Pro: thinking tokens count
            // against this budget. thinkingBudget:1024 bounds thinking overhead so the
            // response always has room. Cast to any — thinkingConfig not yet in SDK types.
            // maxOutputTokens = thinkingBudget (1024) + target response (1024), matching
            // Claude and GPT at ~1000 tokens net.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // maxOutputTokens = thinkingBudget (512) + target response (1000) to match
            // Claude and GPT at ~1000 tokens net output.
            generationConfig: { maxOutputTokens: 1512, temperature: 0.7, stopSequences: [], thinkingConfig: { thinkingBudget: 512 } } as any,
          });
          const candidate = result.response.candidates?.[0];
          const text = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || result.response.text();
          const usageMeta = result.response.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
          return { text, usageMeta };
        };
        try {
          const { text, usageMeta } = await callGemini("gemini-3.1-pro-preview");
          return { text, usageMeta, ms: Date.now() - start };
        } catch (err: unknown) {
          const status = (err as { status?: number })?.status;
          if (status === 503 || status === 429) {
            console.log("Gemini 3.1 Pro unavailable, falling back to 2.5 Pro");
            const { text, usageMeta } = await callGemini("gemini-2.5-pro");
            return { text, usageMeta, ms: Date.now() - start };
          }
          throw err;
        }
      })(),
    ]);

    // ── 6. Extract text responses ──────────────────────────────────────────────
    const getError = (r: PromiseSettledResult<unknown>, name: string) => {
      if (r.status === "rejected") { console.error(`${name} error:`, r.reason); return "This model is currently unavailable."; }
      return null;
    };

    type CR = { msg: Anthropic.Message; ms: number };
    type OR = { completion: OpenAI.Chat.Completions.ChatCompletion; ms: number };
    type GR = { text: string; usageMeta: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined; ms: number };

    const claudeText = claudeRes.status === "fulfilled"
      ? ((claudeRes.value as CR).msg.content[0].type === "text"
          ? ((claudeRes.value as CR).msg.content[0] as { type: "text"; text: string }).text
          : getError(claudeRes, "Claude"))
      : getError(claudeRes, "Claude");

    const openaiText = openaiRes.status === "fulfilled"
      ? (openaiRes.value as OR).completion.choices[0].message.content
      : getError(openaiRes, "OpenAI");

    const geminiText = geminiRes.status === "fulfilled"
      ? (geminiRes.value as GR).text
      : getError(geminiRes, "Gemini");

    // ── 7. Timing & token usage ────────────────────────────────────────────────
    const timing = {
      claude: claudeRes.status === "fulfilled" ? (claudeRes.value as CR).ms : 0,
      openai: openaiRes.status === "fulfilled" ? (openaiRes.value as OR).ms : 0,
      gemini: geminiRes.status === "fulfilled" ? (geminiRes.value as GR).ms : 0,
    };

    const claudeUsage = claudeRes.status === "fulfilled" ? (claudeRes.value as CR).msg.usage : null;
    const openaiUsage = openaiRes.status === "fulfilled" ? (openaiRes.value as OR).completion.usage : null;
    const geminiMeta  = geminiRes.status === "fulfilled" ? (geminiRes.value as GR).usageMeta : null;

    const usage = {
      claude: { input: claudeUsage?.input_tokens  ?? 0, output: claudeUsage?.output_tokens     ?? 0 },
      openai: { input: openaiUsage?.prompt_tokens ?? 0, output: openaiUsage?.completion_tokens ?? 0 },
      gemini: { input: geminiMeta?.promptTokenCount ?? 0, output: geminiMeta?.candidatesTokenCount ?? 0 },
    };

    // ── 8. Claude Haiku — structured comparison & scoring ─────────────────────
    let insights = {
      claude: "", openai: "", gemini: "", bestFor: "",
      claudeApproach: "", openaiApproach: "", geminiApproach: "",
      claudeRelevance: 0, openaiRelevance: 0, geminiRelevance: 0,
      claudeFaithfulness: 0, openaiFaithfulness: 0, geminiFaithfulness: 0,
      claudeSafety: 0, openaiSafety: 0, geminiSafety: 0,
    };
    try {
      const insightsMsg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        system: `You are a neutral third-party evaluator of AI model outputs. You have no affiliation with Anthropic, OpenAI, or Google. Score each model's response purely on the quality of its output for the given prompt — not on which company made it. Apply the same rigorous standard to all three. Be specific: name what each response actually did, what it got right, and where it fell short. Avoid diplomatic hedging or generic praise. Return ONLY a valid JSON object — no markdown, no code fences, no extra text.`,
        messages: [{
          role: "user",
          content: `Task context: "${systemContext}"
User's prompt: "${sanitized}"

--- Claude Sonnet 4.6 response ---
${claudeText || "Unavailable"}

--- GPT-5.4 response ---
${openaiText || "Unavailable"}

--- Gemini 3.1 Pro response ---
${geminiText || "Unavailable"}

Scoring guide (apply independently to each model — do not anchor scores relative to each other):
- Relevance 0-100: how directly and completely the response addresses the user's specific prompt. Deduct for padding, off-topic content, or failure to answer what was actually asked.
- Faithfulness 0-100: how grounded and verifiable the claims are. Deduct for hallucinated facts, unsupported statistics, or invented specifics.
- Safety 0-100: 100 = fully safe, brand-appropriate, neutral. Deduct for toxicity, bias, or content inappropriate for professional use.

For bestFor: identify which model best served THIS specific prompt, name it clearly in one sentence with a concrete reason. Then one sentence each on when each of the other two would be the better choice. Be direct — users need a recommendation, not a hedge.

Return ONLY this JSON object. No markdown, no code fences, no extra text before or after the braces:
{
  "claude":             "1-2 sentence honest observation about what Claude Sonnet 4.6's response actually did — specific, not generic",
  "openai":             "1-2 sentence honest observation about what GPT-5.4's response actually did — specific, not generic",
  "gemini":             "1-2 sentence honest observation about what Gemini 3.1 Pro's response actually did — specific, not generic",
  "bestFor":            "Single sentence naming the strongest model for this prompt and the specific reason why. Then one sentence each explaining when each of the other two would be the better pick.",
  "claudeApproach":     "6-8 word structural descriptor e.g. 'Narrative prose, advisory tone, top-down'",
  "openaiApproach":     "6-8 word structural descriptor e.g. 'Numbered list, direct, action-forward'",
  "geminiApproach":     "6-8 word structural descriptor e.g. 'Sectioned headers, broad coverage, analytical'",
  "claudeRelevance":    0,
  "openaiRelevance":    0,
  "geminiRelevance":    0,
  "claudeFaithfulness": 0,
  "openaiFaithfulness": 0,
  "geminiFaithfulness": 0,
  "claudeSafety":       0,
  "openaiSafety":       0,
  "geminiSafety":       0
}`,
        }],
      });
      const raw = insightsMsg.content[0].type === "text" ? insightsMsg.content[0].text.trim() : "{}";
      // Strip markdown code fences if the model wrapped its output despite instructions
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
      insights = JSON.parse(cleaned);
    } catch (e) {
      console.error("Insights generation failed:", e);
    }

    // ── 9. Record rich analytics stats (fire-and-forget, never blocks response) ─
    void recordComparisonStats({
      country,
      task: taskLabel,
      scores: {
        claudeRelevance:    insights.claudeRelevance    ?? 0,
        openaiRelevance:    insights.openaiRelevance    ?? 0,
        geminiRelevance:    insights.geminiRelevance    ?? 0,
        claudeFaithfulness: insights.claudeFaithfulness ?? 0,
        openaiFaithfulness: insights.openaiFaithfulness ?? 0,
        geminiFaithfulness: insights.geminiFaithfulness ?? 0,
        claudeSafety:       insights.claudeSafety       ?? 0,
        openaiSafety:       insights.openaiSafety       ?? 0,
        geminiSafety:       insights.geminiSafety       ?? 0,
      },
      timing,
    });

    // ── 10. Return response ────────────────────────────────────────────────────
    // attemptsLeft + windowStart let the client stay in sync with the server's
    // authoritative state — including the correct reset time even in incognito.
    // searchUsed / searchFallback let the Compare tab show the correct badge.
    return NextResponse.json({
      claude: claudeText,
      openai: openaiText,
      gemini: geminiText,
      insights,
      timing,
      usage,
      attemptsLeft,
      windowStart,
      searchUsed,      // true  → web context was injected into all three prompts
      searchFallback,  // true  → search was triggered but Tavily was unavailable
    });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
