"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth/AuthContext";
import { API_BASE } from "../lib/apiBase";

export function Navbar() {
  const path = usePathname();
  const { user, loading, login, logout } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [navHover, setNavHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [latestProjectId, setLatestProjectId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!user?.privyId) { setLatestProjectId(null); return; }
    async function loadProjects() {
      try {
        // Trailing slash is REQUIRED. The FastAPI route is registered at
        // /api/projects/ and the app has redirect_slashes=False, so a slash-
        // less URL 404s instead of redirecting. Matches the dashboard caller.
        const res = await fetch(`${API_BASE}/api/projects/?owner_id=${encodeURIComponent(user!.privyId)}`);
        if (res.ok) {
          const data = await res.json();
          const projects = Array.isArray(data) ? data : data.projects ?? [];
          // Merchant-role gate for the Go Live button: only surface it
          // when the user owns at least one project that's actually
          // live-eligible (status=live, review_status=approved, not
          // deleted). Drafts and pending projects don't qualify, so
          // non-merchants who only have an in-progress project don't
          // see Go Live in the navbar.
          const goLiveable = projects.filter((p: any) =>
            p && p.status === "live" && p.review_status === "approved" && p.is_deleted !== true
          );
          setLatestProjectId(goLiveable.length > 0 ? String(goLiveable[0].id) : null);
        }
      } catch {}
    }
    loadProjects();
  }, [user]);

  // Close mobile + user menus on route change
  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [path]);

  // Dismiss user dropdown when clicking outside
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-user-menu]")) setUserMenuOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  // Primary nav — simplified to the active-growth priorities.
  // Build, Dashboard, and AI Chat live in the authenticated user dropdown.
  // DUM Points link removed per CLAUDE.md v5.0 — Phase 2 unlock condition.
  // /hub page still works at direct URL, just not surfaced in nav.
  const links = [
    { href: "/discover", label: "Explore" },
    { href: "/business", label: "For Business" },
    { href: "/merchant", label: "Merchant" },
  ];

  // Items in the authenticated-user dropdown (and mirrored into mobile menu).
  const userMenuLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/orders", label: "Orders" },
    { href: "/chat", label: "AI Chat" },
  ];

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
          : "rgba(10,10,15,0.92)",
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
          className="flex items-center gap-2.5"
        >
          <img src="/dum-logo-icon.png" alt="DUM Club" className="h-8 w-auto" />
          <span className="text-[18px] font-bold tracking-tight">
            <span className="text-white">DUM </span><span style={{ color: "#00FFA3" }}>CLUB</span>
          </span>
          <span style={{ fontSize: "8px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#00FFA3", border: "1px solid rgba(0,255,163,0.25)", background: "rgba(0,255,163,0.08)", borderRadius: "5px", padding: "2px 6px", lineHeight: 1 }}>BETA</span>
        </Link>

        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "20px",
            background: "none",
            border: "1px solid #2a2a2a",
            color: menuOpen ? "#00FFB2" : "#b4b4cc",
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
          className="flex items-center gap-3"
          style={{ textDecoration: "none" }}
        >
          <img src="/dum-logo-icon.png" alt="DUM Club" className="h-10 w-auto" />
          <span className="text-[22px] font-bold tracking-tight">
            <span className="text-white">DUM </span><span style={{ color: "#00FFA3" }}>CLUB</span>
          </span>
          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#00FFA3", border: "1px solid rgba(0,255,163,0.25)", background: "rgba(0,255,163,0.08)", borderRadius: "6px", padding: "3px 7px", lineHeight: 1 }}>BETA</span>
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
                    e.currentTarget.style.color = "#b4b4cc";
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
                  color: active ? "#00FFB2" : "#b4b4cc",
                  border: active
                    ? "1px solid rgba(0,255,178,0.22)"
                    : "1px solid transparent",
                  fontFamily: "var(--font-geist-mono), monospace",
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
              {user && latestProjectId && (
                <Link
                  href={`/project/${latestProjectId}?golive=1`}
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: "11px",
                    fontWeight: 700,
                    color: "#fff",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    background: "#ef4444",
                    borderRadius: "10px",
                    padding: "8px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                  }}
                >
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
                  </span>
                  Go Live
                </Link>
              )}
              {/* DUM balance badge removed — CLAUDE.md v5.0 Phase 2 unlock. */}
              {loading ? (
                <button
                  type="button"
                  disabled
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
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
                <div data-user-menu style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setUserMenuOpen((o) => !o)}
                    title="Account menu"
                    aria-expanded={userMenuOpen}
                    style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: "12px",
                      color: "#00FFB2",
                      letterSpacing: "0.08em",
                      whiteSpace: "nowrap",
                      border: userMenuOpen
                        ? "1px solid rgba(0,255,178,0.35)"
                        : "1px solid rgba(0,255,178,0.22)",
                      background: userMenuOpen
                        ? "rgba(0,255,178,0.10)"
                        : "rgba(0,255,178,0.06)",
                      borderRadius: "14px",
                      padding: "13px 18px",
                      height: "52px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <span>{shortEmail}</span>
                    <span style={{ fontSize: "9px", opacity: 0.7, transform: userMenuOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s ease" }}>▼</span>
                  </button>

                  {userMenuOpen && (
                    <div
                      data-user-menu
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        minWidth: "220px",
                        background: "rgba(10,10,15,0.98)",
                        border: "1px solid rgba(0,255,178,0.18)",
                        borderRadius: "14px",
                        padding: "8px",
                        boxShadow: "0 16px 48px rgba(0,0,0,0.6), 0 0 24px rgba(0,255,178,0.08)",
                        backdropFilter: "blur(16px)",
                        WebkitBackdropFilter: "blur(16px)",
                      }}
                    >
                      {userMenuLinks.map((item) => {
                        const active = path === item.href;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setUserMenuOpen(false)}
                            style={{
                              display: "block",
                              padding: "11px 14px",
                              fontFamily: "var(--font-geist-mono), monospace",
                              fontSize: "12px",
                              fontWeight: 700,
                              letterSpacing: "0.12em",
                              textTransform: "uppercase",
                              textDecoration: "none",
                              color: active ? "#00FFB2" : "#d0d0d0",
                              background: active ? "rgba(0,255,178,0.08)" : "transparent",
                              borderRadius: "10px",
                              transition: "all 0.12s ease",
                            }}
                            onMouseEnter={(e) => {
                              if (!active) {
                                e.currentTarget.style.background = "rgba(0,255,178,0.06)";
                                e.currentTarget.style.color = "#00FFB2";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!active) {
                                e.currentTarget.style.background = "transparent";
                                e.currentTarget.style.color = "#d0d0d0";
                              }
                            }}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                      <div style={{ margin: "6px 10px", height: "1px", background: "rgba(255,255,255,0.06)" }} />
                      <button
                        type="button"
                        onClick={() => { setUserMenuOpen(false); logout(); }}
                        style={{
                          display: "block",
                          width: "100%",
                          padding: "11px 14px",
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: "12px",
                          fontWeight: 700,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          textAlign: "left",
                          color: "#f08080",
                          background: "transparent",
                          border: "none",
                          borderRadius: "10px",
                          cursor: "pointer",
                          transition: "all 0.12s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(240,128,128,0.08)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
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
                    fontFamily: "var(--font-geist-mono), monospace",
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
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "13px",
                fontWeight: 700,
                textDecoration: "none",
                color: active ? "#00FFB2" : "#b4b4cc",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
                borderBottom: "1px solid #111",
              }}
            >
              {l.label}
            </Link>
          );
        })}

        {/* DUM balance badge removed — CLAUDE.md v5.0 Phase 2 unlock. */}

        {mounted && user && latestProjectId && (
          <Link
            href={`/project/${latestProjectId}?golive=1`}
            onClick={() => setMenuOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              margin: "10px 20px 0",
              padding: "14px 18px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              textDecoration: "none",
              color: "#fff",
              background: "#ef4444",
              borderRadius: "14px",
            }}
          >
            <span style={{ position: "relative", width: 10, height: 10, display: "inline-flex" }}>
              <span style={{ position: "absolute", width: "100%", height: "100%", borderRadius: "50%", background: "#fff", opacity: 0.75, animation: "ping 1s cubic-bezier(0,0,0.2,1) infinite" }} />
              <span style={{ position: "relative", width: 10, height: 10, borderRadius: "50%", background: "#fff", display: "inline-flex" }} />
            </span>
            Go Live
          </Link>
        )}

        {/* Account section: Build / Dashboard / AI Chat for logged-in users. */}
        {mounted && user && (
          <div style={{ marginTop: "18px", padding: "0 20px" }}>
            <div
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: "9px",
                letterSpacing: "0.22em",
                color: "#555",
                textTransform: "uppercase",
                marginBottom: "6px",
                paddingLeft: "4px",
              }}
            >
              Account
            </div>
            {userMenuLinks.map((item) => {
              const active = path === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: "block",
                    padding: "12px 14px",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                    color: active ? "#00FFB2" : "#c8c8c8",
                    background: active ? "rgba(0,255,178,0.06)" : "transparent",
                    borderRadius: "10px",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        )}

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
                  fontFamily: "var(--font-geist-mono), monospace",
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
                  fontFamily: "var(--font-geist-mono), monospace",
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
                  fontFamily: "var(--font-geist-mono), monospace",
                  textTransform: "uppercase",
                  borderRadius: "14px",
                  width: "100%",
                }}
              >
                Continue with Google
              </button>
            )}

          </div>
        )}
      </div>
    )}
    </>
  );
}
