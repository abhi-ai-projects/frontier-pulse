# Frontier Pulse — Architecture

> Single-page app that sends the same prompt to Claude Sonnet 4.6, GPT-5.4, and Gemini 3.1 Pro simultaneously and compares responses side by side. Deployed at **frontierpulse.org**.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.1 App Router (TypeScript, React 19) |
| Deployment | Vercel (auto-deploy from GitHub main) |
| Persistence | Vercel KV (Redis) — rate limit counters only |
| Models | Claude Sonnet 4.6 · GPT-5.4 · Gemini 3.1 Pro |
| Eval engine | Claude Haiku 4.5 (post-generation scoring pass) |
| Analytics | PostHog (client-side, no PII) |
| Fonts | Sora (display) · Figtree (body) — Google Fonts |

---

## File Map

```
app/
  page.tsx              — entire client UI (~1,340 lines, single React component)
  layout.tsx            — root server component; loads fonts, wraps in PostHogProvider
  globals.css           — design tokens, animations, component classes, responsive breakpoint
  api/
    compare/
      route.ts          — POST /api/compare; validation → moderation → models → eval → response
  lib/
    rateLimit.ts        — rolling 24h rate limiter (Vercel KV + in-memory fallback)
    posthog.tsx         — PostHog client wrapper with typed event helpers
  privacy/page.tsx      — Privacy Policy (Termly HTML, address removed)
  terms/page.tsx        — Terms of Use (Termly HTML, all blanks filled, IL governing law)
public/
  abhi.jpg              — creator photo (400×400 JPEG)
scripts/
  batch_test.py         — overnight batch test runner (hits deployed Vercel endpoint)
  screenshot_interesting.py — post-batch Playwright screenshot capture
  prompts.json          — 500-prompt eval set (must exist before running batch)
```

---

## Request Lifecycle — POST /api/compare

```
1. Rate limit check
   → Vercel KV: read fp:rl2:ip:<IP> AND fp:rl2:fp:<fingerprint>
   → Enforce Math.max(ip_count, fp_count) >= 10 → 429
   → Batch bypass: X-Batch-Key header matches BATCH_SECRET env var

2. Input validation
   → Type + length check (max 600 chars)
   → Strip control characters (\x00–\x1F, \x7F)
   → 9 regex injection patterns → 400 on match

3. OpenAI moderation
   → openai.moderations.create({ input: sanitized })
   → Flagged → 400. Errors are non-blocking (logged, not thrown)

4. System prompt assembly
   → systemContext (task-specific) + baseGuardrail + formatting instructions
   → Identical system prompt sent to all three models

5. Parallel model calls — Promise.allSettled
   → Claude Sonnet 4.6    — anthropic.messages.create
   → GPT-5.4              — openai.chat.completions.create
   → Gemini 3.1 Pro       — gemini.getGenerativeModel (thinkingBudget: 512)
                             falls back to gemini-2.5-pro on 503/429

6. Claude Haiku eval pass
   → All three responses evaluated in a single context window
   → Returns JSON: per-model insight strings, approach descriptors,
     bestFor verdict, and three numeric scores each (Relevance, Faithfulness, Safety 0–100)
   → Haiku is explicitly told it is Claude and to apply equal rigour to itself

7. Response
   → { claude, openai, gemini, insights, timing, usage, attemptsLeft }
   → attemptsLeft syncs localStorage with server-authoritative count
```

---

## Rate Limiting

Two independent Vercel KV keys per request: `fp:rl2:ip:<IP>` and `fp:rl2:fp:<fingerprint>`. The effective count is `Math.max(ip_count, fp_count)`. Whichever key has seen more usage wins — a user switching networks or using a VPN cannot reset their count if their fingerprint is known.

| Setting | Value |
|---|---|
| Daily limit | 10 comparisons |
| Window | 24-hour rolling from first use (not midnight reset) |
| KV TTL | 90,000 s (~25 h) — keys expire naturally |
| Fail-open | KV outage returns `{ allowed: true, attemptsLeft: 1 }` |
| Local dev | In-memory `Map` fallback, no KV required |

---

## Browser Fingerprinting

`buildFingerprint()` in `page.tsx` produces an FNV-1a 32-bit hash from:

1. `navigator.userAgent` (first 80 chars)
2. `screen.width × screen.height`
3. `screen.colorDepth`
4. `Intl.DateTimeFormat().resolvedOptions().timeZone`
5. `navigator.language`
6. `navigator.hardwareConcurrency`
7. Canvas render fingerprint — `ctx.fillText('FP🔬', 2, 14)` → last 32 chars of data URL

Hash algorithm: `h ^= charCode; h = Math.imul(h, 0x01000193)` (FNV-1a, result `>>> 0` as base-36 string).

The canvas component is the key differentiator: it varies by GPU driver and OS rendering pipeline, meaning two machines with identical screen/browser/timezone settings will still produce different hashes.

---

## Eval Scoring

| Dimension | Measures | Deductions |
|---|---|---|
| **Relevance** (0–100) | How directly the response addresses the specific prompt | Generic/off-topic answers, unnecessary framing, missed elements |
| **Faithfulness** (0–100) | Whether claims are grounded and verifiable | Hallucinated facts, invented statistics, unsupported specifics |
| **Safety** (0–100) | Professional appropriateness and brand neutrality | Bias, toxicity, inappropriate tone, content requiring review |

Display thresholds: ≥ 80 → High/Safe (green) · 55–79 → Medium/Low Risk (orange) · < 55 → Low/Flagged (red).

Best model per dimension is computed client-side from the numeric scores:
```ts
const bestOf = (scores: [string, number][]) =>
  scores.reduce((a, b) => b[1] > a[1] ? b : a)[0];
```

---

## UI Architecture

**Single component** (`Home` in `app/page.tsx`) with local React state only — no Redux, no context providers.

**Three sections** (Prompt / Compare / Analysis) are stacked absolutely-positioned divs toggled via CSS classes (`.section-visible` / `.section-hidden`). Components are never remounted on tab switch — response text and scroll positions are preserved.

**Three modals** (How It Works / About / Daily Limit) rendered at root JSX level. All use the same iOS-safe scroll lock: `save scrollY → position:fixed + top:-scrollY → restore on close`.

**Mobile breakpoint**: 768 px. Below it: desktop sidebar hidden, mobile bottom nav shown, nav buttons switch text → icon-only, textarea min-height increases.

---

## Key Constants

| Constant | Value | Location |
|---|---|---|
| `DAILY_LIMIT` | 10 | `rateLimit.ts` |
| `FREE_LIMIT` | 10 | `page.tsx` (must stay in sync) |
| `WINDOW_MS` | 86,400,000 ms | both files |
| `TTL_SECONDS` | 90,000 | `rateLimit.ts` |
| Prompt max | 600 chars | `route.ts` |
| Model `max_tokens` | 1,000 (Claude/GPT) · 2,048 (Gemini) | `route.ts` |
| Haiku `max_tokens` | 1,200 | `route.ts` |
| `thinkingBudget` | 512 tokens | `route.ts` (Gemini) |
| `temperature` | 0.7 | all primary models |
| `STORAGE_KEY` | `fp_session` | `page.tsx` |

---

## Environment Variables (Vercel)

```
ANTHROPIC_API_KEY
OPENAI_API_KEY
GEMINI_API_KEY
KV_REST_API_URL
KV_REST_API_TOKEN
BATCH_SECRET        — batch test bypass secret (never commit)
```

---

## Batch Testing

See `scripts/` for the overnight batch test setup. Before running:

1. Drop `scripts/prompts.json` (500-prompt eval set)
2. Bump `points` in `route.ts` from `10` → `600` and deploy
3. Run: `python3 scripts/batch_test.py --prompts scripts/prompts.json`
4. After run: revert rate limit and redeploy
5. Run screenshot script: `python3 scripts/screenshot_interesting.py --csv scripts/results_prompts.csv`
