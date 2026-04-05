"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "../lib/auth/AuthContext";

export function Navbar() {
  const path = usePathname();
  const { publicKey, connected } = useWallet();
  const { user, loading, login, logout } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [navHover, setNavHover] = useState(false);
  const [brandHover, setBrandHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dumBalance, setDumBalance] = useState(0);

  useEffect(() => {
    setMounted(true);

    // Try backend balance first, fall back to localStorage
    async function loadBalance() {
      const privyId = user?.privyId;
      if (privyId) {
        try {
          const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
          const res = await fetch(`${API}/api/dum/balance/${encodeURIComponent(privyId)}`);
          if (res.ok) {
            const data = await res.json();
            setDumBalance(data.balance ?? 50);
            localStorage.setItem("dum_points", String(data.balance ?? 50));
            return;
          }
        } catch {}
      }
      // Fallback: localStorage
      const stored = localStorage.getItem("dum_points");
      if (stored) {
        setDumBalance(Number(stored));
      } else {
        localStorage.setItem("dum_points", "50");
        setDumBalance(50);
      }
    }
    loadBalance();

    // Listen for balance updates from other components
    const handler = () => {
      const val = Number(localStorage.getItem("dum_points") || "0");
      setDumBalance(val);
    };
    window.addEventListener("dum-points-update", handler);
    return () => window.removeEventListener("dum-points-update", handler);
  }, [user]);

  // Close mobile menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  const links = [
    { href: "/discover", label: "Discover" },
    { href: "/build", label: "Build" },
    { href: "/business", label: "For Business" },
    { href: "/hub", label: "DUM Hub" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/chat", label: "AI Chat" },
  ];

  const shortAddress = publicKey
    ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
    : "";

  const shortEmail =
    user?.email && user.email.length > 26
      ? `${user.email.slice(0, 22)}...`
      : user?.email ?? null;

  return (
    <>
    {/* ── Fixed header bar ─────────────────────────────────── */}
    <nav
      onMouseEnter={() => setNavHover(true)}
      onMouseLeave={() => setNavHover(false)}
      style={{
        borderBottom: navHover
          ? "1px solid rgba(0,255,178,0.30)"
          : "1px solid #1c1c1c",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        background: navHover
          ? "rgba(0,255,178,0.035)"
          : "rgba(6,6,6,0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        zIndex: 9999,
        pointerEvents: "auto" as const,
        transition: "all 0.22s ease",
      }}
    >
      {/* ── Mobile header bar (hidden on lg+) ─────────────── */}
      <div className="flex items-center justify-between px-4 py-4 lg:hidden">
        <Link
          href="/"
          onMouseEnter={() => setBrandHover(true)}
          onMouseLeave={() => setBrandHover(false)}
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: "22px",
            fontWeight: 700,
            color: brandHover ? "#00FFB2" : "#e8e8e8",
            textDecoration: "none",
            letterSpacing: "-0.05em",
            display: "inline-flex",
            alignItems: "center",
            transition: "all 0.18s ease",
          }}
        >
          <span style={{ color: "#00FFB2" }}>DUM</span>
          <span>CLUB</span>
          <span
            style={{
              marginLeft: "8px",
              fontSize: "9px",
              letterSpacing: "0.24em",
              color: "#666",
            }}
          >
            EARLY ACCESS
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: "20px",
            background: "none",
            border: "1px solid #2a2a2a",
            color: menuOpen ? "#00FFB2" : "#9a9a9a",
            borderRadius: "10px",
            width: "44px",
            height: "44px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
        >
          {menuOpen ? "✕" : "≡"}
        </button>
      </div>

      {/* ── Desktop nav (hidden below lg) ─────────────────── */}
      <div
        className="hidden lg:grid lg:items-center"
        style={{
          gridTemplateColumns: "auto 1fr auto",
          padding: "20px clamp(16px, 3vw, 32px)",
          minHeight: "92px",
          gap: "16px",
        }}
      >
        <Link
          href="/"
          onMouseEnter={() => setBrandHover(true)}
          onMouseLeave={() => setBrandHover(false)}
          style={{
            fontFamily: "'Space Mono', monospace",
            fontSize: "30px",
            fontWeight: 700,
            color: brandHover ? "#00FFB2" : "#e8e8e8",
            textDecoration: "none",
            letterSpacing: "-0.05em",
            display: "inline-flex",
            alignItems: "center",
            gap: "0px",
            justifySelf: "start",
            transition: "all 0.18s ease",
            textShadow: brandHover ? "0 0 10px rgba(0,255,178,0.28)" : "none",
          }}
        >
          <span style={{ color: "#00FFB2" }}>DUM</span>
          <span>CLUB</span>
          <span
            style={{
              marginLeft: "12px",
              fontSize: "11px",
              letterSpacing: "0.24em",
              color: brandHover ? "#00FFB2" : "#666",
              transition: "all 0.18s ease",
            }}
          >
            EARLY ACCESS
          </span>
        </Link>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
          }}
        >
          {links.map((l) => {
            const active = path === l.href;

            return (
              <Link
                key={l.href}
                href={l.href}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "#00FFB2";
                  e.currentTarget.style.border =
                    "1px solid rgba(0,255,178,0.28)";
                  e.currentTarget.style.background = "rgba(0,255,178,0.06)";
                  e.currentTarget.style.boxShadow =
                    "0 0 10px rgba(0,255,178,0.18)";
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.color = "#9a9a9a";
                    e.currentTarget.style.border = "1px solid transparent";
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.boxShadow = "none";
                  }
                }}
                style={{
                  padding: "12px 18px",
                  borderRadius: "12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  textDecoration: "none",
                  transition: "all 0.15s ease",
                  background: active ? "rgba(0,255,178,0.08)" : "transparent",
                  color: active ? "#00FFB2" : "#9a9a9a",
                  border: active
                    ? "1px solid rgba(0,255,178,0.22)"
                    : "1px solid transparent",
                  fontFamily: "'Space Mono', monospace",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            /* DUM Points badge is prepended inside this container */
            gap: "14px",
            minHeight: "52px",
          }}
        >
          {mounted && (
            <>
              {user && dumBalance > 0 && (
                <Link
                  href="/hub"
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: "11px",
                    color: "#00FFB2",
                    letterSpacing: "0.1em",
                    border: "1px solid rgba(0,255,178,0.2)",
                    background: "rgba(0,255,178,0.05)",
                    borderRadius: "10px",
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span style={{ fontSize: "13px" }}>◆</span>
                  {dumBalance} DUM
                </Link>
              )}
              {loading ? (
                <button
                  type="button"
                  disabled
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: "12px",
                    color: "#777",
                    letterSpacing: "0.08em",
                    border: "1px solid #2a2a2a",
                    background: "#111",
                    borderRadius: "14px",
                    padding: "13px 18px",
                    height: "52px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  Loading...
                </button>
              ) : user ? (
                <button
                  type="button"
                  onClick={() => logout()}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#00FFB2";
                    e.currentTarget.style.border =
                      "1px solid rgba(0,255,178,0.35)";
                    e.currentTarget.style.background = "rgba(0,255,178,0.10)";
                    e.currentTarget.style.boxShadow =
                      "0 0 10px rgba(0,255,178,0.22)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#00FFB2";
                    e.currentTarget.style.border =
                      "1px solid rgba(0,255,178,0.22)";
                    e.currentTarget.style.background = "rgba(0,255,178,0.06)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  title="Sign out"
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: "12px",
                    color: "#00FFB2",
                    letterSpacing: "0.08em",
                    whiteSpace: "nowrap",
                    border: "1px solid rgba(0,255,178,0.22)",
                    background: "rgba(0,255,178,0.06)",
                    borderRadius: "14px",
                    padding: "13px 18px",
                    height: "52px",
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {shortEmail}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={login}
                  style={{
                    background: "none",
                    border: "1px solid #2a2a2a",
                    color: "#e8e8e8",
                    padding: "13px 18px",
                    fontSize: "12px",
                    letterSpacing: "0.13em",
                    cursor: "pointer",
                    fontFamily: "'Space Mono', monospace",
                    textTransform: "uppercase",
                    borderRadius: "14px",
                    height: "52px",
                    whiteSpace: "nowrap",
                    transition: "all 0.15s ease",
                  }}
                >
                  Continue with Google
                </button>
              )}

              {connected && (
                <div
                  style={{
                    fontFamily: "'Space Mono', monospace",
                    fontSize: "12px",
                    color: "#00FFB2",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                  }}
                >
                  Account Active
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </nav>

    {/* ── Mobile dropdown — OUTSIDE nav to escape backdrop-filter
         containing block. Rendered as a viewport-fixed overlay. ── */}
    {menuOpen && (
      <div
        className="lg:hidden"
        style={{
          position: "fixed",
          top: "72px",
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(3,3,3,0.98)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          zIndex: 9998,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          borderTop: "1px solid #1c1c1c",
          paddingBottom: "16px",
          pointerEvents: "auto" as const,
        }}
      >
        {links.map((l) => {
          const active = path === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              style={{
                display: "block",
                padding: "14px 20px",
                fontFamily: "'Space Mono', monospace",
                fontSize: "13px",
                fontWeight: 700,
                textDecoration: "none",
                color: active ? "#00FFB2" : "#9a9a9a",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                borderBottom: "1px solid #111",
              }}
            >
              {l.label}
            </Link>
          );
        })}

        {mounted && (
          <div
            style={{
              padding: "14px 20px 0",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            {loading ? (
              <div
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: "12px",
                  color: "#777",
                  padding: "4px 0",
                }}
              >
                Loading...
              </div>
            ) : user ? (
              <button
                type="button"
                onClick={() => { logout(); setMenuOpen(false); }}
                title="Sign out"
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: "12px",
                  color: "#00FFB2",
                  letterSpacing: "0.08em",
                  border: "1px solid rgba(0,255,178,0.22)",
                  background: "rgba(0,255,178,0.06)",
                  borderRadius: "14px",
                  padding: "14px 18px",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                {shortEmail}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { login(); setMenuOpen(false); }}
                style={{
                  background: "none",
                  border: "1px solid #2a2a2a",
                  color: "#e8e8e8",
                  padding: "14px 18px",
                  fontSize: "12px",
                  letterSpacing: "0.13em",
                  cursor: "pointer",
                  fontFamily: "'Space Mono', monospace",
                  textTransform: "uppercase",
                  borderRadius: "14px",
                  width: "100%",
                }}
              >
                Continue with Google
              </button>
            )}

            {connected && (
              <div
                style={{
                  fontFamily: "'Space Mono', monospace",
                  fontSize: "11px",
                  color: "#00FFB2",
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Account Active
              </div>
            )}
          </div>
        )}
      </div>
    )}
    </>
  );
}
