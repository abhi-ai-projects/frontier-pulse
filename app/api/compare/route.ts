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
  // Rate limiting by IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    await rateLimiter.consume(ip);
  } catch {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  const { prompt, systemContext } = await req.json();

  // Input validation
  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "Invalid prompt." }, { status: 400 });
  }
  if (prompt.length > 2000) {
    return NextResponse.json(
      { error: "Prompt too long. Please keep it under 2000 characters." },
      { status: 400 }
    );
  }

  // Injection guard
  const injectionPatterns = [
    /ignore previous instructions/i,
    /ignore all instructions/i,
    /disregard your system prompt/i,
    /you are now/i,
    /jailbreak/i,
  ];
  if (injectionPatterns.some((p) => p.test(prompt))) {
    return NextResponse.json(
      { error: "Invalid input detected." },
      { status: 400 }
    );
  }

  const safeSystem = `${systemContext} Only respond to professional enterprise use cases. Decline any requests that are harmful, unethical, or unrelated to business tasks.`;

  try {
    const [claudeRes, openaiRes, geminiRes] = await Promise.allSettled([
      // Claude
      anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        system: safeSystem,
        messages: [{ role: "user", content: prompt }],
      }),

      // GPT-4o
      openai.chat.completions.create({
        model: "gpt-4o",
        max_tokens: 500,
        messages: [
          { role: "system", content: safeSystem },
          { role: "user", content: prompt },
        ],
      }),

      // Gemini
      (async () => {
        const model = gemini.getGenerativeModel({
          model: "gemini-1.5-flash",
          systemInstruction: safeSystem,
        });
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 500 },
        });
        return result;
      })(),
    ]);

    const getError = (r: PromiseSettledResult<unknown>) =>
      r.status === "rejected" ? "This model is currently unavailable." : null;

    const claudeText =
      claudeRes.status === "fulfilled"
        ? (claudeRes.value as Anthropic.Message).content[0].type === "text"
          ? (
              claudeRes.value as Anthropic.Message & {
                content: [{ type: "text"; text: string }];
              }
            ).content[0].text
          : getError(claudeRes)
        : getError(claudeRes);

    const openaiText =
      openaiRes.status === "fulfilled"
        ? openaiRes.value.choices[0].message.content
        : getError(openaiRes);

    const geminiText =
      geminiRes.status === "fulfilled"
        ? geminiRes.value.response.text()
        : getError(geminiRes);

    return NextResponse.json({
      claude: claudeText,
      openai: openaiText,
      gemini: geminiText,
    });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}