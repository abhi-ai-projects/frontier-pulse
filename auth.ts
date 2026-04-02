/**
 * auth.ts  —  NextAuth v5 (Auth.js) configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for authentication. Exports `auth`, `signIn`,
 * `signOut` for use in Server Components / Route Handlers, and `handlers`
 * for the catch-all API route.
 *
 * Required env vars (add via Vercel Dashboard → Project → Settings → Env):
 *   AUTH_SECRET          — random string, signs JWTs (generate: `npx auth secret`)
 *   GOOGLE_CLIENT_ID     — from Google Cloud Console OAuth 2.0 credentials
 *   GOOGLE_CLIENT_SECRET — same
 *
 * Authorized redirect URI to add in Google Cloud Console:
 *   https://frontier-pulse.vercel.app/api/auth/callback/google
 *   (also add http://localhost:3000/api/auth/callback/google for local dev)
 */

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  // JWT sessions — no database required
  session: { strategy: "jwt" },

  callbacks: {
    // Expose the user's email in the JWT so route handlers can read it
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email;
      return token;
    },
    async session({ session, token }) {
      if (token.email) session.user.email = token.email as string;
      return session;
    },
  },

  // Suppress default sign-in page — we handle auth via gate modal / nav button
  pages: {},
});
