"use client";

/**
 * Frontier Pulse — Admin Dashboard
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time usage monitor. Reads from /api/admin/stats every 30 seconds.
 *
 * Access: https://frontierpulse.org/admin?key=<ADMIN_SECRET>
 * The key is read from the URL query string and sent as the X-Admin-Key header.
 */

import { useEffect, useState, useCallback, useRef } from "react";

interface Stats {
  today: {
    comparisons:  number;
    rateLimited:  number;
    suspicious:   number;
    newBrowsers:  number;
  };
  allTime: { comparisons: number };
  generatedAt:  string;
}

const REFRESH_MS = 30_000; // 30 seconds

// ── Tiny helpers ─────────────────────────────────────────────────────────────

function Card({
  label, value, sub, accent,
}: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div style={{
      background: "#111",
      border: "1px solid #222",
      borderRadius: 12,
      padding: "22px 26px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      minWidth: 160,
    }}>
      <span style={{ fontSize: 12, color: "#555", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      <span style={{ fontSize: 36, fontWeight: 700, color: accent ?? "#fff", lineHeight: 1.1 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: 12, color: "#444" }}>{sub}</span>}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8,
      borderRadius: "50%", background: color, marginRight: 6,
      boxShadow: `0 0 6px ${color}`,
    }} />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [key, setKey]         = useState<string>("");
  const [stats, setStats]     = useState<Stats | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Read key from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setKey(params.get("key") ?? "");
  }, []);

  const fetchStats = useCallback(async (k: string) => {
    if (!k) { setError("No key provided. Add ?key=YOUR_ADMIN_SECRET to the URL."); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/stats?key=${encodeURIComponent(k)}`, {
        headers: { "X-Admin-Key": k },
        cache: "no-store",
      });
      if (res.status === 401) { setError("Invalid admin key."); setLoading(false); return; }
      if (!res.ok) { setError(`Server error ${res.status}.`); setLoading(false); return; }
      const data: Stats = await res.json();
      setStats(data);
      setError(null);
      setLastFetch(new Date());
      setCountdown(REFRESH_MS / 1000);
    } catch {
      setError("Network error — retrying…");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch when key is available
  useEffect(() => {
    if (key) fetchStats(key);
  }, [key, fetchStats]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!key) return;
    timerRef.current = setInterval(() => fetchStats(key), REFRESH_MS);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [key, fetchStats]);

  // Countdown tick
  useEffect(() => {
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [lastFetch]);

  const completionRate = stats
    ? stats.today.comparisons + stats.today.rateLimited === 0
      ? "—"
      : `${Math.round((stats.today.comparisons / (stats.today.comparisons + stats.today.rateLimited)) * 100)}%`
    : "—";

  const todayDate = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#fff",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      padding: "40px 32px",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Dot color={loading ? "#f59e0b" : error ? "#ef4444" : "#22c55e"} />
          <span style={{ fontSize: 11, color: "#444", letterSpacing: "0.06em" }}>
            {loading ? "REFRESHING" : error ? "ERROR" : "LIVE"}
          </span>
          {lastFetch && !loading && !error && (
            <span style={{ fontSize: 11, color: "#333", marginLeft: "auto" }}>
              next refresh in {countdown}s
            </span>
          )}
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          Frontier Pulse
        </h1>
        <p style={{ color: "#444", margin: "4px 0 0", fontSize: 13 }}>
          Admin · {todayDate} (UTC)
        </p>
      </div>

      {error && (
        <div style={{
          background: "#1a0000", border: "1px solid #3f0000",
          borderRadius: 8, padding: "14px 18px", marginBottom: 28,
          color: "#f87171", fontSize: 14,
        }}>
          {error}
        </div>
      )}

      {stats && (
        <>
          {/* Today's metrics */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>
              Today
            </h2>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Card
                label="Comparisons run"
                value={stats.today.comparisons}
                sub={`${completionRate} completion rate`}
                accent="#22c55e"
              />
              <Card
                label="New browsers"
                value={stats.today.newBrowsers}
                sub="unique fingerprints seen"
              />
              <Card
                label="Rate limited"
                value={stats.today.rateLimited}
                sub="quota-hit blocks"
                accent={stats.today.rateLimited > 0 ? "#f59e0b" : undefined}
              />
              <Card
                label="Suspicious"
                value={stats.today.suspicious}
                sub="non-browser / curl requests"
                accent={stats.today.suspicious > 5 ? "#ef4444" : stats.today.suspicious > 0 ? "#f59e0b" : undefined}
              />
            </div>
          </section>

          {/* All-time */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>
              All time
            </h2>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              <Card
                label="Total comparisons"
                value={stats.allTime.comparisons.toLocaleString()}
                sub="across all users since launch"
                accent="#a78bfa"
              />
            </div>
          </section>

          {/* Health signals */}
          <section style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>
              Health signals
            </h2>
            <div style={{
              background: "#111", border: "1px solid #222", borderRadius: 12,
              padding: "18px 22px", display: "flex", flexDirection: "column", gap: 12,
            }}>
              {[
                {
                  label: "Abuse signal",
                  ok: stats.today.suspicious < 10,
                  detail: stats.today.suspicious < 10
                    ? `${stats.today.suspicious} suspicious requests — looking clean`
                    : `${stats.today.suspicious} suspicious requests — possible scripted abuse`,
                },
                {
                  label: "Rate limit pressure",
                  ok: stats.today.rateLimited < stats.today.comparisons * 0.2,
                  detail: stats.today.rateLimited < stats.today.comparisons * 0.2
                    ? "Low — users aren't hitting the wall en masse"
                    : "High — many users hitting their 10-comparison limit",
                },
                {
                  label: "Engagement",
                  ok: stats.today.comparisons > 0,
                  detail: stats.today.comparisons === 0
                    ? "No comparisons yet today"
                    : `${stats.today.newBrowsers} new browsers · ${stats.today.comparisons} comparisons`,
                },
              ].map(({ label, ok, detail }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Dot color={ok ? "#22c55e" : "#ef4444"} />
                  <span style={{ fontSize: 13, color: "#aaa", minWidth: 160 }}>{label}</span>
                  <span style={{ fontSize: 13, color: "#555" }}>{detail}</span>
                </div>
              ))}
            </div>
          </section>

          {/* PostHog link */}
          <section>
            <h2 style={{ fontSize: 11, color: "#444", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
              Event-level analytics
            </h2>
            <a
              href="https://us.posthog.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", gap: 8,
                background: "#111", border: "1px solid #222",
                borderRadius: 8, padding: "10px 16px",
                color: "#a78bfa", textDecoration: "none", fontSize: 13,
              }}
            >
              Open PostHog dashboard →
            </a>
            <p style={{ fontSize: 12, color: "#333", marginTop: 8 }}>
              Tracks: prompt_submitted · comparison_complete · attempt_limit_reached · modal_opened
            </p>
          </section>

          <p style={{ fontSize: 11, color: "#2a2a2a", marginTop: 48 }}>
            Last fetched: {new Date(stats.generatedAt).toLocaleTimeString()} UTC ·
            Auto-refreshes every 30 s · {" "}
            <button
              onClick={() => fetchStats(key)}
              style={{ background: "none", border: "none", color: "#333", cursor: "pointer", fontSize: 11, padding: 0 }}
            >
              Refresh now
            </button>
          </p>
        </>
      )}

      {!stats && !error && !loading && (
        <p style={{ color: "#444" }}>Loading…</p>
      )}
    </div>
  );
}
