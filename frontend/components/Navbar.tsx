"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useAuth } from "../lib/auth/AuthContext";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => ({
      default: m.WalletMultiButton,
    })),
  { ssr: false }
);

export function Navbar() {
  const path = usePathname();
  const { wallets } = useSolanaWallets();
  const wallet = wallets[0];
  const address = wallet?.address;
  const connected = !!address;
  const { user, loading, login, logout } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [navHover, setNavHover] = useState(false);
  const [brandHover, setBrandHover] = useState(false);

  useEffect(() => setMounted(true), []);

  const links = [
    { href: "/discover", label: "Discover" },
    { href: "/build", label: "Build" },
    { href: "/dashboard", label: "Dashboard" },
    { href: "/chat", label: "AI Chat" },
  ];

  const shortAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : "";

  return (
    <nav
      onMouseEnter={() => setNavHover(true)}
      onMouseLeave={() => setNavHover(false)}
      style={{
        borderBottom: navHover
          ? "1px solid rgba(0,255,178,0.30)"
          : "1px solid #1c1c1c",
        padding: "20px 32px",
        display: "grid",
        gridTemplateColumns: "300px 1fr 560px",
        alignItems: "center",
        position: "sticky",
        top: 0,
        background: navHover
          ? "rgba(0,255,178,0.035)"
          : "rgba(6,6,6,0.92)",
        backdropFilter: "blur(16px)",
        zIndex: 50,
        minHeight: "92px",
        transition: "all 0.22s ease",
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
          BETA
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
          gap: "14px",
          minHeight: "52px",
        }}
      >
        {mounted && (
          <>
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
                {user.email
                  ? user.email.slice(0, 6) +
                    "..." +
                    user.email.slice(-4)
                  : user.walletAddress
                    ? user.walletAddress.slice(0, 6) +
                      "..." +
                      user.walletAddress.slice(-4)
                    : ""}
              </button>
            ) : (
              <button
                type="button"
                onClick={login}
                style={{
                  background: "none",
                  border: "1px solid #2a2a2a",
                  color: "#e8e8e8", // make sure this is explicitly set
                  padding: "13px 18px",
                  fontSize: "12px",
                  letterSpacing: "0.13em",
                  cursor: "pointer",
                  fontFamily: "'Space Mono', monospace",
                  textTransform: "uppercase",
                  borderRadius: "14px",
                  height: "52px",
                  minWidth: "220px",
                }}
              >
                Continue with Google
              </button>
            )}

            {connected ? (
              <>
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
                  {shortAddress}
                </div>

                <button
                  type="button"
                  className="dum-wallet-btn"
                  onClick={() => wallet?.disconnect()}
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
                    boxShadow: "none",
                    height: "52px",
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <WalletMultiButton
                className="dum-wallet-btn"
                style={{
                  background: "none",
                  border: "1px solid #2a2a2a",
                  color: "#e8e8e8",
                  borderRadius: "14px",
                  padding: "13px 20px",
                  fontSize: "12px",
                  fontWeight: 700,
                  letterSpacing: "0.13em",
                  fontFamily: "'Space Mono', monospace",
                  textTransform: "uppercase",
                  boxShadow: "none",
                  height: "52px",
                  minWidth: "190px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              />
            )}
          </>
        )}
      </div>
    </nav>
  );
}
