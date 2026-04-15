"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { Starfield } from "../../components/Starfield";

import { API_BASE } from "../../lib/apiBase";

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

/* ── Hero Product Demo ── */
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
        if (i >= target.length) { clearInterval(interval); setTimeout(() => setPhase(1), 800); }
      }, 50);
      return () => clearInterval(interval);
    }
    if (phase === 1) { const t = setTimeout(() => setPhase(2), 1500); return () => clearTimeout(t); }
    if (phase === 2) { const t = setTimeout(() => setPhase(3), 1500); return () => clearTimeout(t); }
    if (phase === 3) { const t = setTimeout(() => setPhase(0), 4000); return () => { clearTimeout(t); setTyped(""); }; }
  }, [phase]);

  return (
    <div style={{
      background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: "16px", padding: "20px", maxWidth: "420px", width: "100%",
      margin: "0 auto", position: "relative", overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "160px", height: "160px", background: "radial-gradient(circle, rgba(0,255,135,0.06) 0%, transparent 70%)", pointerEvents: "none" }} />

      {phase <= 1 && (
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.14em", color: "#444", textTransform: "uppercase", marginBottom: "8px" }}>
            Describe your business
          </div>
          <div style={{ background: "#161616", border: "1px solid rgba(0,255,135,0.15)", borderRadius: "10px", padding: "14px 16px", fontFamily: "var(--font-geist-mono), monospace", fontSize: "14px", color: phase === 0 ? "#f0f0f0" : "#888", minHeight: "48px" }}>
            {phase === 0 ? <>{typed}<span style={{ opacity: 0.6, animation: "blink 1s infinite" }}>|</span></> : target}
          </div>
          {phase === 1 && (
            <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-geist-mono), monospace", fontSize: "11px", color: "#00FF87" }}>
              <span style={{ width: "6px", height: "6px", background: "#00FF87", borderRadius: "50%", display: "inline-block" }} className="pulse-dot" />
              AI is building your storefront...
            </div>
          )}
        </div>
      )}

      {phase === 2 && (
        <div>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.14em", color: "#00FF87", textTransform: "uppercase", marginBottom: "12px" }}>Generating offers</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {DEMO_OFFERS.map((o, i) => (
              <div key={i} style={{ background: "#161616", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "10px", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", animation: `fadeUp 0.3s ease ${i * 0.15}s both` }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#f0f0f0" }}>{o.title}</div>
                  <div style={{ fontSize: "11px", color: "#666", marginTop: "2px" }}>{o.tag}</div>
                </div>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "14px", fontWeight: 700, color: "#00FF87" }}>{o.price}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase === 3 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#f0f0f0" }}>Sparkle Mobile Wash</div>
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", letterSpacing: "0.1em", color: "#888", marginTop: "2px" }}>SERVICES · DUM CLUB</div>
            </div>
            <div style={{ background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)", borderRadius: "20px", padding: "4px 10px", fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", color: "#00FF87", letterSpacing: "0.1em" }}>LIVE</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {DEMO_OFFERS.map((o, i) => (
              <div key={i} style={{ background: "#161616", borderRadius: "8px", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", color: "#ccc" }}>{o.title}</span>
                <span style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "12px", fontWeight: 600, color: "#00FF87" }}>{o.price}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "12px", textAlign: "center", fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", color: "#444", letterSpacing: "0.1em" }}>
            PAYMENTS · REWARDS · ANALYTICS — ALL ACTIVE
          </div>
        </div>
      )}
    </div>
  );
}


export default function BusinessPage() {
  const [liveStats, setLiveStats] = useState<{ live_projects: number; active_offers: number; businesses: number } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/projects/live-stats`).then(r => r.json()).then(setLiveStats).catch(() => {});
  }, []);

  return (
    <div style={{ background: "#030303", color: "#f0f0f0", fontFamily: "'DM Sans', -apple-system, sans-serif", minHeight: "100vh", overflowX: "clip" as any, position: "relative" }}>
      <Starfield count={40} />
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
          border-radius: 14px; padding: 22px;
          transition: all 0.25s ease; cursor: default;
        }
        .biz-feature-card:hover {
          border-color: rgba(0,255,135,0.25); transform: translateY(-3px);
          box-shadow: 0 8px 24px rgba(0,255,135,0.06);
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
        .biz-grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .biz-grid-3col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        @media (max-width: 640px) {
          .biz-grid-2col { grid-template-columns: 1fr; }
          .biz-grid-3col { grid-template-columns: 1fr 1fr; }
        }
      `}</style>

      {/* ═══════════════ SECTION 1: HERO ═══════════════ */}
      <section style={{ padding: "72px 20px 32px", maxWidth: "680px", margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "8px",
            fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", letterSpacing: "0.16em",
            color: "#444", border: "1px solid rgba(255,255,255,0.06)", padding: "5px 14px", borderRadius: "20px", marginBottom: "24px",
          }}>
            <span style={{ color: "#00FF87" }}>★</span> DUM CLUB · DIGITAL UTILITY MARKET
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h1 style={{
            fontFamily: "var(--font-geist-mono), monospace", fontSize: "clamp(32px, 9vw, 52px)",
            fontWeight: 800, lineHeight: 1.05, letterSpacing: "-0.035em", marginBottom: "20px",
          }}>
            Your business.<br />
            Online and <span className="biz-hero-glow" style={{ color: "#00FF87" }}>selling.</span><br />
            In 60 seconds.
          </h1>
        </Reveal>

        <Reveal delay={0.2}>
          <p style={{ fontSize: "16px", color: "#999", lineHeight: 1.65, marginBottom: "32px", maxWidth: "480px", margin: "0 auto 32px" }}>
            DUM Club gives you a storefront, Stripe payments, and built-in loyalty
            — <strong style={{ color: "#f0f0f0", fontWeight: 500 }}>founding merchants pay $0/month, forever.</strong>
          </p>
        </Reveal>

        <Reveal delay={0.3}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "28px", maxWidth: "360px", margin: "0 auto 28px" }}>
            <Link href="/merchant" className="biz-cta-primary">
              Become a Founding Merchant — Free →
            </Link>
            <Link href="/discover" className="biz-cta-secondary">
              Explore Businesses →
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.4}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", fontSize: "10px", fontFamily: "var(--font-geist-mono), monospace", letterSpacing: "0.08em", color: "#444" }}>
            <span><span style={{ color: "#00FF87" }}>✓</span> Free to start</span>
            <span><span style={{ color: "#00FF87" }}>✓</span> Stripe payments</span>
            <span><span style={{ color: "#00FF87" }}>✓</span>{liveStats && liveStats.live_projects > 0 ? ` ${liveStats.live_projects} businesses live` : " Live in minutes"}</span>
          </div>
        </Reveal>
      </section>

      {/* ═══════════════ SECTION 2: HOW IT WORKS ═══════════════ */}
      <section style={{ padding: "0 20px 48px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        {/* Animated demo */}
        <Reveal delay={0.2}>
          <div style={{ animation: "heroFloat 6s ease-in-out infinite", maxWidth: "460px", margin: "0 auto 40px" }}>
            <div style={{ borderRadius: "18px", padding: "2px", background: "linear-gradient(135deg, rgba(0,255,135,0.3), rgba(79,158,255,0.15), rgba(0,255,135,0.3))", backgroundSize: "200% 200%", animation: "borderGlow 4s ease infinite" }}>
              <div style={{ borderRadius: "16px", overflow: "hidden" }}>
                <HeroDemo />
              </div>
            </div>
          </div>
        </Reveal>

        {/* 4 steps */}
        <Reveal>
          <h2 style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: "6px", textAlign: "center" }}>
            Live in 4 steps. <span style={{ color: "#00FF87" }}>No friction.</span>
          </h2>
          <p style={{ fontSize: "13px", color: "#888", marginBottom: "24px", textAlign: "center" }}>From idea to customers paying you — the same afternoon.</p>
        </Reveal>

        <div className="biz-grid-2col">
          {[
            { n: "01", t: "Sign in with Google", time: "3 sec" },
            { n: "02", t: "Describe your business", time: "2 min" },
            { n: "03", t: "AI builds your storefront", time: "Instant" },
            { n: "04", t: "Start selling & grow", time: "Same day" },
          ].map((s, i) => (
            <Reveal key={i} delay={i * 0.1}>
              <div style={{
                background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: "12px", padding: "18px 16px", textAlign: "center",
              }}>
                <div style={{
                  width: "28px", height: "28px", margin: "0 auto 10px",
                  borderRadius: "8px", background: "rgba(0,255,135,0.1)", border: "1px solid rgba(0,255,135,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "var(--font-geist-mono), monospace", fontSize: "11px", color: "#00FF87",
                }}>{s.n}</div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#f0f0f0", marginBottom: "6px" }}>{s.t}</div>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "11px", fontWeight: 700, color: "#00FF87", letterSpacing: "0.06em" }}>{s.time}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ═══════════════ SECTION 3: WHAT YOU GET ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "680px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>What you get</div>
          <h2 style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "26px", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, marginBottom: "20px" }}>
            Everything you need.<br />Nothing you don{"'"}t.
          </h2>
        </Reveal>

        {/* ── Founding merchant callout — emerald-bordered premium emphasis. */}
        <Reveal delay={0.05}>
          <div
            style={{
              background: "linear-gradient(180deg, rgba(0,255,135,0.08), rgba(0,255,135,0.02))",
              border: "1px solid rgba(0,255,135,0.35)",
              borderRadius: "14px",
              padding: "18px 22px",
              marginBottom: "22px",
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 0 24px rgba(0,255,135,0.08)",
            }}
          >
            <div style={{ position: "absolute", top: "-40px", right: "-40px", width: "140px", height: "140px", background: "radial-gradient(circle, rgba(0,255,135,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#00FF87", textTransform: "uppercase", marginBottom: "8px", fontWeight: 700 }}>
              ★ Founding Merchant Program
            </div>
            <div style={{ fontSize: "15px", lineHeight: 1.55, color: "#f0f0f0", fontWeight: 500 }}>
              First 100 merchants pay <strong style={{ color: "#00FF87" }}>$0/month</strong> during the founding period — then locked at $29/mo forever. No commission. No new hardware. No catch.
            </div>
          </div>
        </Reveal>

        <div className="biz-grid-2col">
          {[
            { icon: "⚡", tag: "STOREFRONT", title: "Live in under 60 seconds", body: "Describe what you sell. AI builds your page — offers, pricing, descriptions." },
            { icon: "💳", tag: "PAYMENTS", title: "Stripe checkout built in", body: "Customers pay by card. You get paid. No merchant account needed." },
            { icon: "🔁", tag: "REWARDS", title: "Customers earn DUM Points — and come back", body: "Every purchase at your business earns DUM Points redeemable across the entire network. That cross-merchant loyalty is what brings customers back." },
            { icon: "🤖", tag: "AI POWERED", title: "Your storefront writes itself", body: "AI generates offers, descriptions, and pricing. Edit anything, or don't." },
            { icon: "📊", tag: "ANALYTICS", title: "See what sells", body: "Views, sales, and customer activity. One dashboard." },
            { icon: "✓", tag: "TRUST", title: "Verified business badge", body: "Get reviewed. Earn a trust badge. Rank higher." },
          ].map((f, i) => (
            <Reveal key={i} delay={i * 0.06}>
              <div className="biz-feature-card">
                <div style={{ fontSize: "20px", marginBottom: "8px" }}>{f.icon}</div>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.12em", color: "#00FF87", textTransform: "uppercase", marginBottom: "5px" }}>{f.tag}</div>
                <div style={{ fontWeight: 700, fontSize: "14px", color: "#f0f0f0", marginBottom: "6px" }}>{f.title}</div>
                <div style={{ fontSize: "12px", color: "#888", lineHeight: 1.55 }}>{f.body}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ═══════════════ SECTION 4: PROOF ═══════════════ */}
      <section style={{ padding: "0 20px 72px", maxWidth: "780px", margin: "0 auto", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", letterSpacing: "0.18em", color: "#444", textTransform: "uppercase", marginBottom: "12px" }}>See yourself here</div>
            <h2 style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "22px", fontWeight: 800, letterSpacing: "-0.02em" }}>Built for every business</h2>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="biz-grid-3col">
            {[
              { cat: "Auto Detail", name: "Mobile Car Wash", dum: "+2 DUM/wash" },
              { cat: "Food & Drink", name: "Local Pizza Shop", dum: "+2 DUM/order" },
              { cat: "Salon", name: "Hair & Beauty Studio", dum: "+2 DUM/visit" },
              { cat: "Services", name: "Roofing Company", dum: "+2 DUM/job" },
              { cat: "Fitness", name: "Personal Training", dum: "+2 DUM/session" },
              { cat: "Digital", name: "Design Studio", dum: "+2 DUM/project" },
            ].map((u, i) => (
              <div key={i} style={{ background: "#0b0b0b", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "16px" }}>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#00FF87", marginBottom: "6px", textTransform: "uppercase" }}>{u.cat}</div>
                <div style={{ fontWeight: 700, fontSize: "13px", color: "#f0f0f0", marginBottom: "3px" }}>{u.name}</div>
                <div style={{ fontSize: "11px", color: "#888" }}>{u.dum}</div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* Live stats */}
        {liveStats && (liveStats.live_projects > 0 || liveStats.businesses > 0) && (
          <Reveal delay={0.2}>
            <div style={{ marginTop: "24px" }} className="biz-grid-3col">
              <div style={{ background: "#0b0b0b", border: "1px solid rgba(0,255,135,0.15)", borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "28px", fontWeight: 800, color: "#00FF87", lineHeight: 1 }}>{liveStats.live_projects}</div>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555", marginTop: "6px" }}>LIVE BUSINESSES</div>
              </div>
              <div style={{ background: "#0b0b0b", border: "1px solid rgba(245,166,35,0.15)", borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "28px", fontWeight: 800, color: "#F5A623", lineHeight: 1 }}>{liveStats.active_offers}</div>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555", marginTop: "6px" }}>ACTIVE OFFERS</div>
              </div>
              <div style={{ background: "#0b0b0b", border: "1px solid rgba(79,158,255,0.15)", borderRadius: "14px", padding: "20px 16px", textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "28px", fontWeight: 800, color: "#4F9EFF", lineHeight: 1 }}>{liveStats.businesses}</div>
                <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "9px", letterSpacing: "0.1em", color: "#555", marginTop: "6px" }}>VERIFIED BUSINESSES</div>
              </div>
            </div>
          </Reveal>
        )}
      </section>

      {/* ═══════════════ SECTION 5: FINAL CTA ═══════════════ */}
      <section style={{ padding: "48px 20px 64px", maxWidth: "680px", margin: "0 auto", textAlign: "center", position: "relative", zIndex: 1 }}>
        <Reveal>
          <div style={{
            background: "linear-gradient(180deg, rgba(0,255,135,0.06), rgba(0,255,135,0.01), transparent)",
            border: "1px solid rgba(0,255,135,0.12)",
            borderRadius: "24px", padding: "52px 28px", position: "relative", overflow: "hidden",
          }}>
            <div style={{ position: "absolute", top: "-60px", right: "-60px", width: "200px", height: "200px", background: "radial-gradient(circle, rgba(0,255,135,0.1) 0%, transparent 70%)", pointerEvents: "none" }} />

            <h2 style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "clamp(26px, 7vw, 40px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.08, marginBottom: "16px" }}>
              Your business could be<br /><span className="biz-hero-glow" style={{ color: "#00FF87" }}>selling right now.</span>
            </h2>
            <p style={{ fontSize: "15px", color: "#888", marginBottom: "32px", lineHeight: 1.6, maxWidth: "440px", margin: "0 auto 32px" }}>
              Describe what you sell. AI builds your storefront with payments included. Share your link — you{"'"}re open for business.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "380px", margin: "0 auto 20px" }}>
              <Link href="/merchant" className="biz-cta-primary" style={{ fontSize: "15px", padding: "18px 32px" }}>
                Become a Founding Merchant — Free →
              </Link>
              <Link href="/discover" className="biz-cta-secondary">
                Explore Businesses →
              </Link>
            </div>
            <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: "10px", letterSpacing: "0.08em", color: "#555" }}>
              No credit card · No developer needed · Live in minutes
            </div>
          </div>
        </Reveal>
      </section>

    </div>
  );
}
