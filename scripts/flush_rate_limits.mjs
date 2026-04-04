/**
 * flush_rate_limits.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * One-shot utility to clear all Frontier Pulse rate-limit keys from Vercel KV.
 * Useful for resetting your own count during development/testing.
 *
 * Usage (from project root):
 *   node scripts/flush_rate_limits.mjs
 *
 * Requires .env.local with:
 *   KV_REST_API_URL=...
 *   KV_REST_API_TOKEN=...
 *
 * All keys matching fp:rl2:* will be deleted.
 */

import { createClient } from "@vercel/kv";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load .env.local manually (no dotenv dependency needed)
try {
  const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of env.split("\n")) {
    const [k, ...rest] = line.split("=");
    if (k && rest.length) process.env[k.trim()] = rest.join("=").trim();
  }
} catch {
  // .env.local not found — rely on environment variables already set
}

const url   = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error("❌  KV_REST_API_URL and KV_REST_API_TOKEN must be set.");
  console.error("    Run: vercel env pull .env.local");
  process.exit(1);
}

const kv = createClient({ url, token });

async function flush() {
  console.log("🔍  Scanning for fp:rl2:* keys…");
  let cursor = 0;
  let total  = 0;

  do {
    // SCAN in batches of 100
    const [nextCursor, keys] = await kv.scan(cursor, { match: "fp:rl2:*", count: 100 });
    cursor = Number(nextCursor);

    if (keys.length > 0) {
      await Promise.all(keys.map(k => kv.del(k)));
      total += keys.length;
      console.log(`  Deleted ${keys.length} key(s): ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "…" : ""}`);
    }
  } while (cursor !== 0);

  console.log(`\n✅  Done. ${total} rate-limit key(s) cleared.`);
  if (total === 0) console.log("    (No keys found — KV may already be clean.)");
}

flush().catch(err => { console.error("Error:", err); process.exit(1); });
