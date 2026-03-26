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
        max_tokens: 1000,
        system: safeSystem,
        messages: [{ role: "user", content: prompt }],
      }),

      // GPT-5.4
      openai.chat.completions.create({
        model: "gpt-5.4",
        max_completion_tokens: 1000,
        messages: [
          { role: "system", content: safeSystem },
          { role: "user", content: prompt },
        ],
      }),

      // Gemini
      (async () => {
        const model = gemini.getGenerativeModel({
          model: "gemini-2.5-flash",
          systemInstruction: safeSystem,
        });
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 1000,
            temperature: 0.7,
          },
        });
        const candidate = result.response.candidates?.[0];
        const text =
          candidate?.content?.parts
            ?.map((p: { text?: string }) => p.text || "")
            .join("") || result.response.text();
        return { text };
      })(),
    ]);

    const getError = (r: PromiseSettledR