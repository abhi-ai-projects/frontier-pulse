/**
 * rateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side rate limiting for Frontier Pulse — rolling 24-hour window.
 *
 * Strategy:
 *   • Primary limit  — per browser fingerprint: DAILY_LIMIT (10) comparisons.
 *     Each unique browser gets its own independent quota. Colleagues on shared
 *     office WiFi each get their own 10; they don't share a pool.
 *
 *   • Secondary limit — per IP: IP_DAILY_LIMIT (50) comparisons.
 *     A backstop that only fires against scripted abuse from a single network.
 *     Not intended to affect real users (50 colleagues in one office is
 *     already unlikely; scripts hitting in a tight loop would hit this fast).
 *
 *   • When no fingerprint is sent (rare), IP is used as the sole signal and
 *     the tighter DAILY_LIMIT applies, acting conservatively.
 *
 *   • Each KV record stores { firstUse: ms timestamp, count: number }.
 *     The 24-hour window is rolling from first use, not midnight UTC.
 *
 *   • IPs are SHA-256 hashed before storage — they are PII under GDPR and
 *     should never be stored in plaintext.
 *
 *   • Fallback: in-process Map for local development (resets on cold start).
 *
 * How to enable KV in production:
 *   1. Vercel Dashboard → your project → Storage → Create Database → KV
 *   2. Connect the store to your project (auto-populates env vars)
 *   3. Run `vercel env pull .env.local` to sync vars locally
 *   Required vars: KV_REST_API_URL  KV_REST_API_TOKEN
 *
 * Batch-test bypass:
 *   Pass header  X-Batch-Key: <BATCH_SECRET env var>  to skip the limit.
 *   Set BATCH_SECRET in your Vercel environment (never commit it).
 */

import { createHash } from "crypto";

export const DAILY_LIMIT    = 10;   // per browser fingerprint — the user-facing quota
const IP_DAILY_LIMIT        = 50;   // per IP — bot/abuse backstop only
const WINDOW_MS             = 24 * 60 * 60 * 1000; // 24 h in ms
const TTL_SECONDS           = 90_000;               // 25 h — lets keys expire naturally

interface WindowRecord { firstUse: number; count: number; }

// ── In-memory fallback (local dev only) ──────────────────────────────────────
const memory = new Map<string, WindowRecord>();

/** One-way hash of an IP address — preserves rate-limit semantics without
 *  storing PII in plain text. Truncated to 16 hex chars (64-bit) for key brevity. */
function hashIP(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/** KV key — no date suffix; window managed by firstUse timestamp.
 *  Uses fp:rl2 namespace to distinguish from legacy date-scoped fp:rl keys. */
function rlKey(prefix: string): string {
  return `fp:rl2:${prefix}`;
}

/** Daily stats key — scoped to today's UTC date so counters auto-reset. */
function statsKey(metric: string): string {
  const date = new Date().toISOString().slice(0, 10); // "2026-04-05"
  return `fp:stats:${date}:${metric}`;
}

/** Fire-and-forget KV counter increment — never throws, never blocks the request. */
async function incr(key: string, kv: { incr: (k: string) => Promise<unknown> }): Promise<void> {
  try { await kv.incr(key); } catch { /* best-effort */ }
}

/** Returns the effective count — 0 if the record is missing or its 24h window has elapsed. */
function effectiveCount(rec: WindowRecord | null, now: number): number {
  if (!rec) return 0;
  if (now - rec.firstUse > WINDOW_MS) return 0;
  return rec.count;
}

/** Preserved firstUse if still within the window, otherwise now (fresh start). */
function resolvedFirstUse(rec: WindowRecord | null, now: number): number {
  return rec && now - rec.firstUse <= WINDOW_MS ? rec.firstUse : now;
}

export interface RateLimitResult {
  allowed:      boolean;
  attemptsLeft: number;
  /** Unix ms timestamp when the fingerprint's 24-hour window started.
   *  Returned so the client can display an accurate reset time even when
   *  localStorage is empty (incognito, fresh browser, storage cleared). */
  windowStart:  number;
}

/**
 * Read-only status check — returns the current usage without incrementing.
 * Used by GET /api/status so the client can sync the counter on page load
 * without having to run a full comparison first.
 */
export async function getRateLimitStatus(
  ip: string,
  fingerprint?: string,
): Promise<{ attemptsLeft: number; windowStart: number }> {
  const now   = Date.now();
  const ipKey = rlKey(`ip:${hashIP(ip)}`);
  const fpKey = fingerprint ? rlKey(`fp:${fingerprint}`) : null;

  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");
      const [ipRec, fpRec] = await Promise.all([
        kv.get<WindowRecord>(ipKey),
        fpKey ? kv.get<WindowRecord>(fpKey) : Promise.resolve<WindowRecord | null>(null),
      ]);

      const fpCount = effectiveCount(fpRec, now);
      const ipCount = effectiveCount(ipRec, now);

      // attemptsLeft is always fingerprint-based (the user-facing quota).
      // Fall back to IP-based when no fingerprint is available.
      const attemptsLeft = fpKey
        ? Math.max(0, DAILY_LIMIT - fpCount)
        : Math.max(0, DAILY_LIMIT - ipCount);

      const windowStart = fpKey
        ? resolvedFirstUse(fpRec, now)   // user's personal window
        : resolvedFirstUse(ipRec, now);

      return { attemptsLeft, windowStart };
    } catch {
      // KV outage — fail silently, localStorage stays as the fallback.
      return { attemptsLeft: DAILY_LIMIT, windowStart: Date.now() };
    }
  }

  // ── In-memory fallback (local dev) ────────────────────────────────────────
  const existing = memory.get(fpKey ?? ipKey) ?? null;
  return {
    attemptsLeft: Math.max(0, DAILY_LIMIT - effectiveCount(existing, now)),
    windowStart:  existing?.firstUse ?? now,
  };
}

/**
 * Check and increment the 24-hour rolling quota for an IP + optional fingerprint.
 * Call this before running any model API calls.
 */
export async function checkRateLimit(
  ip: string,
  fingerprint?: string,
  batchKey?: string,
): Promise<RateLimitResult> {

  // ── Batch-test bypass ─────────────────────────────────────────────────────
  const secret = process.env.BATCH_SECRET;
  if (secret && batchKey === secret) {
    return { allowed: true, attemptsLeft: DAILY_LIMIT, windowStart: Date.now() };
  }

  const now   = Date.now();
  const ipKey = rlKey(`ip:${hashIP(ip)}`);
  const fpKey = fingerprint ? rlKey(`fp:${fingerprint}`) : null;

  // ── Vercel KV path ────────────────────────────────────────────────────────
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");

      const [ipRec, fpRec] = await Promise.all([
        kv.get<WindowRecord>(ipKey),
        fpKey ? kv.get<WindowRecord>(fpKey) : Promise.resolve<WindowRecord | null>(null),
      ]);

      const fpCount = effectiveCount(fpRec, now);
      const ipCount = effectiveCount(ipRec, now);

      // ── Blocking check ──────────────────────────────────────────────────
      // Primary: fingerprint over per-browser limit.
      // Secondary: IP over abuse backstop (independent of fingerprint limit).
      // When no fingerprint is sent, apply the tighter DAILY_LIMIT to IP.
      const fpBlocked = fpKey ? fpCount >= DAILY_LIMIT    : false;
      const ipBlocked = fpKey ? ipCount >= IP_DAILY_LIMIT : ipCount >= DAILY_LIMIT;

      if (fpBlocked || ipBlocked) {
        // Track rate-limit hit in daily stats (fire-and-forget)
        void incr(statsKey("rate_limited"), kv);

        const windowStart = fpKey
          ? resolvedFirstUse(fpRec, now)
          : resolvedFirstUse(ipRec, now);
        return { allowed: false, attemptsLeft: 0, windowStart };
      }

      // ── Increment ───────────────────────────────────────────────────────
      // IP and FP counters advance independently — each tracks its own window.
      const ipFirstUse = resolvedFirstUse(ipRec, now);
      const fpFirstUse = fpKey ? resolvedFirstUse(fpRec, now) : now;

      // Detect new browser (fpCount === 0 = first time this fingerprint appears)
      const isNewBrowser = fpKey && fpCount === 0;

      await Promise.all([
        kv.set<WindowRecord>(ipKey, { firstUse: ipFirstUse, count: ipCount + 1 }, { ex: TTL_SECONDS }),
        fpKey
          ? kv.set<WindowRecord>(fpKey, { firstUse: fpFirstUse, count: fpCount + 1 }, { ex: TTL_SECONDS })
          : Promise.resolve(),
      ]);

      // Global stats — fire-and-forget, never block the response
      void incr(statsKey("comparisons"), kv);
      void incr("fp:stats:alltime:comparisons", kv);
      if (isNewBrowser) void incr(statsKey("new_browsers"), kv);

      // attemptsLeft and windowStart are always fingerprint-based —
      // that's the limit the user actually experiences.
      const attemptsLeft = fpKey ? DAILY_LIMIT - (fpCount + 1) : DAILY_LIMIT - (ipCount + 1);
      const windowStart  = fpKey ? fpFirstUse : ipFirstUse;
      return { allowed: true, attemptsLeft, windowStart };

    } catch (err) {
      // KV outage — fail open so users aren't locked out.
      console.error("[rateLimit] KV error — failing open:", err);
      return { allowed: true, attemptsLeft: 1, windowStart: Date.now() };
    }
  }

  // ── In-memory fallback (local dev) ────────────────────────────────────────
  const storeKey  = fpKey ?? ipKey;
  const existing  = memory.get(storeKey) ?? null;
  const count     = effectiveCount(existing, now);
  if (count >= DAILY_LIMIT) return { allowed: false, attemptsLeft: 0, windowStart: existing?.firstUse ?? Date.now() };
  const firstUse  = resolvedFirstUse(existing, now);
  memory.set(storeKey, { firstUse, count: count + 1 });
  return { allowed: true, attemptsLeft: DAILY_LIMIT - (count + 1), windowStart: firstUse };
}

// ── Rich stats types ─────────────────────────────────────────────────────────

export interface ComparisonStats {
  country: string;       // ISO-3166-1 alpha-2, e.g. "US", or "unknown"
  task:    string;       // "write" | "analyze" | "decide"
  scores: {
    claudeRelevance:    number; openaiRelevance:    number; geminiRelevance:    number;
    claudeFaithfulness: number; openaiFaithfulness: number; geminiFaithfulness: number;
    claudeSafety:       number; openaiSafety:       number; geminiSafety:       number;
  };
  timing: { claude: number; openai: number; gemini: number };
}

export interface GlobalStats {
  today: {
    comparisons: number; rateLimited: number; suspicious: number; newBrowsers: number;
  };
  allTime: {
    comparisons: number;
    /** Average scores per model. null when no data yet. */
    avgScores: {
      claude: { relevance: number | null; faithfulness: number | null; safety: number | null };
      openai: { relevance: number | null; faithfulness: number | null; safety: number | null };
      gemini: { relevance: number | null; faithfulness: number | null; safety: number | null };
    };
    /** How many comparisons each model "won" per metric */
    wins: {
      claude: { relevance: number; faithfulness: number; safety: number };
      openai: { relevance: number; faithfulness: number; safety: number };
      gemini: { relevance: number; faithfulness: number; safety: number };
    };
    /** Comparison count by task type */
    tasks: { write: number; analyze: number; decide: number };
    /** Average response time in ms per model */
    avgTiming: { claude: number | null; openai: number | null; gemini: number | null };
    /** Top countries by usage — sorted descending, up to 10 entries */
    topCountries: { code: string; count: number }[];
  };
}

// ── KV hash key names ─────────────────────────────────────────────────────────
const COUNTRIES_KEY  = "fp:stats:alltime:countries";   // hash: {US:150, IN:40}
const TASKS_KEY      = "fp:stats:alltime:tasks";       // hash: {write:50, analyze:80, decide:30}
const SCORES_KEY     = "fp:stats:alltime:scores";      // hash: {claude_r_sum, claude_r_n, ...}
const WINS_KEY       = "fp:stats:alltime:wins";        // hash: {claude_relevance, ...}
const TIMING_KEY     = "fp:stats:alltime:timing";      // hash: {claude_sum, claude_n, ...}

/** ─────────────────────────────────────────────────────────────────────────────
 * Record rich per-comparison stats after a successful Haiku evaluation.
 * All operations are fire-and-forget; never blocks the response.
 */
export async function recordComparisonStats(data: ComparisonStats): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
  try {
    const { kv } = await import("@vercel/kv");
    const s = data.scores;

    // Determine wins (skip if both scores are 0 — model likely failed)
    const winRelevance    = bestOf({ claude: s.claudeRelevance,    openai: s.openaiRelevance,    gemini: s.geminiRelevance });
    const winFaithfulness = bestOf({ claude: s.claudeFaithfulness, openai: s.openaiFaithfulness, gemini: s.geminiFaithfulness });
    const winSafety       = bestOf({ claude: s.claudeSafety,       openai: s.openaiSafety,       gemini: s.geminiSafety });

    await Promise.all([
      // Geography
      kv.hincrby(COUNTRIES_KEY, data.country || "unknown", 1),

      // Task distribution
      kv.hincrby(TASKS_KEY, data.task || "unknown", 1),

      // Score running totals (sum + count per model per metric)
      kv.hincrby(SCORES_KEY, "claude_r_sum",  s.claudeRelevance),
      kv.hincrby(SCORES_KEY, "claude_r_n",    s.claudeRelevance > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "openai_r_sum",  s.openaiRelevance),
      kv.hincrby(SCORES_KEY, "openai_r_n",    s.openaiRelevance > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "gemini_r_sum",  s.geminiRelevance),
      kv.hincrby(SCORES_KEY, "gemini_r_n",    s.geminiRelevance > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "claude_f_sum",  s.claudeFaithfulness),
      kv.hincrby(SCORES_KEY, "claude_f_n",    s.claudeFaithfulness > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "openai_f_sum",  s.openaiFaithfulness),
      kv.hincrby(SCORES_KEY, "openai_f_n",    s.openaiFaithfulness > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "gemini_f_sum",  s.geminiFaithfulness),
      kv.hincrby(SCORES_KEY, "gemini_f_n",    s.geminiFaithfulness > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "claude_s_sum",  s.claudeSafety),
      kv.hincrby(SCORES_KEY, "claude_s_n",    s.claudeSafety > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "openai_s_sum",  s.openaiSafety),
      kv.hincrby(SCORES_KEY, "openai_s_n",    s.openaiSafety > 0 ? 1 : 0),
      kv.hincrby(SCORES_KEY, "gemini_s_sum",  s.geminiSafety),
      kv.hincrby(SCORES_KEY, "gemini_s_n",    s.geminiSafety > 0 ? 1 : 0),

      // Model wins
      ...(winRelevance    ? [kv.hincrby(WINS_KEY, `${winRelevance}_relevance`,    1)] : []),
      ...(winFaithfulness ? [kv.hincrby(WINS_KEY, `${winFaithfulness}_faithfulness`, 1)] : []),
      ...(winSafety       ? [kv.hincrby(WINS_KEY, `${winSafety}_safety`,          1)] : []),

      // Response timing
      ...(data.timing.claude > 0 ? [kv.hincrby(TIMING_KEY, "claude_sum", data.timing.claude), kv.hincrby(TIMING_KEY, "claude_n", 1)] : []),
      ...(data.timing.openai > 0 ? [kv.hincrby(TIMING_KEY, "openai_sum", data.timing.openai), kv.hincrby(TIMING_KEY, "openai_n", 1)] : []),
      ...(data.timing.gemini > 0 ? [kv.hincrby(TIMING_KEY, "gemini_sum", data.timing.gemini), kv.hincrby(TIMING_KEY, "gemini_n", 1)] : []),
    ]);
  } catch { /* best-effort */ }
}

/** Returns the model name with the highest score, or null on tie / all-zero. */
function bestOf(scores: Record<string, number>): string | null {
  const entries = Object.entries(scores).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  const winners = entries.filter(([, v]) => v === max);
  return winners.length === 1 ? winners[0][0] : null; // null on tie
}

/** Helper to safely compute avg from a hash record. */
function avg(h: Record<string, number>, sumField: string, nField: string): number | null {
  const n = h[nField] ?? 0;
  return n > 0 ? Math.round((h[sumField] ?? 0) / n) : null;
}

/** ─────────────────────────────────────────────────────────────────────────────
 * Aggregate stats for the admin dashboard.
 */
export async function getGlobalStats(): Promise<GlobalStats> {
  const emptyWins = { claude: { relevance: 0, faithfulness: 0, safety: 0 }, openai: { relevance: 0, faithfulness: 0, safety: 0 }, gemini: { relevance: 0, faithfulness: 0, safety: 0 } };
  const emptyAvg  = { claude: { relevance: null, faithfulness: null, safety: null }, openai: { relevance: null, faithfulness: null, safety: null }, gemini: { relevance: null, faithfulness: null, safety: null } };
  const empty: GlobalStats = {
    today: { comparisons: 0, rateLimited: 0, suspicious: 0, newBrowsers: 0 },
    allTime: { comparisons: 0, avgScores: emptyAvg, wins: emptyWins, tasks: { write: 0, analyze: 0, decide: 0 }, avgTiming: { claude: null, openai: null, gemini: null }, topCountries: [] },
  };
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return empty;

  try {
    const { kv } = await import("@vercel/kv");

    const [
      comparisons, rateLimited, suspicious, newBrowsers, allTimeComparisons,
      scoresH, winsH, tasksH, timingH, countriesH,
    ] = await Promise.all([
      kv.get<number>(statsKey("comparisons")).then(v => v ?? 0),
      kv.get<number>(statsKey("rate_limited")).then(v => v ?? 0),
      kv.get<number>(statsKey("suspicious")).then(v => v ?? 0),
      kv.get<number>(statsKey("new_browsers")).then(v => v ?? 0),
      kv.get<number>("fp:stats:alltime:comparisons").then(v => v ?? 0),
      kv.hgetall(SCORES_KEY).then(v => numericHash(v)),
      kv.hgetall(WINS_KEY).then(v => numericHash(v)),
      kv.hgetall(TASKS_KEY).then(v => numericHash(v)),
      kv.hgetall(TIMING_KEY).then(v => numericHash(v)),
      kv.hgetall(COUNTRIES_KEY).then(v => numericHash(v)),
    ]);

    const topCountries = Object.entries(countriesH)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      today: { comparisons, rateLimited, suspicious, newBrowsers },
      allTime: {
        comparisons: allTimeComparisons,
        avgScores: {
          claude: { relevance: avg(scoresH, "claude_r_sum", "claude_r_n"), faithfulness: avg(scoresH, "claude_f_sum", "claude_f_n"), safety: avg(scoresH, "claude_s_sum", "claude_s_n") },
          openai: { relevance: avg(scoresH, "openai_r_sum", "openai_r_n"), faithfulness: avg(scoresH, "openai_f_sum", "openai_f_n"), safety: avg(scoresH, "openai_s_sum", "openai_s_n") },
          gemini: { relevance: avg(scoresH, "gemini_r_sum", "gemini_r_n"), faithfulness: avg(scoresH, "gemini_f_sum", "gemini_f_n"), safety: avg(scoresH, "gemini_s_sum", "gemini_s_n") },
        },
        wins: {
          claude: { relevance: winsH.claude_relevance ?? 0, faithfulness: winsH.claude_faithfulness ?? 0, safety: winsH.claude_safety ?? 0 },
          openai: { relevance: winsH.openai_relevance ?? 0, faithfulness: winsH.openai_faithfulness ?? 0, safety: winsH.openai_safety ?? 0 },
          gemini: { relevance: winsH.gemini_relevance ?? 0, faithfulness: winsH.gemini_faithfulness ?? 0, safety: winsH.gemini_safety ?? 0 },
        },
        tasks: { write: tasksH.write ?? 0, analyze: tasksH.analyze ?? 0, decide: tasksH.decide ?? 0 },
        avgTiming: {
          claude: timingH.claude_n ? Math.round(timingH.claude_sum / timingH.claude_n) : null,
          openai: timingH.openai_n ? Math.round(timingH.openai_sum / timingH.openai_n) : null,
          gemini: timingH.gemini_n ? Math.round(timingH.gemini_sum / timingH.gemini_n) : null,
        },
        topCountries,
      },
    };
  } catch {
    return empty;
  }
}

/** Coerce all values in a KV hgetall result to numbers. */
function numericHash(h: Record<string, unknown> | null): Record<string, number> {
  if (!h) return {};
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v) || 0]));
}

/** Increment the "suspicious requests" counter — exported so route.ts can call it
 *  when a request arrives without a valid Origin header. */
export async function recordSuspiciousRequest(): Promise<void> {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return;
  try {
    const { kv } = await import("@vercel/kv");
    await incr(statsKey("suspicious"), kv);
  } catch { /* best-effort */ }
}
