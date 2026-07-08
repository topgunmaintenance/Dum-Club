"use client";

/**
 * SolanaAdvanced — code-split bundle for the Solana-dependent
 * portion of /hub (Phase 14, CLAUDE.md §12 Rule 3).
 *
 * Hub renders this component via next/dynamic with `ssr: false`,
 * so the @privy-io/react-auth/solana SDK + transitive
 * @solana/web3.js dependency only ship to the buyer's browser
 * when they explicitly open the on-chain claim tab. The hub's
 * default (off-chain) DUM Points view never pays the bundle cost.
 *
 * The component is a 1:1 lift of the original ClaimTab function
 * that lived in hub/page.tsx (lines 412-746 prior to Phase 14).
 * All Solana web3.js named imports were unused at runtime; they
 * came in alongside useSolanaWallets but the page never called
 * Connection / PublicKey / SystemProgram / Transaction directly.
 * Dropped them to keep the new file's import surface honest.
 */

import { useEffect, useState } from "react";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

import { useAuth } from "../../lib/auth/AuthContext";
import { API_BASE } from "../../lib/apiBase";

type ClaimState =
  | "idle"
  | "preparing"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

// Local copy of formatTimeAgo from hub/page.tsx — duplicated rather
// than imported to keep this code-split bundle from re-importing the
// page chunk (which would defeat the split).
function formatTimeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function SolanaAdvanced({
  balance,
  onBalanceUpdate,
}: {
  balance: number;
  onBalanceUpdate: (b: number) => void;
}) {
  const { wallets: privyWallets, createWallet } = useSolanaWallets();
  const privyWallet = privyWallets[0] || null;
  const walletAddress = privyWallet?.address || null;
  const { getToken, user } = useAuth();
  const [claimState, setClaimState] = useState<ClaimState>("idle");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{
    dum: number;
    sig: string;
    mint: string;
    mode: string;
  } | null>(null);
  const [onChainBalance, setOnChainBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [claimHistory, setClaimHistory] = useState<
    { amount: number; reference_id: string; created_at: string }[]
  >([]);
  const [claimable, setClaimable] = useState<{
    claimable: number;
    total_earned: number;
    total_claimed: number;
  } | null>(null);

  function copyToClipboard(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function friendlyError(msg: string): string {
    if (msg.includes("Not found") || msg.includes("404"))
      return "Token claim is coming soon. It is not available yet.";
    if (msg.includes("wait") && msg.includes("seconds")) return msg;
    if (msg.includes("wallet"))
      return "Wallet not connected. Please wait for your wallet to set up or refresh the page.";
    if (msg.includes("401") || msg.includes("auth") || msg.includes("Auth"))
      return "Please sign in to claim DUM tokens.";
    if (msg.includes("429") || msg.includes("limit")) return msg;
    if (
      msg.includes("insufficient") ||
      msg.includes("gas") ||
      msg.includes("lamport")
    )
      return "You need devnet SOL for gas fees. Visit a Solana faucet to get free devnet SOL.";
    if (msg.includes("network") || msg.includes("Network"))
      return "Network error. Check your connection and try again.";
    return msg || "Something went wrong. Please try again.";
  }

  useEffect(() => {
    if (user && !privyWallet) {
      createWallet().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, privyWallet]);

  useEffect(() => {
    if (!user?.privyId) return;
    fetch(`${API_BASE}/api/dum/transactions/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => {
        const claims = (d.transactions || [])
          .filter((t: { reason?: string }) => t.reason === "claim")
          .slice(0, 5);
        setClaimHistory(claims);
      })
      .catch(() => {});
    fetch(`${API_BASE}/api/dum/claimable/${user.privyId}`)
      .then((r) => r.json())
      .then((d) => setClaimable(d))
      .catch(() => {});
  }, [user?.privyId, claimState]);

  useEffect(() => {
    if (!walletAddress) {
      setOnChainBalance(null);
      return;
    }
    fetch(`${API_BASE}/api/dum/balance-onchain/${walletAddress}`)
      .then((r) => r.json())
      .then((d) => setOnChainBalance(d.balance ?? null))
      .catch(() => setOnChainBalance(null));
  }, [walletAddress, claimState]);

  const claimableNow = claimable?.claimable ?? null;
  const claimAmount = claimableNow !== null ? claimableNow : 0;
  const canClaim = claimAmount > 0 && !!walletAddress && claimState === "idle";

  async function handleClaim() {
    if (!walletAddress || !canClaim) return;

    setClaimState("preparing");
    setClaimError(null);
    setClaimResult(null);

    try {
      const token = await getToken();
      if (!token) throw new Error("Please sign in to claim DUM tokens.");

      setClaimState("submitting");
      const res = await fetch(`${API_BASE}/api/dum/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          wallet_address: walletAddress,
          amount: claimAmount,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Claim failed (${res.status})`);
      }

      setClaimState("confirming");
      const data = await res.json();

      const newBal = data.new_balance || balance + (data.dum_received || 0);
      localStorage.setItem("dum_points", String(newBal));
      window.dispatchEvent(new Event("dum-points-update"));
      onBalanceUpdate(newBal);

      fetch(`${API_BASE}/api/dum/balance-onchain/${walletAddress}`)
        .then((r) => r.json())
        .then((d) => setOnChainBalance(d.balance ?? null))
        .catch(() => {});

      setClaimResult({
        dum: data.dum_received,
        sig: data.tx_signature || "",
        mint: data.mint || "",
        mode: data.mode || "db-only",
      });
      setClaimState("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Claim failed";
      setClaimError(friendlyError(msg));
      setClaimState("error");
    }
  }

  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : "";
  const hasTxSig = claimResult?.sig && claimResult.sig.length > 20;

  const claimButtonLabel =
    {
      idle: `Claim All ${claimAmount.toLocaleString()} DUM`,
      preparing: "Preparing...",
      submitting: "Submitting to Solana...",
      confirming: "Confirming...",
      success: "Claimed!",
      error: "Try Again",
    }[claimState] || "Claim";

  return (
    <div className="mx-auto max-w-md">
      {claimState === "success" && claimResult ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-default bg-gradient-to-br from-brand-teal-soft to-surface-card p-6 text-center">
            <div className="mb-3 text-3xl">✓</div>
            <div className="text-xl font-black text-primary">DUM Claimed to Wallet</div>
            <div className="mt-2 flex items-baseline justify-center gap-2">
              <span className="text-3xl font-black text-brand-teal">+{claimResult.dum.toLocaleString()}</span>
              <span className="text-sm text-secondary">DUM</span>
            </div>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-teal-soft px-3 py-1 text-[10px] font-bold text-brand-teal">
              {hasTxSig ? "Minted on Solana Devnet" : "Earned DUM released to balance"}
            </div>
            {onChainBalance !== null && (
              <div className="mt-2 text-[11px] text-secondary">On-chain wallet balance: {onChainBalance.toLocaleString()} DUM</div>
            )}
          </div>

          {(hasTxSig || walletAddress) && (
            <div className="rounded-2xl border border-default bg-surface-card p-5 space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary mb-3">
                {hasTxSig ? "On-chain Proof" : "Wallet Info"}
              </div>
              {hasTxSig && claimResult && (
                <div className="flex items-center gap-2 rounded-xl bg-surface-muted px-4 py-3">
                  <a href={`https://explorer.solana.com/tx/${claimResult.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <div className="text-[12px] font-semibold text-primary">Transaction</div>
                    <div className="mt-0.5 font-mono text-[9px] text-muted">{claimResult.sig.slice(0, 16)}...{claimResult.sig.slice(-8)}</div>
                  </a>
                  <button onClick={() => copyToClipboard(claimResult.sig, "tx")} className="rounded-lg border border-default bg-surface-muted px-2.5 py-1.5 text-[9px] text-secondary hover:text-brand-teal">{copied === "tx" ? "✓" : "Copy"}</button>
                  <a href={`https://explorer.solana.com/tx/${claimResult.sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-default bg-surface-muted px-2.5 py-1.5 text-[9px] text-brand-teal hover:text-brand-teal">View →</a>
                </div>
              )}
              {walletAddress && (
                <div className="flex items-center gap-2 rounded-xl bg-surface-muted px-4 py-3">
                  <a href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <div className="text-[12px] font-semibold text-primary">Your Wallet</div>
                    <div className="mt-0.5 font-mono text-[9px] text-muted">{shortWallet}</div>
                  </a>
                  <a href={`https://explorer.solana.com/address/${walletAddress}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-default bg-surface-muted px-2.5 py-1.5 text-[9px] text-brand-teal hover:text-brand-teal">View →</a>
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { setClaimState("idle"); setClaimResult(null); setCopied(null); }}
            className="w-full rounded-xl border border-default px-6 py-3 text-sm text-primary transition hover:border-strong hover:text-primary"
          >
            Claim more
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-2xl border border-default bg-surface-card p-4">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Wallet</div>
              <div className="flex items-center gap-1.5 rounded-full border border-default bg-surface-muted px-2.5 py-1 text-[9px] font-bold text-secondary">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Solana Devnet
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div>
                {walletAddress ? (
                  <div className="font-mono text-sm text-primary">{shortWallet}</div>
                ) : (
                  <div className="text-sm text-secondary">Connecting wallet...</div>
                )}
              </div>
              {walletAddress && (
                <button onClick={() => copyToClipboard(walletAddress, "wallet")} className="text-[9px] text-muted hover:text-brand-teal">
                  {copied === "wallet" ? "✓ Copied" : "Copy address"}
                </button>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 border-t border-default pt-3">
              <div>
                <div className="text-[9px] uppercase tracking-[0.15em] text-muted">Total Balance</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-primary">{balance.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.15em] text-brand-teal/60">Claimable</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-brand-teal">
                  {claimableNow !== null ? claimableNow.toLocaleString() : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.15em] text-muted">On-chain</div>
                <div className="mt-0.5 font-mono text-sm font-bold text-secondary">
                  {onChainBalance !== null ? onChainBalance.toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-default bg-surface-card p-6">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Claim Earned DUM</div>
            <p className="mb-4 text-[12px] text-secondary">
              Release earned DUM to your Solana wallet. Minted as real SPL tokens on devnet.
            </p>

            {claimableNow !== null && claimableNow === 0 ? (
              <div className="rounded-xl border border-default bg-surface-muted p-5 text-center">
                <div className="text-sm font-bold text-secondary">Nothing to claim yet</div>
                <p className="mt-2 text-[12px] text-muted">
                  Earn DUM by creating businesses, adding offers, making purchases, or referring friends.
                </p>
                <div className="mt-3 text-[10px] text-muted">
                  Earned: {claimable?.total_earned?.toLocaleString() || 0} · Claimed: {claimable?.total_claimed?.toLocaleString() || 0}
                </div>
              </div>
            ) : (
              <>
                {claimableNow !== null && (
                  <div className="mb-4 rounded-xl border border-default bg-brand-teal-soft p-4 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-brand-teal/60">Available to claim</div>
                    <div className="mt-1 font-mono text-3xl font-black text-brand-teal">{claimableNow.toLocaleString()}</div>
                    <div className="mt-0.5 text-[10px] text-muted">DUM earned from activity</div>
                  </div>
                )}

                <button
                  onClick={claimState === "error" ? () => setClaimState("idle") : handleClaim}
                  disabled={!canClaim}
                  className={`w-full rounded-xl px-6 py-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    claimState === "error"
                      ? "bg-surface-muted text-primary hover:bg-surface-muted"
                      : "bg-brand-teal text-brand-navy hover:bg-brand-teal-hover hover:text-white"
                  }`}
                >
                  {!walletAddress ? "Setting up wallet..." : claimButtonLabel}
                </button>
              </>
            )}

            {claimState === "error" && claimError && (
              <div className="mt-3 rounded-lg border border-[var(--state-live)]/30 bg-[var(--state-live)]/10 px-4 py-3 text-xs text-state-live">
                {claimError}
              </div>
            )}

            {claimState !== "idle" && claimState !== "error" && claimState !== "success" && (
              <div className="mt-3 text-center text-[10px] text-muted">
                {claimState === "preparing" && "Preparing your claim..."}
                {claimState === "submitting" && "Submitting transaction to Solana devnet..."}
                {claimState === "confirming" && "Confirming on-chain..."}
              </div>
            )}
          </div>
        </>
      )}

      {claimHistory.length > 0 && (
        <div className="mt-6 rounded-2xl border border-default bg-surface-card p-5">
          <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-secondary">Claim History</div>
          <div className="space-y-2">
            {claimHistory.map((c, i) => {
              const hasSig = c.reference_id && c.reference_id.length > 30;
              return (
                <div key={i} className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-brand-teal">+{c.amount}</span>
                    <span className="text-[11px] text-secondary">Claimed to wallet</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted">{c.created_at ? formatTimeAgo(c.created_at) : ""}</span>
                    {hasSig && (
                      <a
                        href={`https://explorer.solana.com/tx/${c.reference_id}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md border border-default bg-surface-muted px-2 py-1 text-[8px] font-bold text-brand-teal transition hover:text-brand-teal"
                      >
                        Tx →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
