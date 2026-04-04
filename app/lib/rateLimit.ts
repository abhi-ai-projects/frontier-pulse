/**
 * rateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side rate limiting for Frontier Pulse — rolling 24-hour window.
 *
 * Strategy:
 *   • Primary store: Vercel KV (Redis), keyed per IP *and* per browser fingerprint.
 *     Counting against whichever key has the higher usage ensures that incognito
 *     windows (new localStorage) don't bypass the cap on the same device.
 *   • Each key stores { firstUse: ms timestamp, count: number }.
 *     The 24-hour window starts from first use, not midnight UTC.
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

export const DAILY_LIMIT = 600; // TEMP: bumped for overnight batch test — revert to 10 after run
const WINDOW_MS           = 24 * 60 * 60 * 1000; // 24 h in ms
const TTL_SECONDS         = 90_000;               // 25 h — lets keys expire naturally after window

interface WindowRecord { firstUse: number; count: number; }

// ── In-memory fallback (local dev only) ──────────────────────────────────────
const memory = new Map<string, WindowRecord>();

/** KV key — no date suffix; window managed by firstUse timestamp.
 *  Uses fp:rl2 namespace to distinguish from legacy date-scoped fp:rl keys. */
function rlKey(prefix: string): string {
  return `fp:rl2:${prefix}`;
}

/** Returns the effective count — 0 if the record is missing or its 24h window has elapsed. */
function effectiveCount(rec: WindowRecord | null, now: number): number {
  if (!rec) return 0;
  if (now - rec.firstUse > WINDOW_MS) return 0;
  return rec.count;
}

export interface RateLimitResult {
  allowed:      boolean;
  attemptsLeft: number;
  /** Unix ms timestamp of the first request in this rolling window.
   *  Returned so the client can display an accurate reset time even when
   *  localStorage is empty (incognito, fresh browser, storage cleared). */
  windowStart:  number;
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
  const ipKey = rlKey(`ip:${ip}`);
  const fpKey = fingerprint ? rlKey(`fp:${fingerprint}`) : null;

  // ── Vercel KV path ────────────────────────────────────────────────────────
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");

      const [ipRec, fpRec] = await Promise.all([
        kv.get<WindowRecord>(ipKey),
        fpKey ? kv.get<WindowRecord>(fpKey) : Promise.resolve<WindowRecord | null>(null),
      ]);

      // Enforce the stricter of IP vs fingerprint
      const current = Math.max(effectiveCount(ipRec, now), effectiveCount(fpRec, now));
      if (current >= DAILY_LIMIT) {
        return { allowed: false, attemptsLeft: 0, windowStart: Date.now() };
      }

      const newCount = current + 1;

      // Preserve firstUse if still inside the window; otherwise this is a fresh start
      const ipFirstUse = (ipRec && now - ipRec.firstUse <= WINDOW_MS) ? ipRec.firstUse : now;
      const fpFirstUse = (fpRec && now - fpRec.firstUse <= WINDOW_MS) ? fpRec.firstUse : now;

      await Promise.all([
        kv.set<WindowRecord>(ipKey, { firstUse: ipFirstUse, count: newCount }, { ex: TTL_SECONDS }),
        fpKey
          ? kv.set<WindowRecord>(fpKey, { firstUse: fpFirstUse, count: newCount }, { ex: TTL_SECONDS })
          : Promise.resolve(),
      ]);

      // windowStart: fingerprint is the most reliable per-device signal; fall back to IP.
      // The client uses this to display an accurate reset time even across incognito sessions.
      const windowStart = fpKey ? fpFirstUse : ipFirstUse;
      return { allowed: true, attemptsLeft: DAILY_LIMIT - newCount, windowStart };
    } catch (err) {
      // KV outage — fail open so users aren't locked out.
      // Client-side localStorage gate still provides a UX-level fallback.
      console.error("[rateLimit] KV error — failing open:", err);
      return { allowed: true, attemptsLeft: 1, windowStart: Date.now() };
    }
  }

  // ── In-memory fallback (local dev) ────────────────────────────────────────
  const existing = memory.get(ipKey) ?? null;
  const current  = effectiveCount(existing, now);
  if (current >= DAILY_LIMIT) return { allowed: false, attemptsLeft: 0, windowStart: Date.now() };
  const firstUse = (existing && now - existing.firstUse <= WINDOW_MS) ? existing.firstUse : now;
  memory.set(ipKey, { firstUse, count: current + 1 });
  return { allowed: true, attemptsLeft: DAILY_LIMIT - (current + 1), windowStart: firstUse };
}
