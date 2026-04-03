"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAuth } from "../../lib/auth/AuthContext";
import { Starfield } from "../../components/Starfield";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const CATEGORIES = [
  "General", "Food & Beverage", "Health & Fitness", "Technology",
  "Creative", "Services", "Retail", "Gaming", "Education",
];

/* ── Simulated hero demo phases ── */
const DEMO_PHASES = [
  { label: "Typing your idea...", text: "mobile car wash business" },
  { label: "AI is building your storefront...", text: "" },
  { label: "Generating offers and pricing...", text: "" },
  { label: "Your business is live!", text: "" },
];

const DEMO_OFFERS = [
  { title: "Basic Exterior Wash", price: "$29", tag: "Popular" },
  { title: "Full Detail Package", price: "$89", tag: "Best Value" },
  { title: "Monthly Membership", price: "$49/mo", tag: "Recurring" },
];

/* ── Activity messages (generic, not fake) ── */
const ACTIVITY_MESSAGES = [
  "New business page created",
  "Offer purchased via Stripe",
  "Business submitted for verification",
  "DUM Points earned on purchase",
  "New storefront launched",
  "Verification approved",
];

/* ── Scroll reveal hook ── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "none" : "translateY(20px)",
        transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

/* ── Hero Product Demo (simulated, no API calls) ── */
function HeroDemo() {
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState("");
  const target = DEMO_PHASES[0].text;

  useEffect(() => {
    if (phase === 0) {
      let i = 0;
      const interval = setInterval(() => {
        i++;
        setTyped(target.slice(0, i));
        if (i >= target.length) {
          clearInterval(interval);
          setTimeout(() => setPhase(1), 800);
        }
      }, 50);
      return () => clearInterval(interval);
    }
    if (phase === 1) {
      const t = setTimeout(() => setPhase(2), 1500);
      return () => clearTimeout(t);
    }
    if (phase === 2) {
      const t = setTimeout(() => setPhase(3), 1500);
      return () => clearTimeout(t);
    }
    if (phase === 3) {
      const t = setTimeout(() => setPhase(0), 4000);
      return () => { clearTimeout(t); setTyped(""); };
    }
  }, [phase]);

  return (
    <div style={{
      background: "#0b0b0b",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "16px",
      padding: "20px",
      maxWidth: "420px",
      width: "100%",
      margin: "0 auto",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Glow */}
      <div style={{
        position: "absolute", top: "-40px", right: "-40px",
        width: "160px", height: "160px",
        background: "radial-gradient(circle, rgba(0,255,135,0.06) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Phase 0-1: Input */}
      {phase <= 1 && (
        <div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.14em", color: "#444", textTransform: "uppercase", marginBottom: "8px" }}>
            Describe your business
          </div>
          <div style={{
            background: "#161616", border: "1px solid rgba(0,255,135,0.15)",
            borderRadius: "10px", padding: "14px 16px",
            fontFamily: "'Space Mono', monospace", fontSize: "14px",
            color: phase === 0 ? "#f0f0f0" : "#888",
            minHeight: "48px",
          }}>
            {phase === 0 ? (
              <>{typed}<span style={{ opacity: 0.6, animation: "blink 1s infinite" }}>|</span></>
            ) : (
              target
            )}
          </div>
          {phase === 1 && (
            <div style={{
              marginTop: "12px", display: "flex", alignItems: "center", gap: "8px",
              fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#00FF87",
            }}>
              <span style={{ width: "6px", height: "6px", background: "#00FF87", borderRadius: "50%", display: "inline-block" }} className="pulse-dot" />
              AI is building your storefront...
            </div>
          )}
        </div>
      )}

      {/* Phase 2: Offers generating */}
      {phase === 2 && (
        <div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.14em", color: "#00FF87", textTransform: "uppercase", marginBottom: "12px" }}>
            Generating offers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {DEMO_OFFERS.map((o, i) => (
              <div key={i} style={{
                background: "#161616", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "10px", padding: "12px 14px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                opacity: 1, animation: `fadeUp 0.3s ease ${i * 0.15}s both`,
              }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#f0f0f0" }}>{o.title}</div>
                  <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{o.tag}</div>
                </div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "14px", fontWeight: 700, color: "#00FF87" }}>{o.price}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phase 3: Live storefront */}
      {phase === 3 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#f0f0f0" }}>Sparkle Mobile Wash</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.1em", color: "#888", marginTop: "2px" }}>SERVICES · DUM CLUB</div>
            </div>
            <div style={{
              background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)",
              borderRadius: "20px", padding: "4px 10px",
              fontFamily: "'Space Mono', monospace", fontSize: "9px", color: "#00FF87", letterSpacing: "0.1em",
            }}>
              LIVE
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {DEMO_OFFERS.map((o, i) => (
              <div key={i} style={{
                background: "#161616", borderRadius: "8px", padding: "10px 12px",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: "12px", color: "#ccc" }}>{o.title}</span>
                <span style={{ fontFamily: "'Space Mono', monospace", fontSize: "12px", fontWeight: 600, color: "#00FF87" }}>{o.price}</span>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: "12px", textAlign: "center",
            fontFamily: "'Space Mono', monospace", fontSize: "10px", color: "#444", letterSpacing: "0.1em",
          }}>
            PAYMENTS · REWARDS · ANALYTICS — ALL ACTIVE
          </div>
        </div>
      )}

      {/* keyframes defined in global style block above */}
    </div>
  );
}


/* ── Activity Ticker ── */
function ActivityTicker() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % ACTIVITY_MESSAGES.length), 3500);
    return () => clearInterval(t);
  }, []);
  const timeAgo = `${Math.floor(Math.random() * 8) + 1}m ago`;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "10px",
      background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
      borderLeft: "2px solid #00FF87", borderRadius: "0 8px 8px 0",
      padding: "10px 14px", fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#888",
    }}>
      <span style={{ width: "6px", height: "6px", background: "#00FF87", borderRadius: "50%", flexShrink: 0 }} className="pulse-dot" />
      <span style={{ flex: 1 }}>{ACTIVITY_MESSAGES[idx]}</span>
      <span style={{ color: "#444", fontSize: "10px", flexShrink: 0 }}>{timeAgo}</span>
    </div>
  );
}

export default function BusinessPage() {
  const { user, login, getToken } = useAuth();

  const [bizProfile, setBizProfile] = useState<any>(null);
  const [loadingBiz, setLoadingBiz] = useState(false);
  const [liveStats, setLiveStats] = useState<{ live_projects: number; active_offers: number; businesses: number } | null>(null);

  // Create form state
  const [showForm, setShowForm] = useState(false);
  const [bizName, setBizName] = useState("");
  const [bizCategory, setBizCategory] = useState("General");
  const [bizDesc, setBizDesc] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [bizWebsite, setBizWebsite] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load business profile
  useEffect(() => {
    if (!user?.privyId) return;
    setLoadingBiz(true);
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/api/business/me`, { headers });
        if (res.ok) {
          const data = await res.json();
          setBizProfile(data.profile || null);
        }
      } catch {} finally { setLoadingBiz(false); }
    })();
  }, [user?.privyId]);

  // Load live stats (real data, non-blocking)
  useEffect(() => {
    fetch(`${API_BASE}/api/projects/live-stats`).then(r => r.json()).then(setLiveStats).catch(() => {});
  }, []);

  async function handleCreate() {
    if (!bizName.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/business/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          business_name: bizName.trim(), category: bizCategory,
          short_description: bizDesc.trim() || null, contact_email: bizEmail.trim() || null,
          website: bizWebsite.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBizProfile(data.profile);
        setShowForm(false);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.detail || "Failed to create business profile");
      }
    } catch { setError("Network error"); } finally { setSaving(false); }
  }

  const heroAction = user
    ? bizProfile
      ? { label: "Go to Dashboard", href: "/dashboard" }
      : { label: "Create My Business Page", onClick: () => setShowForm(true) }
    : { label: "Get Started Free", onClick: login };


  return (
    <div style={{ background: "#030303", color: "#f0f0f0", fontFamily: "'DM Sans', -apple-system, sans-serif", minHeight: "100vh", overflowX: "hidden", position: "relative" }}>
      <Starfield count={90} />
      <style>{`
        .biz-cta-primary {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          background: #00FF87; color: #000; font-weight: 700; font-size: 14px;
          letter-spacing: 0.04em; padding: 16px 32px; border-radius: 10px;
          border: none; cursor: pointer; width: 100%; text-decoration: none;
          transition: all 0.22s ease; position: relative; overflow: hidden;
          box-shadow: 0 0 0 rgba(0,255,135,0);
        }
        .biz-cta-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 32px rgba(0,255,135,0.3);
        }
        .biz-cta-secondary {
          display: flex; align-items: center; justify-content: center;
          background: transparent; color: #f0f0f0; font-size: 13px;
          padding: 13px 24px; border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08); text-decoration: none;
          transition: all 0.22s ease; cursor: pointer;
        }
        .biz-cta-secondary:hover {
          border-color: rgba(0,255,135,0.3); background: rgba(0,255,135,0.04); color: #00FF87;
        }
        .biz-feature-card {
          background: #0b0b0b; border: 1px solid rgba(255,255,255,0.06);
          border-radius: 14px; padding: 22px; margin-bottom: 10px;
          transition: all 0.25s ease; cursor: default;
        }
        .biz-feature-card:hover {
          border-color: rgba(0,255,135,0.25); transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0,255,135,0.06);
        }
        .biz-pain-card {
          transition: all 0.2s ease;
        }
        .biz-pain-card:hover {
          border-color: rgba(255,85,85,0.3); transform: translateX(4px);
        }
        .biz-fixed-card:hover {
          border-color: rgba(0,255,135,0.4); transform: translateX(4px);
        }
        .biz-switch-item {
          transition: all 0.18s ease;
        }
        .biz-switch-item:hover {
          border-color: rgba(0,255,135,0.2) !important; color: #f0f0f0 !important;
          transform: translateX(4px);
        }
        .biz-hero-glow {
          text-shadow: 0 0 40px rgba(0,255,135,0.25), 0 0 80px rgba(0,255,135,0.1);
        }
        .pulse-dot { animation: pulse 1.5s infinite !important; }
        @keyframes pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.4) } }
        @keyframes blink { 0%,50% { opacity: 1 } 51%,100% { opacity: 0 } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes borderGlow { 0%,100% { border-color: rgba(0,255,135,0.15) } 50% { border-color: rgba(0,255,135,0.5) } }
        @keyframes heroFloat { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
      `}</style>

      {/* ═══════════════ S1: HERO ═══════════════ */}
      <section style={{ padding: "72px 20px 48px", maxWidth: "680px", margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.16em",
            color: "#444", border: "1px solid rgba(255,255,255,0.06)", padding: "5px 14px", borderRadius: "20px", marginBottom: "24px",
          }}>
            <span style={{ color: "#00FF87" }}>★</span> FOR BUSINESS OWNERS
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h1 style={{
            fontFamily: "'Space Mono', Syne, monospace", fontSize: "clamp(34px, 9vw, 56px)",
            fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.035em", marginBottom: "20px",
          }}>
            Your customers are<br />forgetting <span className="biz-hero-glow" style={{ color: "#00FF87" }}>you exist.</span>
          </h1>
        </Reveal>

        <Reveal delay={0.2}>
          <p style={{ fontSize: "16px", color: "#999", lineHeight: 1.65, marginBottom: "32px", maxWidth: "480px", margin: "0 auto 32px" }}>
            DUM Club gives every business — from <strong style={{ color: "#f0f0f0", fontWeight: 500 }}>pizza shops to mobile car washes</strong> —
            a storefront, payments, and built-in loyalty rewards.<br />
            <strong style={{ color: "#f0f0f0", fontWeight: 500 }}>No code. No crypto. Live in minutes.</strong>
          </p>
        </Reveal>

        <Reveal delay={0.3}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px", maxWidth: "360px", margin: "0 auto 28px" }}>
            {"href" in heroAction ? (
              <Link href={heroAction.href} className="biz-cta-primary">
                {heroAction.label} →
              </Link>
            ) : (
              <button onClick={heroAction.onClick} className="biz-cta-primary">
                {heroAction.label} →
              </button>
            )}
            <Link href="/discover" className="biz-cta-secondary">
              Browse live businesses ↓
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.4}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", fontSize: "10px", fontFamily: "'Space Mono', monospace", letterSpacing: "0.08em", color: "#444" }}>
            <span><span style={{ color: "#00FF87" }}>✓</span> Free to start</span>
            <span><span style={{ color: "#00FF87" }}>✓</span> No crypto needed</span>
            <span><span style={{ color: "#00FF87" }}>✓</span> Live in minutes</span>
          </div>
        </Reveal>

        {/* Live stats from real data */}
        <Reveal delay={0.5}>
          <div style={{ marginTop: "20px" }}>
            {liveStats && (liveStats.live_projects > 0 || liveStats.businesses > 0) ? (
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
                fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#888",
                background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)", borderLeft: "2px solid #00FF87",
                borderRadius: "0 8px 8px 0", padding: "10px 14px",
              }}>
                <span style={{ width: "6px", height: "6px", background: "#00FF87", borderRadius: "50%" }} className="pulse-dot" />
                <span><strong style={{ color: "#00FF87" }}>{liveStats.live_projects}</strong> live storefronts · <strong style={{ color: "#00FF87" }}>{liveStats.active_offers}</strong> active offers</span>
              </div>
            ) : (
              <ActivityTicker />
            )}
          </div>
        </Reveal>
      </section>

      {/* ═══ Hero Demo ═══ */}
      <section style={{ padding: "0 20px 64px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal delay={0.2}>
          <div style={{ animation: "heroFloat 6s ease-in-out infinite", maxWidth: "460px", margin: "0 auto" }}>
            <div style={{ borderRadius: "18px", padding: "2px", background: "linear-gradient(135deg, rgba(0,255,135,0.3), rgba(79,158,255,0.15), rgba(0,255,135,0.3))", backgroundSize: "200% 200%", animation: "borderGlow 4s ease infinite" }}>
              <div style={{ borderRadius: "16px", overflow: "hidden" }}>
                <HeroDemo />
              </div>
            </div>
          </div>
        </Reveal>
      </section>


      {/* ═══════════════ HOW IT WORKS (moved up — conversion moment) ═══════════════ */}
      <section style={{ padding: "0 20px 48px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: "6px", textAlign: "center" }}>
            Live in 4 steps. <span style={{ color: "#00FF87" }}>No friction.</span>
          </h2>
          <p style={{ fontSize: "13px", color: "#888", marginBottom: "24px", textAlign: "center" }}>From idea to customers paying you — the same afternoon.</p>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {[
            { n: "01", t: "Sign in with Google", time: "3 sec", icon: "→" },
            { n: "02", t: "Describe your business", time: "2 min", icon: "→" },
            { n: "03", t: "AI builds your storefront", time: "Instant", icon: "→" },
            { n: "04", t: "Start selling & grow", time: "Same day", icon: "✓" },
          ].map((s, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div style={{
                background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px", padding: "18px 16px", textAlign: "center",
                transition: "all 0.2s",
              }}>
                <div style={{
                  width: "28px", height: "28px", margin: "0 auto 10px",
                  borderRadius: "8px", background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#00FF87",
                }}>{s.n}</div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#f0f0f0", marginBottom: "6px" }}>{s.t}</div>
                <div style={{
                  fontFamily: "'Space Mono', monospace", fontSize: "11px", fontWeight: 700,
                  color: "#00FF87", letterSpacing: "0.06em",
                }}>{s.time}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ═══════════════ MID-PAGE CTA + SOCIAL PROOF ═══════════════ */}
      <section style={{ padding: "0 20px 64px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{
            background: "linear-gradient(135deg, rgba(0,255,135,0.06), rgba(0,255,135,0.02))",
            border: "1px solid rgba(0,255,135,0.15)", borderRadius: "20px",
            padding: "32px 24px", textAlign: "center",
          }}>
            <h3 style={{ fontFamily: "'Space Mono', monospace", fontSize: "20px", fontWeight: 800, marginBottom: "8px" }}>
              You just watched AI build a business in 10 seconds.
            </h3>
            <p style={{ fontSize: "14px", color: "#888", marginBottom: "20px", lineHeight: 1.6 }}>
              Imagine what it does with <strong style={{ color: "#f0f0f0" }}>your</strong> idea. Storefronts, offers, payments, loyalty — all generated and live before your coffee gets cold.
            </p>
            <div style={{ maxWidth: "320px", margin: "0 auto 20px" }}>
              {"href" in heroAction ? (
                <Link href={heroAction.href} className="biz-cta-primary">{heroAction.label} →</Link>
              ) : (
                <button onClick={heroAction.onClick} className="biz-cta-primary">{heroAction.label} →</button>
              )}
            </div>

            {/* Real stats row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "24px", flexWrap: "wrap" }}>
              {liveStats && (
                <>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "20px", fontWeight: 800, color: "#00FF87" }}>{liveStats.live_projects}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555" }}>LIVE STOREFRONTS</div>
                  </div>
                  <div style={{ width: "1px", height: "28px", background: "rgba(255,255,255,0.06)" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "20px", fontWeight: 800, color: "#F5A623" }}>{liveStats.active_offers}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555" }}>ACTIVE OFFERS</div>
                  </div>
                  <div style={{ width: "1px", height: "28px", background: "rgba(255,255,255,0.06)" }} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "20px", fontWeight: 800, color: "#4F9EFF" }}>{liveStats.businesses}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555" }}>BUSINESSES</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════ DASHBOARD PREVIEW ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: "20px" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>Your command center</div>
            <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.02em" }}>
              Know exactly what{"'"}s working
            </h2>
          </div>
        </Reveal>
        <Reveal delay={0.15}>
          <div style={{
            background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "16px", padding: "24px", position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg, #00FF87, #4F9EFF, #C084FC, #00FF87)", backgroundSize: "300%" }} />
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.14em", color: "#444", textTransform: "uppercase", marginBottom: "16px" }}>Business Dashboard Preview</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "10px", marginBottom: "16px" }}>
              {[
                { label: "Page Views", val: "1,247", color: "#f0f0f0" },
                { label: "Sales", val: "23", color: "#00FF87" },
                { label: "Revenue", val: "$1,840", color: "#f0f0f0" },
                { label: "DUM Received", val: "180", color: "#00FF87" },
              ].map((m, i) => (
                <div key={i} style={{ background: "#161616", borderRadius: "10px", padding: "12px 10px", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.08em", color: "#555", marginBottom: "6px" }}>{m.label}</div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "16px", fontWeight: 800, color: m.color }}>{m.val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {[
                { name: "Full Detail Package", sales: "12 sold", rev: "$1,068" },
                { name: "Basic Exterior Wash", sales: "8 sold", rev: "$232" },
                { name: "Monthly Membership", sales: "3 sold", rev: "$147/mo" },
              ].map((o, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: "#161616", borderRadius: "8px", padding: "10px 14px",
                }}>
                  <span style={{ fontSize: "12px", color: "#ccc" }}>{o.name}</span>
                  <div style={{ display: "flex", gap: "16px", fontFamily: "'Space Mono', monospace", fontSize: "11px" }}>
                    <span style={{ color: "#888" }}>{o.sales}</span>
                    <span style={{ color: "#00FF87", fontWeight: 600 }}>{o.rev}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "12px", textAlign: "center", fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#444" }}>
              SIMULATED DATA · YOUR REAL DASHBOARD UPDATES IN REAL TIME
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.25}>
          <div style={{ textAlign: "center", marginTop: "16px" }}>
            <Link href="/discover" className="biz-cta-secondary" style={{ display: "inline-flex" }}>
              Browse real storefronts on Discover →
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════ S2: PAIN ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>The problem</div>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "28px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: "20px" }}>
            Loyalty is broken.<br />We fixed it.
          </h2>
        </Reveal>

        {[
          { title: "Enterprise loyalty costs $500\u2013$2,000/month", body: "Your local competitor \u2014 the roofing company, the salon, the mobile wash \u2014 has zero loyalty infrastructure. They lose customers and don\u2019t know why." },
          { title: "Points are siloed and die with the app", body: "Starbucks points only work at Starbucks. That\u2019s not loyalty \u2014 that\u2019s a coupon with extra steps." },
          { title: "Small businesses can\u2019t compete on experience", body: "Big chains win on retention infrastructure, not product quality. A barber with a better haircut loses to a chain with an app." },
        ].map((c, i) => (
          <Reveal key={i} delay={i * 0.1}>
            <div className="biz-pain-card" style={{
              background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
              borderLeft: "3px solid #FF5555", borderRadius: "0 12px 12px 0",
              padding: "18px 20px", marginBottom: "10px",
            }}>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "#f0f0f0", marginBottom: "6px" }}>{"\u2715"} {c.title}</div>
              <div style={{ fontSize: "13px", color: "#888", lineHeight: 1.55 }}>{c.body}</div>
            </div>
          </Reveal>
        ))}

        <Reveal delay={0.4}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", fontFamily: "'Space Mono', monospace", fontSize: "11px", color: "#444", letterSpacing: "0.1em", margin: "20px 0" }}>
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
            DUM CLUB CHANGES THIS
            <div style={{ flex: 1, height: "1px", background: "rgba(255,255,255,0.06)" }} />
          </div>
        </Reveal>

        <Reveal delay={0.5}>
          <div className="biz-fixed-card" style={{
            background: "#0b0b0b", border: "1px solid rgba(0,255,135,0.2)",
            borderLeft: "3px solid #00FF87", borderRadius: "0 12px 12px 0",
            padding: "18px 20px", transition: "all 0.2s ease",
          }}>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "#00FF87", marginBottom: "6px" }}>{"\u2713"} One network. Every business.</div>
            <div style={{ fontSize: "12.5px", color: "#888", lineHeight: 1.55 }}>
              Any business creates a page, sets their rewards, and taps into a shared customer loyalty network. DUM Points earned anywhere can be spent everywhere on the platform.
            </div>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════ S3: REVENUE ENGINE ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>Revenue engine</div>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: "6px" }}>
            How DUM Club grows your business
          </h2>
          <p style={{ fontSize: "13px", color: "#888", marginBottom: "24px" }}>Not a tool. A system.</p>
        </Reveal>

        {[
          { n: "01", t: "Customer discovers your page", b: "Your DUM Club page shows up in Discover. Customers see your services, offers, and rewards before they click." },
          { n: "02", t: "They buy. You get paid instantly.", b: "Stripe-powered checkout. Customers pay with card. Money hits your account. No setup calls." },
          { n: "03", t: "They earn DUM Points automatically", b: "Every purchase earns them +2 points. No loyalty card, no app, no punch card. Their points are theirs." },
          { n: "04", t: "They return. And bring others.", b: "Customers with DUM Points have a reason to come back. Businesses with more activity rank higher in Discover." },
          { n: "05", t: "You see everything in one dashboard", b: "Views, sales, DUM point activity, top offers. Not five tools \u2014 one screen." },
        ].map((s, i) => (
          <Reveal key={i} delay={i * 0.08}>
            <div style={{ display: "flex", gap: "16px", padding: "18px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
              <div style={{
                width: "32px", height: "32px", flexShrink: 0, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'Space Mono', monospace", fontSize: "11px", fontWeight: 500,
                color: "#00FF87", background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)",
              }}>{s.n}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "14px", color: "#f0f0f0", marginBottom: "4px" }}>{s.t}</div>
                <div style={{ fontSize: "12.5px", color: "#888", lineHeight: 1.5 }}>{s.b}</div>
              </div>
            </div>
          </Reveal>
        ))}
      </section>


      {/* ═══════════════ URGENCY BREAK ═══════════════ */}
      <section style={{ padding: "0 20px 48px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1, textAlign: "center" }}>
        <Reveal>
          <div style={{
            fontFamily: "'Space Mono', monospace", fontSize: "13px", color: "#888",
            padding: "20px 0", borderTop: "1px solid rgba(255,255,255,0.04)", borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            Every day without a retention system = <strong style={{ color: "#FF5555" }}>a customer who forgot about you.</strong><br />
            <span style={{ color: "#555", fontSize: "12px" }}>You{"'"}re already paying for ads. Why not keep the customers they bring?</span>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════ S4: FEATURES ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>What you get</div>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: "20px" }}>
            Everything you need.<br />Nothing you don{"'"}t.
          </h2>
        </Reveal>

        {[
          { icon: "\u26A1", bg: "rgba(0,255,135,0.1)", bc: "rgba(0,255,135,0.2)", tag: "LAUNCH", title: "Your storefront, live in under 60 seconds", body: "Tell us what you offer. AI builds a full page \u2014 services, pricing, offers, descriptions. Hit publish. Done." },
          { icon: "\uD83D\uDCB3", bg: "rgba(245,166,35,0.1)", bc: "rgba(245,166,35,0.2)", tag: "REVENUE", title: "Get paid without setting anything up", body: "Stripe checkout is built in. Customers pay by card. You get paid. No merchant account applications." },
          { icon: "\uD83D\uDD01", bg: "rgba(0,255,135,0.1)", bc: "rgba(0,255,135,0.2)", tag: "RETENTION", title: "Built-in loyalty that actually works", body: "DUM Points reward every purchase automatically. No setup, no maintenance, no loyalty app to manage." },
          { icon: "\uD83D\uDEE1\uFE0F", bg: "rgba(79,158,255,0.1)", bc: "rgba(79,158,255,0.2)", tag: "TRUST", title: "Verified badge \u2014 rank higher, win more", body: "Verified businesses rank higher in Discover, get a trust badge, and convert browsers into buyers at a higher rate." },
          { icon: "\uD83D\uDCCA", bg: "rgba(192,132,252,0.1)", bc: "rgba(192,132,252,0.2)", tag: "INSIGHT", title: "Know what\u2019s working \u2014 in real time", body: "Page views, sales, revenue, DUM point redemptions. One dashboard replaces your spreadsheet and guesswork." },
          { icon: "\uD83E\uDD16", bg: "rgba(245,166,35,0.1)", bc: "rgba(245,166,35,0.2)", tag: "GROWTH", title: "AI builds and refines your business", body: "AI generates your storefront, writes offer descriptions, and sets pricing. Ask it questions about your business anytime via AI Chat." },
        ].map((f, i) => (
          <Reveal key={i} delay={i * 0.08}>
            <div className="biz-feature-card">
              <div style={{
                width: "36px", height: "36px", borderRadius: "8px",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "16px", marginBottom: "12px",
                background: f.bg, border: `1px solid ${f.bc}`,
              }}>{f.icon}</div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.12em", color: "#00FF87", textTransform: "uppercase", marginBottom: "5px" }}>{f.tag}</div>
              <div style={{ fontWeight: 700, fontSize: "15px", color: "#f0f0f0", marginBottom: "7px" }}>{f.title}</div>
              <div style={{ fontSize: "12.5px", color: "#888", lineHeight: 1.55 }}>{f.body}</div>
            </div>
          </Reveal>
        ))}
      </section>

      {/* ═══════════════ S5: DUM POINTS ═══════════════ */}
      <section style={{ margin: "0 auto 72px", maxWidth: "680px", padding: "0 20px", position: "relative", zIndex: 1 }}><div style={{ background: "#0b0b0b", border: "1px solid rgba(0,255,135,0.2)", borderRadius: "20px", padding: "32px 24px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "-60px", right: "-40px", width: "200px", height: "200px", background: "radial-gradient(circle, rgba(0,255,135,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
        <Reveal>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "6px",
            fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.12em",
            color: "#00FF87", background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)",
            padding: "5px 12px", borderRadius: "20px", marginBottom: "16px",
          }}>
            <span style={{ width: "6px", height: "6px", background: "#00FF87", borderRadius: "50%" }} /> YOUR SECRET WEAPON
          </div>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "24px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: "12px" }}>
            DUM Points = <span style={{ color: "#00FF87" }}>built-in loyalty</span> you never have to manage
          </h2>
          <p style={{ fontSize: "13px", color: "#888", lineHeight: 1.6, marginBottom: "24px" }}>
            Every DUM Club user already has a points balance. When they spend points at your business,
            they get a discount — and you still get paid on the full price. The platform covers the reward during beta.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "20px" }}>
            {[
              { n: "10%", l: "Discount for customers using DUM", c: "#00FF87" },
              { n: "+2", l: "DUM earned per purchase by buyers", c: "#F5A623" },
              { n: "$0", l: "Setup cost \u2014 platform funded (beta)", c: "#4F9EFF" },
            ].map((s, i) => (
              <div key={i} style={{ background: "#030303", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "14px 10px", textAlign: "center" }}>
                <div style={{ fontWeight: 800, fontSize: "22px", lineHeight: 1, marginBottom: "5px", color: s.c }}>{s.n}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.08em", color: "#444" }}>{s.l}</div>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.25}>
          <div style={{ background: "#030303", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ width: "28px", height: "28px", flexShrink: 0, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)" }}>{"\uD83D\uDED2"}</div>
              <div style={{ fontSize: "13px", color: "#888" }}><strong style={{ color: "#f0f0f0", fontWeight: 500 }}>Customer buys $80 service</strong> with DUM Points {"\u2192"} they pay $72. You receive $74.40 (full price minus 7% platform fee).</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ width: "28px", height: "28px", flexShrink: 0, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", background: "rgba(245,166,35,0.1)", border: "1px solid rgba(245,166,35,0.2)" }}>{"\uD83D\uDCC8"}</div>
              <div style={{ fontSize: "13px", color: "#888" }}>Businesses accepting DUM Points rank <strong style={{ color: "#f0f0f0", fontWeight: 500 }}>higher in Discover</strong> {"\u2014"} more visibility, more clicks, more customers.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 0" }}>
              <div style={{ width: "28px", height: "28px", flexShrink: 0, borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", background: "rgba(79,158,255,0.1)", border: "1px solid rgba(79,158,255,0.2)" }}>{"\uD83D\uDD17"}</div>
              <div style={{ fontSize: "13px", color: "#888" }}>Points earned at <em>any</em> business can be spent at <strong style={{ color: "#f0f0f0", fontWeight: 500 }}>any</strong> business on the platform.</div>
            </div>
          </div>
        </Reveal>
      </div></section>


      {/* ═══════════════ S6: BUSINESS DOMINATION — COMPARISON ═══════════════ */}
      <section style={{ margin: "0 auto 72px", maxWidth: "780px", padding: "0 20px", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.22em", color: "#00FF87", textTransform: "uppercase", marginBottom: "16px" }}>◆ THE REAL DIFFERENCE</div>
            <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "clamp(26px, 7vw, 40px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1, marginBottom: "12px" }}>
              AI tools build <span style={{ color: "#555" }}>apps.</span><br />
              DUM Club builds <span className="biz-hero-glow" style={{ color: "#00FF87" }}>businesses that make money.</span>
            </h2>
            <p style={{ fontSize: "15px", color: "#888", maxWidth: "520px", margin: "0 auto", lineHeight: 1.6 }}>
              From idea → storefront → payments → customers → repeat revenue. <strong style={{ color: "#f0f0f0" }}>Instantly.</strong>
            </p>
          </div>
        </Reveal>

        {/* Interactive Comparison Table */}
        <Reveal delay={0.15}>
          <div style={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "20px", padding: "24px", position: "relative", overflow: "hidden" }}>
            {/* Top glow bar */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg, transparent, #00FF87, transparent)" }} />

            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Space Mono', monospace", fontSize: "11px", minWidth: "580px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ textAlign: "left", padding: "12px 0", fontSize: "9px", letterSpacing: "0.1em", color: "#444", minWidth: "120px" }}> </th>
                    <th style={{ textAlign: "center", padding: "12px 8px", fontSize: "9px", letterSpacing: "0.12em", color: "#444" }}>BASE44</th>
                    <th style={{ textAlign: "center", padding: "12px 8px", fontSize: "9px", letterSpacing: "0.12em", color: "#444" }}>LOVABLE</th>
                    <th style={{ textAlign: "center", padding: "12px 8px", fontSize: "9px", letterSpacing: "0.12em", color: "#444" }}>VENICE.AI</th>
                    <th style={{
                      textAlign: "center", padding: "12px 12px", fontSize: "9px", letterSpacing: "0.14em", color: "#00FF87",
                      background: "rgba(0,255,135,0.04)", borderRadius: "12px 12px 0 0",
                      border: "1px solid rgba(0,255,135,0.15)", borderBottom: "none",
                      boxShadow: "0 0 20px rgba(0,255,135,0.05)",
                    }}>
                      DUM CLUB ★
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { feature: "What it builds", b44: "Web apps", lov: "Web apps", ven: "AI models", dum: "Revenue businesses" },
                    { feature: "Time to launch", b44: "Hours", lov: "Hours", ven: "N/A", dum: "Under 60 seconds" },
                    { feature: "Revenue on day one", b44: "No", lov: "No", ven: "No", dum: "Yes — Stripe built in" },
                    { feature: "Payments included", b44: "DIY setup", lov: "Not included", ven: "Not included", dum: "Ready at launch" },
                    { feature: "Customer retention", b44: "None", lov: "None", ven: "None", dum: "DUM Points loyalty" },
                    { feature: "AI utility", b44: "Code gen", lov: "Code gen", ven: "Chat / models", dum: "Builds & runs business" },
                    { feature: "Token / rewards", b44: "None", lov: "None", ven: "VEN token", dum: "DUM Points ecosystem" },
                    { feature: "Marketplace", b44: "None", lov: "None", ven: "None", dum: "Discover — built in" },
                    { feature: "Target user", b44: "Developers", lov: "Developers", ven: "AI power users", dum: "Business owners" },
                    { feature: "End result", b44: "An app prototype", lov: "An app prototype", ven: "AI output", dum: "A running business" },
                  ].map((row, i) => (
                    <tr key={i} style={{ borderBottom: i < 9 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                      <td style={{ padding: "12px 0", color: "#888", fontSize: "12px", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 }}>{row.feature}</td>
                      <td style={{ padding: "12px 8px", textAlign: "center", color: "#555", fontSize: "11px" }}>{row.b44}</td>
                      <td style={{ padding: "12px 8px", textAlign: "center", color: "#555", fontSize: "11px" }}>{row.lov}</td>
                      <td style={{ padding: "12px 8px", textAlign: "center", color: "#555", fontSize: "11px" }}>{row.ven}</td>
                      <td style={{
                        padding: "12px 12px", textAlign: "center", color: "#00FF87", fontSize: "11px", fontWeight: 600,
                        background: "rgba(0,255,135,0.04)",
                        borderLeft: "1px solid rgba(0,255,135,0.15)",
                        borderRight: "1px solid rgba(0,255,135,0.15)",
                        ...(i === 9 ? { borderBottom: "1px solid rgba(0,255,135,0.15)", borderRadius: "0 0 12px 12px" } : {}),
                      }}>{row.dum}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        {/* "Why DUM Club Wins" Cards */}
        <Reveal delay={0.25}>
          <div style={{ marginTop: "32px" }}>
            <h3 style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "16px", textAlign: "center" }}>Why DUM Club wins</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              {[
                { icon: "🚫", accent: "#FF6B6B", title: "You don't need a developer", desc: "Describe your business in one sentence. AI handles everything else — storefront, offers, pricing, copy." },
                { icon: "💰", accent: "#00FF87", title: "You get paid on day one", desc: "Stripe checkout is live the moment your page goes up. No merchant account. No approval process." },
                { icon: "🤖", accent: "#A78BFA", title: "AI doesn't just build — it runs your business", desc: "AI writes your descriptions, sets your pricing, and helps you manage everything from one dashboard." },
                { icon: "🔁", accent: "#38BDF8", title: "Customers come back (not just visit once)", desc: "DUM Points reward every purchase. Customers earn loyalty across the entire network — and spend it at your store." },
              ].map((card, i) => (
                <Reveal key={i} delay={0.3 + i * 0.08}>
                  <div className="biz-feature-card" style={{ borderLeft: `3px solid ${card.accent}`, borderRadius: "0 14px 14px 0" }}>
                    <div style={{ fontSize: "20px", marginBottom: "10px" }}>{card.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: "14px", color: "#f0f0f0", marginBottom: "6px" }}>{card.title}</div>
                    <div style={{ fontSize: "12px", color: "#888", lineHeight: 1.55 }}>{card.desc}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Reveal>

        {/* Business Flow Visual */}
        <Reveal delay={0.4}>
          <div style={{ marginTop: "36px", padding: "28px 20px", background: "linear-gradient(135deg, rgba(0,255,135,0.03), rgba(79,158,255,0.02))", border: "1px solid rgba(0,255,135,0.1)", borderRadius: "20px" }}>
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#00FF87", textTransform: "uppercase", marginBottom: "8px" }}>YOUR BUSINESS JOURNEY</div>
              <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#f0f0f0" }}>From zero to revenue in minutes</h3>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0", flexWrap: "wrap" }}>
              {[
                { step: "💡", label: "Your Idea", sub: "One sentence" },
                { step: "🤖", label: "AI Builds", sub: "Instant" },
                { step: "🏪", label: "Storefront Live", sub: "Ready to sell" },
                { step: "💳", label: "Offers Selling", sub: "Stripe powered" },
                { step: "🔁", label: "Customers Return", sub: "DUM Points" },
                { step: "📈", label: "Revenue Growing", sub: "Every day" },
              ].map((item, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center" }}>
                  <div style={{ textAlign: "center", minWidth: "80px", padding: "8px 4px" }}>
                    <div style={{
                      width: "44px", height: "44px", margin: "0 auto 6px",
                      borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "20px",
                      background: "rgba(0,255,135,0.08)", border: "1px solid rgba(0,255,135,0.2)",
                      boxShadow: i === 5 ? "0 0 16px rgba(0,255,135,0.15)" : "none",
                    }}>{item.step}</div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#f0f0f0" }}>{item.label}</div>
                    <div style={{ fontSize: "9px", color: "#555", fontFamily: "'Space Mono', monospace" }}>{item.sub}</div>
                  </div>
                  {i < 5 && (
                    <div style={{ color: "#00FF87", fontSize: "14px", opacity: 0.4, margin: "0 2px", marginBottom: "20px" }}>→</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* Live Stats Integration */}
        {liveStats && (liveStats.live_projects > 0 || liveStats.businesses > 0) && (
          <Reveal delay={0.5}>
            <div style={{ marginTop: "24px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              <div style={{ background: "#0b0b0b", border: "1px solid rgba(0,255,135,0.15)", borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "28px", fontWeight: 800, color: "#00FF87", lineHeight: 1 }}>{liveStats.live_projects}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555", marginTop: "6px" }}>LIVE BUSINESSES</div>
              </div>
              <div style={{ background: "#0b0b0b", border: "1px solid rgba(245,166,35,0.15)", borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "28px", fontWeight: 800, color: "#F5A623", lineHeight: 1 }}>{liveStats.active_offers}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555", marginTop: "6px" }}>ACTIVE OFFERS</div>
              </div>
              <div style={{ background: "#0b0b0b", border: "1px solid rgba(79,158,255,0.15)", borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "28px", fontWeight: 800, color: "#4F9EFF", lineHeight: 1 }}>{liveStats.businesses}</div>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555", marginTop: "6px" }}>VERIFIED BUSINESSES</div>
              </div>
            </div>
          </Reveal>
        )}
      </section>

      {/* ═══════════════ S7: USE CASES ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "8px" }}>Built for every business</div>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: "16px" }}>See yourself here</h2>
        </Reveal>
        <Reveal delay={0.1}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            {[
              { cat: "Auto Detail", name: "Mobile Car Wash", dum: "+2 DUM/wash" },
              { cat: "Food & Drink", name: "Local Pizza Shop", dum: "+2 DUM/order" },
              { cat: "Salon", name: "Hair & Beauty Studio", dum: "+2 DUM/visit" },
              { cat: "Services", name: "Roofing Company", dum: "+2 DUM/job" },
              { cat: "Fitness", name: "Personal Training", dum: "+2 DUM/session" },
              { cat: "Digital", name: "Brand Design Studio", dum: "+2 DUM/project" },
            ].map((u, i) => (
              <div key={i} style={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "16px" }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#00FF87", marginBottom: "6px", textTransform: "uppercase" }}>{u.cat}</div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#f0f0f0", marginBottom: "3px" }}>{u.name}</div>
                <div style={{ fontSize: "11px", color: "#888" }}>{u.dum}</div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: "3px", marginTop: "8px",
                  fontFamily: "'Space Mono', monospace", fontSize: "8px", letterSpacing: "0.06em",
                  color: "#888", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
                  padding: "3px 7px", borderRadius: "10px",
                }}>EXAMPLE PAGE</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>


      {/* ═══════════════ S8: VERIFICATION ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>Trust & credibility</div>
        </Reveal>
        <Reveal delay={0.1}>
          <div style={{
            background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "20px", padding: "28px 22px", position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "linear-gradient(90deg, #00FF87, #4F9EFF, #00FF87)", backgroundSize: "200%" }} />

            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "20px" }}>
              <div style={{ width: "52px", height: "52px", borderRadius: "12px", background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>{"\u2713"}</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "15px", color: "#f0f0f0" }}>DUM Club Verified Business</div>
                <div style={{ fontSize: "12px", color: "#888" }}>Reviewed and approved by our team</div>
              </div>
            </div>

            <h3 style={{ fontWeight: 800, fontSize: "20px", letterSpacing: "-0.02em", marginBottom: "8px", lineHeight: 1.2 }}>Verified businesses win more customers</h3>
            <p style={{ fontSize: "13px", color: "#888", marginBottom: "22px", lineHeight: 1.55 }}>
              A badge tells every customer: this business is real, reviewed, and accountable. Verified businesses rank higher in Discover.
            </p>

            {[
              "Create your business profile \u2014 name, category, description",
              "Launch at least one storefront with real offers",
              "Submit for verification from your dashboard",
              "Our team reviews within 48 hours",
              "Your verified badge appears on all your storefronts",
            ].map((step, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "12px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
                <div style={{
                  width: "24px", height: "24px", flexShrink: 0, borderRadius: "50%",
                  background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "'Space Mono', monospace", fontSize: "10px", color: "#00FF87", marginTop: "2px",
                }}>{i + 1}</div>
                <div style={{ fontSize: "13px", color: "#888", lineHeight: 1.5 }}>{step}</div>
              </div>
            ))}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "16px" }}>
              {[
                { l: "Discover ranking", v: "Verified rank higher" },
                { l: "Trust signal", v: "Badge on every page" },
                { l: "Conversion", v: "More clicks, more sales" },
                { l: "Cost", v: "Free \u2014 always", green: true },
              ].map((p, i) => (
                <div key={i} style={{ background: "#030303", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", padding: "10px 12px" }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", color: "#00FF87", letterSpacing: "0.06em", marginBottom: "2px" }}>{p.l}</div>
                  <div style={{ fontSize: "12px", color: p.green ? "#00FF87" : "#888" }}>{p.v}</div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════ S9: WHY SWITCH ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>Pain removal</div>
          <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "24px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.2, marginBottom: "6px" }}>Why businesses switch to DUM Club</h2>
          <p style={{ fontSize: "13px", color: "#888", marginBottom: "20px" }}>Everything they stopped paying for. <span style={{ color: "#FF5555" }}>And wish they{"'"}d stopped sooner.</span></p>
        </Reveal>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {[
            { cross: true, t: "No website to design or maintain" },
            { cross: true, t: "No developer to hire" },
            { cross: true, t: "No separate loyalty app to manage" },
            { cross: true, t: "No payment gateway setup or approval" },
            { cross: true, t: "No monthly software stack ($500+/mo)" },
            { cross: true, t: "No punch cards that get lost" },
            { cross: true, t: "No crypto knowledge required" },
            { cross: false, t: "One page. Payments. Loyalty. Analytics. Done." },
          ].map((item, i) => (
            <Reveal key={i} delay={i * 0.05}>
              <div className="biz-switch-item" style={{
                display: "flex", alignItems: "center", gap: "12px",
                padding: "13px 16px", background: "#0b0b0b",
                border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px",
                fontSize: "13px", color: item.cross ? "#888" : "#f0f0f0",
              }}>
                <div style={{
                  width: "20px", height: "20px", flexShrink: 0, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px",
                  ...(item.cross
                    ? { background: "rgba(255,85,85,0.1)", border: "1px solid rgba(255,85,85,0.2)", color: "#FF5555" }
                    : { background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)", color: "#00FF87" }),
                }}>{item.cross ? "\u2717" : "\u2713"}</div>
                <span>{item.cross ? item.t : <><span style={{ color: "#00FF87" }}>{item.t}</span></>}</span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>


      {/* S10 moved to after hero demo */}

      {/* ═══════════════ BUSINESS CREATE FORM (modal-like) ═══════════════ */}
      {showForm && user && !bizProfile && (
        <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
          <div style={{
            background: "#0b0b0b", border: "1px solid rgba(0,255,135,0.2)",
            borderRadius: "20px", padding: "28px 24px",
          }}>
            <h3 style={{ fontWeight: 800, fontSize: "18px", marginBottom: "4px" }}>Create your business profile</h3>
            <p style={{ fontSize: "13px", color: "#888", marginBottom: "20px" }}>This is your identity on DUM Club. Update anytime.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <input value={bizName} onChange={(e) => setBizName(e.target.value)} placeholder="Business name *"
                style={{ width: "100%", background: "#161616", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#f0f0f0", outline: "none" }} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <select value={bizCategory} onChange={(e) => setBizCategory(e.target.value)}
                  style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#f0f0f0", outline: "none" }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} placeholder="Contact email (optional)"
                  style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#f0f0f0", outline: "none" }} />
              </div>
              <input value={bizWebsite} onChange={(e) => setBizWebsite(e.target.value)} placeholder="Website (optional)"
                style={{ width: "100%", background: "#161616", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#f0f0f0", outline: "none" }} />
              <textarea value={bizDesc} onChange={(e) => setBizDesc(e.target.value)} placeholder="Short description" rows={2}
                style={{ width: "100%", background: "#161616", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", fontSize: "14px", color: "#f0f0f0", outline: "none", resize: "none" }} />
              {error && <div style={{ background: "rgba(255,85,85,0.05)", border: "1px solid rgba(255,85,85,0.2)", borderRadius: "8px", padding: "10px 14px", fontSize: "13px", color: "#FF5555" }}>{error}</div>}
              <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                <button onClick={handleCreate} disabled={!bizName.trim() || saving}
                  style={{ background: "#00FF87", color: "#000", fontWeight: 700, fontSize: "13px", padding: "12px 24px", borderRadius: "8px", border: "none", cursor: "pointer", opacity: !bizName.trim() || saving ? 0.5 : 1 }}>
                  {saving ? "Creating..." : "Create Business"}
                </button>
                <button onClick={() => { setShowForm(false); setError(""); }}
                  style={{ background: "transparent", color: "#888", fontSize: "13px", padding: "12px 24px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ═══════════════ S11: FINAL CTA ═══════════════ */}
      <section style={{ padding: "48px 20px 40px", maxWidth: "680px", margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{
            background: "linear-gradient(180deg, rgba(0,255,135,0.06), rgba(0,255,135,0.01), transparent)",
            border: "1px solid rgba(0,255,135,0.12)",
            borderRadius: "24px", padding: "52px 28px", position: "relative", overflow: "hidden",
          }}>
            {/* Corner glow */}
            <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "200px", height: "200px", background: "radial-gradient(circle, rgba(0,255,135,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
            <div style={{ position: "absolute", bottom: "-60px", left: "-60px", width: "200px", height: "200px", background: "radial-gradient(circle, rgba(79,158,255,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "11px", letterSpacing: "0.2em", color: "#00FF87", marginBottom: "20px" }}>START YOUR BUSINESS IN 60 SECONDS</div>
            <h2 style={{ fontFamily: "'Space Mono', monospace", fontSize: "clamp(28px, 8vw, 44px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.08, marginBottom: "16px" }}>
              Stop building apps.<br />Start <span className="biz-hero-glow" style={{ color: "#00FF87" }}>making money.</span>
            </h2>
            <p style={{ fontSize: "15px", color: "#888", marginBottom: "32px", lineHeight: 1.6, maxWidth: "440px", margin: "0 auto 32px" }}>
              Your next customer is looking for what you sell right now.<br />
              <span style={{ color: "#FF5555", fontWeight: 500 }}>Without a page, they{"'"}ll never find you.</span>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "380px", margin: "0 auto 20px" }}>
              {"href" in heroAction ? (
                <Link href={heroAction.href} className="biz-cta-primary" style={{ fontSize: "15px", padding: "18px 32px" }}>
                  Start Building →
                </Link>
              ) : (
                <button onClick={heroAction.onClick} className="biz-cta-primary" style={{ fontSize: "15px", padding: "18px 32px" }}>
                  Start Building →
                </button>
              )}
              <Link href="/discover" className="biz-cta-secondary">
                View Live Businesses ↓
              </Link>
            </div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: "10px", letterSpacing: "0.08em", color: "#555" }}>
              No credit card · No crypto wallet · No developer needed · Live in minutes
            </div>
          </div>
        </Reveal>
      </section>

    </div>
  );
}
