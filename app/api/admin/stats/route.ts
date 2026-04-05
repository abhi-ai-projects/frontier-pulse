/**
 * GET /api/admin/stats
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns aggregate usage metrics for the admin dashboard.
 *
 * Authentication: requires the X-Admin-Key header (or ?key= query param)
 * to match the ADMIN_SECRET environment variable set in Vercel.
 *
 * Response shape:
 *   {
 *     today: { comparisons, rateLimited, suspicious, newBrowsers },
 *     allTime: { comparisons },
 *     generatedAt: ISO timestamp,
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { getGlobalStats } from "@/app/lib/rateLimit";

export async function GET(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Admin access not configured." }, { status: 503 });
  }

  const provided =
    req.headers.get("x-admin-key") ??
    new URL(req.url).searchParams.get("key") ??
    "";

  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = await getGlobalStats();

  return NextResponse.json(
    { ...stats, generatedAt: new Date().toISOString() },
    {
      headers: {
        // Never cache — always show live data
        "Cache-Control": "no-store",
      },
    },
  );
}
