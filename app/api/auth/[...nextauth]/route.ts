/**
 * app/api/auth/[...nextauth]/route.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NextAuth v5 catch-all route handler.
 * Handles: /api/auth/signin, /api/auth/callback/google, /api/auth/signout, etc.
 *
 * Wrapped explicitly to satisfy Next.js 16's stricter route handler types.
 */

import { handlers } from "@/auth";
import { NextRequest } from "next/server";

export function GET(req: NextRequest) {
  return handlers.GET(req);
}

export function POST(req: NextRequest) {
  return handlers.POST(req);
}
