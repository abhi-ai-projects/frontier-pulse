/**
 * route.ts  —  GET /api/status
 * ─────────────────────────────────────────────────────────────────────────────
 * Lightweight read-only endpoint that returns the current rate-limit state for
 * the requesting IP + fingerprint without incrementing the counter.
 *
 * Called on page mount so the client can sync the attempt counter immediately,
 * rather than waiting for the user to run a comparison first.
 *
 * Response: { attemptsLeft: number, windowStart: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getRateLimitStatus } from "@/app/lib/rateLimit";

export async function GET(req: NextRequest) {
  const ip          = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const fingerprint = req.headers.get("x-fp") ?? undefined;

  const { attemptsLeft, windowStart } = await getRateLimitStatus(ip, fingerprint);

  return NextResponse.json({ attemptsLeft, windowStart });
}
