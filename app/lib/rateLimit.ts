/**
 * rateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side daily rate limiting for Frontier Pulse.
 *
 * Strategy:
 *   • Primary store: Vercel KV (Redis), keyed per IP *and* per browser fingerprint.
 *     Counting against whichever key has the higher usage ensures that incognito
 *     windows (new localStorage) don't bypass the daily cap on the same device.
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

export const DAILY_LIMIT = 5;
const TTL_SECONDS = 86_400; // 24 h — keys auto-expire so no manual cleanup needed

// ── In-memory fallback (local dev only) ──────────────────────────────────────
const memory = new Map<string, number>();

/** Returns a KV key scoped to today's UTC date so counters reset at midnight UTC. */
function todayKey(prefix: string): string {
  const date = new Date().toISOString().slice(0, 10); // e.g. "2026-04-01"
  return `fp:rl:${prefix}:${date}`;
}

export interface RateLimitResult {
  allowed: boolean;
  attemptsLeft: number; // how many requests remain today (0 when denied)
}

/**
 * Check and increment the daily quota for an IP + optional browser fingerprint.
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
    return { allowed: true, attemptsLeft: DAILY_LIMIT };
  }

  const ipKey = todayKey(`ip:${ip}`);
  const fpKey = fingerprint ? todayKey(`fp:${fingerprint}`) : null;

  // ── Vercel KV path ────────────────────────────────────────────────────────
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");

      // Read both counters in parallel
      const [ipCount, fpCount] = await Promise.all([
        kv.get<number>(ipKey),
        fpKey ? kv.get<number>(fpKey) : Promise.resolve<number | null>(null),
      ]);

      // Enforce the stricter of the two (IP or fingerprint)
      const current = Math.max(ipCount ?? 0, fpCount ?? 0);
      if (current >= DAILY_LIMIT) {
        return { allowed: false, attemptsLeft: 0 };
      }

      // Increment both keys and set a 24-hour TTL
      await Promise.all([
        kv.incr(ipKey).then(() => kv.expire(ipKey, TTL_SECONDS)),
        fpKey
          ? kv.incr(fpKey).then(() => kv.expire(fpKey, TTL_SECONDS))
          : Promise.resolve(),
      ]);

      return { allowed: true, attemptsLeft: DAILY_LIMIT - (current + 1) };
    } catch (err) {
      // On a KV outage, fail open rather than locking all users out.
      // The localStorage client-side gate still provides a UX-level limit.
      console.error("[rateLimit] KV error — failing open:", err);
      return { allowed: true, attemptsLeft: 1 };
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const current = memory.get(ipKey) ?? 0;
  if (current >= DAILY_LIMIT) return { allowed: false, attemptsLeft: 0 };
  memory.set(ipKey, current + 1);
  return { allowed: true, attemptsLeft: DAILY_LIMIT - (current + 1) };
}
