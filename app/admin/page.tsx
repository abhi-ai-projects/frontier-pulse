"use client";

/**
 * Frontier Pulse — Admin Dashboard
 * Access: https://frontierpulse.org/admin?key=<ADMIN_SECRET>
 */

import { useEffect, useState, useCallback } from "react";
import type { GlobalStats } from "@/app/lib/rateLimit";

interface StatsResponse extends GlobalStats { generatedAt: string; }

const REFRESH_MS = 30_000;

// ── Tiny shared components ────────────────────────────────────────────────────

function Card({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"20px 22px", display:"flex", flexDirection:"column", gap:4, minWidth:150 }}>
      <span style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:"0.08em" }}>{label}</span>
      <span style={{ fontSize:32, fontWeight:700, color: accent ?? "#fff", lineHeight:1.1 }}>{value}</span>
      {sub && <span style={{ fontSize:11, color:"#3a3a3a" }}>{sub}</span>}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span style={{ display:"inline-block", width:8, height:8, borderRadius:"50%", background:color, marginRight:6, boxShadow:`0 0 5px ${color}` }} />;
}

function SectionHead({ children }: { children: string }) {
  return <h2 style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:"0.1em", margin:"0 0 14px" }}>{children}</h2>;
}

function ScorePill({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color:"#333", fontSize:13 }}>—</span>;
  const color = value >= 80 ? "#22c55e" : value >= 60 ? "#f59e0b" : "#ef4444";
  return <span style={{ color, fontSize:15, fontWeight:600 }}>{value}</span>;
}

function WinBar({ wins, total }: { wins: number; total: number }) {
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div style={{ flex:1, height:5, background:"#1e1e1e", borderRadius:3, overflow:"hidden" }}>
        <div style={{ height:"100%", width:`${pct}%`, background:"#a78bfa", borderRadius:3, transition:"width 0.4s" }} />
      </div>
      <span style={{ fontSize:12, color:"#666", minWidth:38 }}>{wins} ({pct}%)</span>
    </div>
  );
}

const FLAG: Record<string, string> = {
  US:"🇺🇸", IN:"🇮🇳", GB:"🇬🇧", CA:"🇨🇦", AU:"🇦🇺", DE:"🇩🇪", FR:"🇫🇷",
  SG:"🇸🇬", NL:"🇳🇱", JP:"🇯🇵", BR:"🇧🇷", MX:"🇲🇽", KR:"🇰🇷", SE:"🇸🇪",
  NO:"🇳🇴", CH:"🇨🇭", NZ:"🇳🇿", AE:"🇦🇪", IL:"🇮🇱", PL:"🇵🇱",
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [key, setKey]             = useState("");
  const [stats, setStats]         = useState<StatsResponse | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_MS / 1000);

  useEffect(() => {
    setKey(new URLSearchParams(window.location.search).get("key") ?? "");
  }, []);

  const fetchStats = useCallback(async (k: string) => {
    if (!k) { setError("No key — add ?key=YOUR_ADMIN_SECRET to the URL."); return; }
    setLoading(true);
    try {
      const res  = await fetch(`/api/admin/stats?key=${encodeURIComponent(k)}`, { headers: { "X-Admin-Key": k }, cache: "no-store" });
      if (res.status === 401) { setError("Invalid admin key."); return; }
      if (!res.ok)            { setError(`Server error ${res.status}.`); return; }
      setStats(await res.json());
      setError(null);
      setLastFetch(new Date());
      setCountdown(REFRESH_MS / 1000);
    } catch { setError("Network error — retrying…"); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { if (key) fetchStats(key); }, [key, fetchStats]);
  useEffect(() => {
    if (!key) return;
    const t = setInterval(() => fetchStats(key), REFRESH_MS);
    return () => clearInterval(t);
  }, [key, fetchStats]);
  useEffect(() => {
    if (!lastFetch) return;
    const t = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [lastFetch]);

  const s = stats;
  const totalWins = s
    ? (s.allTime.wins.claude.relevance + s.allTime.wins.openai.relevance + s.allTime.wins.gemini.relevance)
    : 0;

  const todayDate = new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric", timeZone:"UTC" });

  return (
    <div style={{ minHeight:"100vh", background:"#0a0a0a", color:"#fff", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,sans-serif", padding:"36px 28px" }}>

      {/* Header */}
      <div style={{ marginBottom:32 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
          <Dot color={loading ? "#f59e0b" : error ? "#ef4444" : "#22c55e"} />
          <span style={{ fontSize:11, color:"#444", letterSpacing:"0.06em" }}>
            {loading ? "REFRESHING" : error ? "ERROR" : "LIVE"}
          </span>
          {lastFetch && !loading && !error && (
            <span style={{ fontSize:11, color:"#2a2a2a", marginLeft:"auto" }}>next in {countdown}s</span>
          )}
        </div>
        <h1 style={{ fontSize:26, fontWeight:700, margin:0, letterSpacing:"-0.02em" }}>Frontier Pulse</h1>
        <p style={{ color:"#444", margin:"4px 0 0", fontSize:12 }}>Admin · {todayDate} (UTC)</p>
      </div>

      {error && (
        <div style={{ background:"#1a0000", border:"1px solid #3f0000", borderRadius:8, padding:"12px 16px", marginBottom:24, color:"#f87171", fontSize:13 }}>
          {error}
        </div>
      )}

      {s && (
        <>
          {/* ── Today ── */}
          <section style={{ marginBottom:36 }}>
            <SectionHead>Today (UTC)</SectionHead>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
              <Card label="Comparisons" value={s.today.comparisons} sub={`${s.today.newBrowsers} new browsers`} accent="#22c55e" />
              <Card label="New browsers" value={s.today.newBrowsers} sub="unique fingerprints" />
              <Card label="Rate limited" value={s.today.rateLimited} accent={s.today.rateLimited > 0 ? "#f59e0b" : undefined} />
              <Card label="Suspicious" value={s.today.suspicious} sub="blocked at Origin check" accent={s.today.suspicious > 5 ? "#ef4444" : s.today.suspicious > 0 ? "#f59e0b" : undefined} />
            </div>
          </section>

          {/* ── All-time headline ── */}
          <section style={{ marginBottom:36 }}>
            <SectionHead>All time</SectionHead>
            <div style={{ display:"flex", gap:12, flexWrap:"wrap" }}>
              <Card label="Total comparisons" value={s.allTime.comparisons.toLocaleString()} accent="#a78bfa" />
              <Card
                label="Task split"
                value={`${s.allTime.tasks.write + s.allTime.tasks.analyze + s.allTime.tasks.decide}`}
                sub={`Write ${s.allTime.tasks.write} · Analyze ${s.allTime.tasks.analyze} · Decide ${s.allTime.tasks.decide}`}
              />
            </div>
          </section>

          {/* ── Avg scores ── */}
          <section style={{ marginBottom:36 }}>
            <SectionHead>Average scores (0–100)</SectionHead>
            <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid #1e1e1e" }}>
                    {["Model","Relevance","Faithfulness","Safety","Avg ms"].map(h => (
                      <th key={h} style={{ padding:"10px 16px", textAlign: h === "Model" ? "left" : "right", color:"#444", fontWeight:500, fontSize:11, letterSpacing:"0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(["claude","openai","gemini"] as const).map((m, i) => {
                    const sc = s.allTime.avgScores[m];
                    const avgAll = (sc.relevance !== null && sc.faithfulness !== null && sc.safety !== null)
                      ? Math.round((sc.relevance + sc.faithfulness + sc.safety) / 3) : null;
                    const labels: Record<string, string> = { claude:"Claude Sonnet", openai:"GPT-5.4", gemini:"Gemini 3.1" };
                    const colors: Record<string, string> = { claude:"#d4a574", openai:"#74b9d4", gemini:"#74d4a0" };
                    return (
                      <tr key={m} style={{ borderBottom: i < 2 ? "1px solid #1a1a1a" : undefined }}>
                        <td style={{ padding:"12px 16px", color: colors[m], fontWeight:500 }}>{labels[m]}</td>
                        <td style={{ padding:"12px 16px", textAlign:"right" }}><ScorePill value={sc.relevance} /></td>
                        <td style={{ padding:"12px 16px", textAlign:"right" }}><ScorePill value={sc.faithfulness} /></td>
                        <td style={{ padding:"12px 16px", textAlign:"right" }}><ScorePill value={sc.safety} /></td>
                        <td style={{ padding:"12px 16px", textAlign:"right", color:"#555", fontSize:12 }}>
                          {s.allTime.avgTiming[m] !== null ? `${(s.allTime.avgTiming[m]! / 1000).toFixed(1)}s` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Overall avg row */}
                  {(() => {
                    const allVals = (["claude","openai","gemini"] as const).flatMap(m => {
                      const sc = s.allTime.avgScores[m];
                      return [sc.relevance, sc.faithfulness, sc.safety].filter(v => v !== null) as number[];
                    });
                    const overall = allVals.length ? Math.round(allVals.reduce((a,b) => a+b, 0) / allVals.length) : null;
                    return (
                      <tr style={{ borderTop:"1px solid #222", background:"rgba(255,255,255,0.01)" }}>
                        <td style={{ padding:"10px 16px", color:"#555", fontSize:11, fontStyle:"italic" }}>overall avg</td>
                        <td colSpan={3} style={{ padding:"10px 16px", textAlign:"right" }}>
                          {overall !== null ? <span style={{ color:"#888", fontWeight:600 }}>{overall}</span> : <span style={{ color:"#333" }}>—</span>}
                        </td>
                        <td />
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Model win rates ── */}
          <section style={{ marginBottom:36 }}>
            <SectionHead>Model win rates (unique-best per comparison)</SectionHead>
            <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"20px 22px", display:"flex", flexDirection:"column", gap:14 }}>
              {(["relevance","faithfulness","safety"] as const).map(metric => {
                const wins = { claude: s.allTime.wins.claude[metric], openai: s.allTime.wins.openai[metric], gemini: s.allTime.wins.gemini[metric] };
                const tot = wins.claude + wins.openai + wins.gemini;
                return (
                  <div key={metric}>
                    <div style={{ fontSize:11, color:"#444", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8 }}>{metric}</div>
                    {(["claude","openai","gemini"] as const).map(m => {
                      const labels: Record<string, string> = { claude:"Claude", openai:"GPT", gemini:"Gemini" };
                      return (
                        <div key={m} style={{ display:"grid", gridTemplateColumns:"72px 1fr", alignItems:"center", gap:8, marginBottom:4 }}>
                          <span style={{ fontSize:12, color:"#555" }}>{labels[m]}</span>
                          <WinBar wins={wins[m as keyof typeof wins]} total={tot} />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Geography ── */}
          <section style={{ marginBottom:36 }}>
            <SectionHead>Usage by country</SectionHead>
            {s.allTime.topCountries.length === 0 ? (
              <p style={{ color:"#333", fontSize:13 }}>No data yet.</p>
            ) : (
              <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, overflow:"hidden" }}>
                {s.allTime.topCountries.map(({ code, count }, i) => {
                  const max = s.allTime.topCountries[0].count;
                  const pct = Math.round((count / max) * 100);
                  return (
                    <div key={code} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 18px", borderBottom: i < s.allTime.topCountries.length - 1 ? "1px solid #1a1a1a" : undefined }}>
                      <span style={{ fontSize:18, lineHeight:1 }}>{FLAG[code] ?? "🌍"}</span>
                      <span style={{ fontSize:13, color:"#aaa", minWidth:36 }}>{code}</span>
                      <div style={{ flex:1, height:4, background:"#1e1e1e", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:"#a78bfa", borderRadius:2 }} />
                      </div>
                      <span style={{ fontSize:12, color:"#555", minWidth:28, textAlign:"right" }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Health ── */}
          <section style={{ marginBottom:36 }}>
            <SectionHead>Health signals</SectionHead>
            <div style={{ background:"#111", border:"1px solid #1e1e1e", borderRadius:12, padding:"18px 22px", display:"flex", flexDirection:"column", gap:10 }}>
              {[
                { label:"Abuse signal",         ok: s.today.suspicious < 10,  detail: s.today.suspicious < 10  ? `${s.today.suspicious} suspicious today — clean` : `${s.today.suspicious} suspicious — possible scripted abuse` },
                { label:"Rate limit pressure",  ok: s.today.comparisons === 0 || s.today.rateLimited < s.today.comparisons * 0.3, detail: s.today.comparisons === 0 ? "No comparisons yet" : `${s.today.rateLimited} blocked vs ${s.today.comparisons} successful` },
                { label:"Coverage",             ok: s.allTime.topCountries.length > 1, detail: `${s.allTime.topCountries.length} countries seen` },
              ].map(({ label, ok, detail }) => (
                <div key={label} style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <Dot color={ok ? "#22c55e" : "#ef4444"} />
                  <span style={{ fontSize:13, color:"#888", minWidth:160 }}>{label}</span>
                  <span style={{ fontSize:12, color:"#444" }}>{detail}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ── PostHog link ── */}
          <section style={{ marginBottom:24 }}>
            <SectionHead>Event-level analytics</SectionHead>
            <a href="https://us.posthog.com" target="_blank" rel="noopener noreferrer"
              style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#111", border:"1px solid #1e1e1e", borderRadius:8, padding:"9px 14px", color:"#a78bfa", textDecoration:"none", fontSize:12 }}>
              Open PostHog →
            </a>
            <p style={{ fontSize:11, color:"#2a2a2a", marginTop:6 }}>
              prompt_submitted · comparison_complete · attempt_limit_reached · modal_opened
            </p>
          </section>

          <p style={{ fontSize:11, color:"#222", marginTop:40 }}>
            Last fetched: {new Date(s.generatedAt).toLocaleTimeString()} UTC ·{" "}
            <button onClick={() => fetchStats(key)} style={{ background:"none", border:"none", color:"#333", cursor:"pointer", fontSize:11, padding:0 }}>
              Refresh now
            </button>
          </p>
        </>
      )}

      {!s && !error && !loading && <p style={{ color:"#444" }}>Loading…</p>}
    </div>
  );
}
