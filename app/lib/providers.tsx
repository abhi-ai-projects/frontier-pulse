"use client";

/**
 * providers.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side provider tree. Kept in a separate "use client" boundary so that
 * layout.tsx stays a Server Component (required for metadata exports in App Router).
 *
 * Wraps children with:
 *   • SessionProvider  — makes useSession() available throughout the app
 *   • PostHogProvider  — initialises PostHog analytics
 */

import { SessionProvider } from "next-auth/react";
import { PostHogProvider } from "./posthog";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <PostHogProvider>{children}</PostHogProvider>
    </SessionProvider>
  );
}
