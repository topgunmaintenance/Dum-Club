"use client";

import { useState } from "react";
import { RewardToast } from "./RewardToast";
import { API_BASE } from "../lib/apiBase";

type GrowthContext = {
  business_name: string;
  business_status: "on_platform" | "not_on_platform";
  proof_count_for_business: number;
  user_visit_count: number;
  growth_tier: "just_discovered" | "growing" | "popular";
  impact_message: string;
};

type Props = {
  businessId: string;
  businessName: string;
  buyerPrivyId: string;
  onClose: () => void;
  onSubmitted?: (proofId: string, potentialReward: number) => void;
};

export function ProofOfPurchaseModal({ businessId, businessName, buyerPrivyId, onClose, onSubmitted }: Props) {
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split("T")[0]);
  const [receiptText, setReceiptText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Result states
  const [submitted, setSubmitted] = useState(false);
  const [autoVerified, setAutoVerified] = useState(false);
  const [potentialReward, setPotentialReward] = useState(0);
  const [pointsAwarded, setPointsAwarded] = useState(0);
  const [campaignType, setCampaignType] = useState<string | null>(null);
  const [growthContext, setGrowthContext] = useState<GrowthContext | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      setError("Enter a valid purchase amount.");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/external/submit-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_business_id: businessId,
          buyer_privy_id: buyerPrivyId,
          receipt_text: receiptText,
          purchase_amount_usd: amountNum,
          purchase_date: purchaseDate,
        }),
      });

      if (res.status === 409) {
        setError("You already submitted a proof for this purchase.");
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Failed to submit proof.");
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      const isAutoVerified = data.agent?.auto_verified === true;

      setPotentialReward(data.potential_reward || 0);
      setAutoVerified(isAutoVerified);
      setSubmitted(true);

      if (isAutoVerified) {
        setPointsAwarded(data.agent?.points_awarded || 0);
        setCampaignType(data.campaign_type || null);
        setGrowthContext(data.growth || null);
      }

      onSubmitted?.(data.proof_id, data.potential_reward || 0);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Auto-verified: show the RewardToast
  if (submitted && autoVerified && pointsAwarded > 0) {
    return (
      <RewardToast
        points={pointsAwarded}
        campaignType={campaignType}
        growth={growthContext}
        onClose={onClose}
      />
    );
  }

  // Submitted but pending review
  if (submitted) {
    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
          <div className="text-center">
            <div className="mb-3 text-3xl">✓</div>
            <div className="text-lg font-bold text-white">Proof submitted</div>
            <p className="mt-2 text-sm text-zinc-400">
              Your purchase at <span className="font-medium text-white">{businessName}</span> is under review.
              {potentialReward > 0 && (
                <> You&apos;ll earn up to <span className="font-semibold text-emerald-400">{potentialReward} DUM Points</span> once verified.</>
              )}
            </p>
            <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">What happens next</div>
              <p className="mt-1.5 text-[12px] text-zinc-400">
                Our team reviews your proof. Once verified, you&apos;ll earn DUM Points and help this business grow on the platform.
              </p>
            </div>
            <button onClick={onClose} className="mt-5 w-full rounded-xl bg-emerald-400 py-3 text-sm font-bold text-black transition hover:bg-emerald-300">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Submission form
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400/60">Verify your purchase</div>
          <div className="mt-1 text-base font-bold text-white">{businessName}</div>
          <p className="mt-1 text-[12px] text-zinc-500">
            Submit your purchase details to earn DUM Points. We&apos;ll verify and reward you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-400">Amount spent ($)</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 25.00"
              required
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-400">Purchase date</label>
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-white outline-none focus:border-zinc-600"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-zinc-400">Receipt details (optional)</label>
            <textarea
              value={receiptText}
              onChange={(e) => setReceiptText(e.target.value)}
              placeholder="Order number, items purchased, or any receipt info"
              rows={2}
              className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-zinc-600"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-zinc-800 py-2.5 text-sm text-zinc-400 transition hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-emerald-400 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit proof"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
