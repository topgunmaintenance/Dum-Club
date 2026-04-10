"use client";

import { useEffect, useState } from "react";

type GrowthContext = {
  business_name: string;
  business_status: "on_platform" | "not_on_platform";
  proof_count_for_business: number;
  user_visit_count: number;
  growth_tier: "just_discovered" | "growing" | "popular";
  impact_message: string;
};

type RewardToastProps = {
  points: number;
  campaignType: string | null;
  growth: GrowthContext | null;
  onClose: () => void;
};

const CAMPAIGN_DISPLAY: Record<string, { label: string; color: string; border: string; bg: string; icon: string }> = {
  lead_credit: {
    label: "New Business",
    color: "text-amber-300",
    border: "border-amber-400/30",
    bg: "from-amber-400/10 to-transparent",
    icon: "★",
  },
  first_visit: {
    label: "First Visit",
    color: "text-sky-300",
    border: "border-sky-400/30",
    bg: "from-sky-400/10 to-transparent",
    icon: "◆",
  },
  repeat_visit: {
    label: "Repeat Visit",
    color: "text-emerald-300",
    border: "border-emerald-400/30",
    bg: "from-emerald-400/10 to-transparent",
    icon: "●",
  },
};

const GROWTH_TIER_LABEL: Record<string, { text: string; color: string }> = {
  just_discovered: { text: "Just discovered", color: "text-amber-400/70" },
  growing: { text: "Growing", color: "text-sky-400/70" },
  popular: { text: "Popular on Dum Club", color: "text-emerald-400/70" },
};

export function RewardToast({ points, campaignType, growth, onClose }: RewardToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Animate in
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  function handleClose() {
    setExiting(true);
    setTimeout(onClose, 300);
  }

  const campaign = campaignType ? CAMPAIGN_DISPLAY[campaignType] : null;
  const tier = growth?.growth_tier ? GROWTH_TIER_LABEL[growth.growth_tier] : null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
        visible && !exiting ? "opacity-100" : "opacity-0"
      }`}
      onClick={handleClose}
    >
      <div
        className={`mx-4 w-full max-w-sm transform transition-all duration-300 ${
          visible && !exiting ? "translate-y-0 scale-100" : "translate-y-8 scale-95"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`overflow-hidden rounded-2xl border bg-zinc-950 shadow-2xl ${
            campaign?.border || "border-emerald-400/30"
          }`}
        >
          {/* Gradient accent bar */}
          <div className={`h-1 bg-gradient-to-r ${campaign?.bg || "from-emerald-400/30 to-transparent"}`} />

          <div className="p-6">
            {/* Points earned — the hero */}
            <div className="text-center">
              <div className="text-4xl font-black text-emerald-400">+{points} DUM</div>
              {campaign && (
                <div className="mt-2 inline-flex items-center gap-1.5">
                  <span className={`text-lg ${campaign.color}`}>{campaign.icon}</span>
                  <span className={`text-sm font-bold uppercase tracking-[0.15em] ${campaign.color}`}>
                    {campaign.label}
                  </span>
                </div>
              )}
            </div>

            {/* Impact message */}
            {growth && (
              <div className="mt-5 space-y-3">
                <p className="text-center text-sm leading-relaxed text-zinc-300">
                  {growth.impact_message}
                </p>

                {/* Growth stats */}
                <div className="flex items-center justify-center gap-4">
                  {growth.proof_count_for_business > 0 && (
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{growth.proof_count_for_business}</div>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                        verified {growth.proof_count_for_business === 1 ? "purchase" : "purchases"}
                      </div>
                    </div>
                  )}
                  {growth.user_visit_count > 0 && (
                    <div className="text-center">
                      <div className="text-lg font-bold text-white">{growth.user_visit_count}</div>
                      <div className="text-[10px] uppercase tracking-[0.15em] text-zinc-500">
                        your {growth.user_visit_count === 1 ? "visit" : "visits"}
                      </div>
                    </div>
                  )}
                </div>

                {/* Growth tier */}
                {tier && (
                  <div className="text-center">
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${tier.color}`}>
                      {tier.text}
                    </span>
                  </div>
                )}

                {/* Helper line */}
                <p className="text-center text-[11px] text-zinc-600">
                  You just helped grow {growth.business_name} on Dum Club
                </p>
              </div>
            )}

            {/* Close */}
            <button
              onClick={handleClose}
              className="mt-5 w-full rounded-xl bg-emerald-400 py-3 text-sm font-bold text-black transition hover:bg-emerald-300"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline growth signal for use on business cards or proof lists.
 * Shows a simple label: "Just discovered" / "Growing" / "Popular on Dum Club"
 */
export function GrowthSignal({ proofCount }: { proofCount: number }) {
  let tier: string;
  if (proofCount <= 1) tier = "just_discovered";
  else if (proofCount <= 5) tier = "growing";
  else tier = "popular";

  const cfg = GROWTH_TIER_LABEL[tier];

  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.15em] ${cfg.color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {cfg.text}
    </span>
  );
}
