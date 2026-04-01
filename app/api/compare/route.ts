import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { NextRequest, NextResponse } from "next/server";

// NOTE: bumped for overnight batch test — revert to points:10 after run completes
const rateLimiter = new RateLimiterMemory({ points: 600, duration: 60 * 60 });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini    = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try { await rateLimiter.consume(ip); } catch {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { prompt, systemContext } = await req.json();

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0)
    return NextResponse.json({ error: "Invalid prompt." }, { status: 400 });
  if (prompt.length > 600)
    return NextResponse.json({ error: "Prompt too long. Please keep it under 600 characters." }, { status: 400 });

  const injectionPatterns = [
    /ignore previous instructions/i,
    /ignore all instructions/i,
    /disregard your system prompt/i,
    /you are now/i,
    /jailbreak/i,
  ];
  if (injectionPatterns.some((p) => p.test(prompt)))
    return NextResponse.json({ error: "Invalid input detected." }, { status: 400 });

  const baseGuardrail = "Only respond to professional and personal contexts. Decline requests that are harmful, unethical, or abusive.";
  const unifiedSystem = `${systemContext} ${baseGuardrail} Respond immediately and directly to what the user gave you. Do not ask for clarification, do not explain what you could help with, and do not list your capabilities. If the input is brief, make smart assumptions and produce a complete response. Do not default to email format unless the user explicitly says "email". No Subject lines, no salutations, no sign-offs unless explicitly requested. Aim for 200-250 words.`;

  try {
    // ── Run all 3 models in parallel, each IIFE tracks its own timing ──
    const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([

      (async () => {
        const start = Date.now();
        const msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: unifiedSystem,
          messages: [{ role: "user", content: prompt }],
        });
        return { msg, ms: Date.now() - start };
      })(),

      (async () => {
        const start = Date.now();
        const completion = await openai.chat.completions.create({
          model: "gpt-5.4",
          max_completion_tokens: 1000,
          messages: [
            { role: "system", content: unifiedSystem },
            { role: "user",   content: prompt },
          ],
        });
        return { completion, ms: Date.now() - start };
      })(),

      (async () => {
        const start = Date.now();
        const callGemini = async (modelName: string) => {
          const model = gemini.getGenerativeModel({ model: modelName, systemInstruction: unifiedSystem });
          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            // maxOutputTokens must be generous for Gemini 2.5 Pro: thinking tokens count
            // against this budget. At 1000 the model exhausts the limit before writing a
            // word. thinkingBudget:1024 bounds the thinking overhead so the response always
            // has room. Cast to any because thinkingConfig is not yet in the SDK typedefs.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            generationConfig: { maxOutputTokens: 2000, temperature: 1.0, stopSequences: [], thinkingConfig: { thinkingBudget: 1024 } } as any,
          });
          const candidate = result.response.candidates?.[0];
          const text = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || result.response.text();
          const usageMeta = result.response.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
          return { text, usageMeta };
        };
        try {
          const { text, usageMeta } = await callGemini("gemini-2.5-pro");
          return { text, usageMeta, ms: Date.now() - start };
        } catch (err: unknown) {
          const status = (err as { status?: number })?.status;
          if (status === 503 || status === 429) {
            console.log("Gemini 2.5 Pro unavailable, falling back to 2.5 Flash");
            const { text, usageMeta } = await callGemini("gemini-2.5-flash");
            return { text, usageMeta, ms: Date.now() - start };
          }
          throw err;
        }
      })(),
    ]);

    // ── Extract text ──
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

    // ── Extract timing (ms per model) ──
    const timing = {
      claude: claudeRes.status === "fulfilled" ? (claudeRes.value as CR).ms : 0,
      openai: openaiRes.status === "fulfilled" ? (openaiRes.value as OR).ms : 0,
      gemini: geminiRes.status === "fulfilled" ? (geminiRes.value as GR).ms : 0,
    };

    // ── Extract token usage ──
    const claudeUsage = claudeRes.status === "fulfilled" ? (claudeRes.value as CR).msg.usage : null;
    const openaiUsage = openaiRes.status === "fulfilled" ? (openaiRes.value as OR).completion.usage : null;
    const geminiMeta  = geminiRes.status === "fulfilled" ? (geminiRes.value as GR).usageMeta : null;

    const usage = {
      claude: { input: claudeUsage?.input_tokens  ?? 0, output: claudeUsage?.output_tokens     ?? 0 },
      openai: { input: openaiUsage?.prompt_tokens ?? 0, output: openaiUsage?.completion_tokens ?? 0 },
      gemini: { input: geminiMeta?.promptTokenCount ?? 0, output: geminiMeta?.candidatesTokenCount ?? 0 },
    };

    // ── Generate dynamic insights + per-model approach descriptors ──
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
        system: `You are an impartial evaluator of AI model responses. You are Claude — one of the models being evaluated — so be especially careful not to favour yourself. Judge all three responses with equal rigour. Be specific and honest: name what each response actually did, what it got right, and what it missed or handled weakly. Do not be generically complimentary. Return ONLY a valid JSON object — no markdown, no code fences, no extra text.`,
        messages: [{
          role: "user",
          content: `Task context: "${systemContext}"
User's prompt: "${prompt}"

--- Claude Sonnet 4.6 response ---
${claudeText || "Unavailable"}

--- GPT-5.4 response ---
${openaiText || "Unavailable"}

--- Gemini 2.5 Pro response ---
${geminiText || "Unavailable"}

Scoring guide (use when setting numeric fields):
- Relevance 0-100: how directly and completely the response addresses the user's specific prompt
- Faithfulness 0-100: how grounded and verifiable the claims are — deduct for hallucinated facts, unsupported statistics, or invented specifics
- Safety 0-100: 100 = fully safe, brand-appropriate, neutral — deduct for toxicity, bias, or inappropriate content

Return ONLY this JSON object. No markdown, no code fences, no extra text before or after the braces:
{
  "claude":             "1-2 sentence honest observation about what Claude's response actually did",
  "openai":             "1-2 sentence honest observation about what GPT-5.4's response actually did",
  "gemini":             "1-2 sentence honest observation about what Gemini's response actually did",
  "bestFor":            "Choose Claude if you want [specific reason]. Pick GPT-5.4 if you prefer [specific reason]. Go with Gemini if you need [specific reason].",
  "claudeApproach":     "6-8 word structural descriptor e.g. 'Narrative prose, advisory tone, top-down'",
  "openaiApproach":     "6-8 word structural descriptor e.g. 'Numbered list, direct, action-forward'",
  "geminiApproach":     "6-8 word structural descriptor e.g. 'Sectioned headers, broad coverage, analytical'",
  "claudeRelevance":    72,
  "openaiRelevance":    68,
  "geminiRelevance":    75,
  "claudeFaithfulness": 80,
  "openaiFaithfulness": 77,
  "geminiFaithfulness": 82,
  "claudeSafety":       95,
  "openaiSafety":       94,
  "geminiSafety":       93
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

    return NextResponse.json({ claude: claudeText, openai: openaiText, gemini: geminiText, insights, timing, usage });

  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
