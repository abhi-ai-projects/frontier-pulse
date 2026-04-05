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
import { checkRateLimit } from "@/app/lib/rateLimit";

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

export async function POST(req: NextRequest) {
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

  // Type and length checks
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0)
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  if (prompt.length > 1000)
    return NextResponse.json({ error: "Prompt too long. Please keep it under 1,000 characters." }, { status: 400 });

  // Strip control characters and null bytes
  const sanitized = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
  if (sanitized.length === 0)
    return NextResponse.json({ error: "Invalid input detected." }, { status: 400 });

  // Prompt injection check
  if (INJECTION_PATTERNS.some((p) => p.test(sanitized)))
    return NextResponse.json({ error: "Invalid input detected." }, { status: 400 });

  // ── 3. OpenAI Moderation ──────────────────────────────────────────────────
  // Free endpoint — screens for harmful content before spending tokens on models.
  // We don't block on moderation errors; they just get logged.
  try {
    const modResult = await openai.moderations.create({ input: sanitized });
    if (modResult.results[0]?.flagged) {
      return NextResponse.json(
        { error: "This prompt may conflict with one or more provider content policies — try rephrasing." },
        { status: 400 },
      );
    }
  } catch (modErr) {
    console.warn("[moderation] check failed (non-blocking):", modErr);
  }

  // ── 4. System prompt ───────────────────────────────────────────────────────
  const baseGuardrail = "Only respond to professional and personal contexts. Decline requests that are harmful, unethical, or abusive.";
  const unifiedSystem = `${systemContext} ${baseGuardrail} Respond immediately and directly to what the user gave you. Do not ask for clarification, do not explain what you could help with, and do not list your capabilities. If the input is brief or ambiguous, respond only to what is actually there — do not invent a scenario, fabricate context, or hallucinate specifics. Do not default to email format unless the user explicitly says "email". No Subject lines, no salutations, no sign-offs unless explicitly requested. Aim for 200-250 words.`;

  try {
    // ── 5. Run all 3 models in parallel ───────────────────────────────────────
    const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([

      // Claude Sonnet 4.6
      (async () => {
        const start = Date.now();
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          temperature: 0.7,
          system: unifiedSystem,
          messages: [{ role: "user", content: sanitized }],
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
            { role: "user",   content: sanitized },
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
            contents: [{ role: "user", parts: [{ text: sanitized }] }],
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

    // ── 9. Return response ─────────────────────────────────────────────────────
    // attemptsLeft + windowStart let the client stay in sync with the server's
    // authoritative state — including the correct reset time even in incognito.
    return NextResponse.json({
      claude: claudeText,
      openai: openaiText,
      gemini: geminiText,
      insights,
      timing,
      usage,
      attemptsLeft,
      windowStart,
    });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
