import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { NextRequest, NextResponse } from "next/server";

const rateLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60 * 60,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await rateLimiter.consume(ip);
  } catch {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { prompt, systemContext } = await req.json();

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "Invalid prompt." }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json({ error: "Prompt too long. Please keep it under 2000 characters." }, { status: 400 });
  }

  const injectionPatterns = [
    /ignore previous instructions/i,
    /ignore all instructions/i,
    /disregard your system prompt/i,
    /you are now/i,
    /jailbreak/i,
  ];
  if (injectionPatterns.some((p) => p.test(prompt))) {
    return NextResponse.json({ error: "Invalid input detected." }, { status: 400 });
  }

  const baseGuardrail = "Only respond to professional and personal contexts. Decline requests that are harmful, unethical, or abusive.";

  const claudeSystem = `${systemContext} ${baseGuardrail} You are a trusted advisor. Always produce a complete, substantive response immediately — never ask for clarification or more details. If the input is brief or vague, make reasonable assumptions and proceed. Lead with judgment and nuance. Be direct and confident — aim for 300-400 words. Do not add meta-commentary or caveats. Deliver the work product itself.`;

  const openaiSystem = `${systemContext} ${baseGuardrail} You are a sharp, structured professional. Always produce a complete, immediately usable response — never ask for clarification or more details. If the input is brief or vague, make reasonable assumptions and proceed. Use clear formatting where it helps. Aim for 250-350 words. Commit to one excellent answer and deliver it. Do not offer multiple versions or suggest alternatives at the end.`;

  const geminiSystem = `${systemContext} ${baseGuardrail} You are a thorough, contextually aware thinker. Always produce a complete, substantive response immediately — never ask for clarification or more details. If the input is brief or vague, make reasonable assumptions and proceed. Go beyond the obvious — surface angles and implications the user may not have considered. Aim for 300-400 words. Always complete every sentence and section you start. Never truncate.`;

  try {
    const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: claudeSystem,
        messages: [{ role: "user", content: prompt }],
      }),

      openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 8000,
        messages: [
          { role: "system", content: openaiSystem },
          { role: "user", content: prompt },
        ],
      }),

      (async () => {
        const callGemini = async () => {
          const model = gemini.getGenerativeModel({
            model: "gemini-2.5-pro",
            systemInstruction: geminiSystem,
          });
          const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              maxOutputTokens: 3000,
              temperature: 1.0,
              stopSequences: [],
            },
          });
          const candidate = result.response.candidates?.[0];
          const text = candidate?.content?.parts?.map((p: { text?: string }) => p.text || "").join("") || result.response.text();
          return { text };
        };
        try {
          return await callGemini();
        } catch (err: unknown) {
          const status = (err as { status?: number })?.status;
          if (status === 503 || status === 429) {
            await new Promise(r => setTimeout(r, 2000));
            return await callGemini();
          }
          throw err;
        }
      })(),
    ]);

    const getError = (r: PromiseSettledResult<unknown>, name: string) => {
      if (r.status === "rejected") {
        console.error(`${name} error:`, r.reason);
        return "This model is currently unavailable.";
      }
      return null;
    };

    const claudeText =
      claudeRes.status === "fulfilled"
        ? (claudeRes.value as Anthropic.Message).content[0].type === "text"
          ? ((claudeRes.value as Anthropic.Message).content[0] as { type: "text"; text: string }).text
          : getError(claudeRes, "Claude")
        : getError(claudeRes, "Claude");

    const openaiText =
      openaiRes.status === "fulfilled"
        ? openaiRes.value.choices[0].message.content
        : getError(openaiRes, "OpenAI");

    const geminiText =
      geminiRes.status === "fulfilled"
        ? (geminiRes.value as { text: string }).text
        : getError(geminiRes, "Gemini");

    return NextResponse.json({
      claude: claudeText,
      openai: openaiText,
      gemini: geminiText,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
