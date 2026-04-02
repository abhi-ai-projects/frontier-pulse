/**
 * rateLimit.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side daily rate limiting for Frontier Pulse.
 *
 * Limits:
 *   Anonymous users       — ANON_LIMIT  (5)  keyed by IP + browser fingerprint
 *   Authenticated users   — AUTH_LIMIT  (20) keyed by email address
 *
 * Strategy:
 *   • Primary store: Vercel KV (Redis), keyed per IP *and* per browser fingerprint.
 *     Counting against whichever key has the higher usage ensures that incognito
 *     windows (new localStorage) don't bypass the daily cap on the same device.
 *   • When a verified userId (email) is provided, the email key is used instead,
 *     and the higher AUTH_LIMIT applies.
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

export const ANON_LIMIT = 5;   // daily cap for anonymous (no Google login)
export const AUTH_LIMIT = 20;  // daily cap for authenticated users

/** @deprecated Use ANON_LIMIT directly; kept for backwards compat with existing imports */
export const DAILY_LIMIT = ANON_LIMIT;

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
  limit: number;        // the daily limit that applies (ANON_LIMIT or AUTH_LIMIT)
  authenticated: boolean;
}

/**
 * Check and increment the daily quota.
 *
 * @param ip          Client IP (from x-forwarded-for)
 * @param fingerprint Browser fingerprint hash (anti-incognito bypass)
 * @param batchKey    Batch-test bypass secret
 * @param userId      Authenticated user email — if provided, uses AUTH_LIMIT and
 *                    keys solely by email (IP/fp not checked for authed users)
 */
export async function checkRateLimit(
  ip: string,
  fingerprint?: string,
  batchKey?: string,
  userId?: string,
): Promise<RateLimitResult> {
  // ── Batch-test bypass ─────────────────────────────────────────────────────
  const secret = process.env.BATCH_SECRET;
  if (secret && batchKey === secret) {
    return { allowed: true, attemptsLeft: AUTH_LIMIT, limit: AUTH_LIMIT, authenticated: false };
  }

  const authenticated = Boolean(userId);
  const limit         = authenticated ? AUTH_LIMIT : ANON_LIMIT;

  // ── Vercel KV path ────────────────────────────────────────────────────────
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = await import("@vercel/kv");

      if (authenticated && userId) {
        // ── Authenticated: single email-scoped key ──────────────────────────
        const emailKey = todayKey(`user:${userId}`);
        const count    = (await kv.get<number>(emailKey)) ?? 0;
        if (count >= AUTH_LIMIT) {
          return { allowed: false, attemptsLeft: 0, limit, authenticated };
        }
        await kv.incr(emailKey).then(() => kv.expire(emailKey, TTL_SECONDS));
        return { allowed: true, attemptsLeft: AUTH_LIMIT - (count + 1), limit, authenticated };
      }

      // ── Anonymous: enforce stricter of IP vs fingerprint ──────────────────
      const ipKey = todayKey(`ip:${ip}`);
      const fpKey = fingerprint ? todayKey(`fp:${fingerprint}`) : null;

      const [ipCount, fpCount] = await Promise.all([
        kv.get<number>(ipKey),
        fpKey ? kv.get<number>(fpKey) : Promise.resolve<number | null>(null),
      ]);

      const current = Math.max(ipCount ?? 0, fpCount ?? 0);
      if (current >= ANON_LIMIT) {
        return { allowed: false, attemptsLeft: 0, limit, authenticated };
      }

      await Promise.all([
        kv.incr(ipKey).then(() => kv.expire(ipKey, TTL_SECONDS)),
        fpKey
          ? kv.incr(fpKey).then(() => kv.expire(fpKey, TTL_SECONDS))
          : Promise.resolve(),
      ]);

      return { allowed: true, attemptsLeft: ANON_LIMIT - (current + 1), limit, authenticated };
    } catch (err) {
      // On a KV outage, fail open rather than locking all users out.
      console.error("[rateLimit] KV error — failing open:", err);
      return { allowed: true, attemptsLeft: 1, limit, authenticated };
    }
  }

  // ── In-memory fallback ────────────────────────────────────────────────────
  const key     = authenticated && userId ? todayKey(`user:${userId}`) : todayKey(`ip:${ip}`);
  const current = memory.get(key) ?? 0;
  if (current >= limit) return { allowed: false, attemptsLeft: 0, limit, authenticated };
  memory.set(key, current + 1);
  return { allowed: true, attemptsLeft: limit - (current + 1), limit, authenticated };
}
