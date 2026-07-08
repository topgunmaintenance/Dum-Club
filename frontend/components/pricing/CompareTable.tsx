/**
 * CompareTable — Whatnot-at-$10k side-by-side + full comparison table.
 *
 * Moved verbatim from /business (CompareTab) during the pricing-page
 * consolidation. Static JSX, no hooks, so it stays server-compatible.
 * Competitor set (Whatnot / Commonsold / Google Maps / DUM Club) is
 * the doctrine-approved list per CLAUDE.md §11 — do not add or remove.
 */

import Link from "next/link";

export function CompareTable() {
  return (
    <>
      {/* Whatnot side-by-side */}
      <section className="mb-16">
        <div className="overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.04] to-surface-card">
          <div className="grid gap-0 sm:grid-cols-2">
            <div className="border-b border-default p-8 sm:border-b-0 sm:border-r">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-state-live">The Whatnot tax</div>
              <h3 className="mb-4 text-xl font-extrabold text-primary sm:text-2xl">
                You sell $10,000/mo on Whatnot.<br />
                <span className="text-state-live">They keep $1,150.</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-state-live/[0.04] px-4 py-2">
                  <span className="text-[12px] text-secondary">Platform fee (up to 8%)</span>
                  <span className="font-mono text-[13px] font-bold text-state-live">−$800</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-red-500/10 bg-state-live/[0.04] px-4 py-2">
                  <span className="text-[12px] text-secondary">Processing (2.9% + $0.30)</span>
                  <span className="font-mono text-[13px] font-bold text-state-live">−$350</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-surface-muted px-4 py-2">
                  <span className="text-[12px] font-bold text-primary">You keep</span>
                  <span className="font-mono text-[14px] font-bold text-primary">$8,850</span>
                </div>
              </div>
            </div>

            <div className="p-8">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-teal">The DUM Club way</div>
              <h3 className="mb-4 text-xl font-extrabold text-primary sm:text-2xl">
                Same $10,000/mo.<br />
                <span className="text-brand-teal">You keep $9,901.</span>
              </h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft px-4 py-2">
                  <span className="text-[12px] text-secondary">Flat monthly fee</span>
                  <span className="font-mono text-[13px] font-bold text-brand-teal">−$99</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-surface-muted px-4 py-2">
                  <span className="text-[12px] text-secondary">Commission on sales</span>
                  <span className="font-mono text-[13px] font-bold text-brand-teal">$0</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-default bg-brand-teal-soft px-4 py-2">
                  <span className="text-[12px] font-bold text-brand-teal">You keep</span>
                  <span className="font-mono text-[14px] font-bold text-brand-teal">$9,901</span>
                </div>
              </div>
              <div className="mt-5 rounded-xl bg-brand-teal-soft border border-default p-3 text-center">
                <span className="font-mono text-2xl font-black text-brand-teal">+$1,051</span>
                <span className="ml-2 text-[12px] text-brand-teal">more in your pocket every month</span>
              </div>
              <Link href="/merchant" className="mt-4 block w-full rounded-xl bg-brand-teal py-3 text-center text-[13px] font-bold text-black transition hover:bg-brand-teal-hover">
                Switch from Whatnot. Free →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Full comparison table */}
      <section>
        <div className="mb-8 text-center">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-brand-teal">The real difference</div>
          <h2 className="mx-auto max-w-2xl text-2xl font-extrabold leading-tight tracking-tight text-primary sm:text-3xl">
            Whatnot takes up to 8%.{" "}
            <span className="text-brand-teal">DUM Club takes 1.5%.</span>
          </h2>
        </div>

        <div className="mx-auto max-w-4xl overflow-x-auto">
          <table className="w-full border-collapse font-mono text-[11px]" style={{ minWidth: "600px" }}>
            <thead>
              <tr className="border-b border-default">
                <th className="py-3 pr-4 text-left text-[9px] uppercase tracking-[0.12em] text-muted"> </th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-muted">Whatnot</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-muted">Commonsold</th>
                <th className="px-3 py-3 text-center text-[9px] uppercase tracking-[0.12em] text-muted">Google Maps</th>
                <th className="px-4 py-3 text-center text-[9px] uppercase tracking-[0.14em] text-brand-teal" style={{ background: "rgba(0,255,135,0.04)", borderRadius: "8px 8px 0 0", border: "1px solid rgba(0,255,135,0.12)", borderBottom: "none" }}>DUM Club</th>
              </tr>
            </thead>
            <tbody>
              {[
                { f: "Fee model", w: "Up to 8% + 2.9%", c: "% per sale", g: "Pay for ads", d: "Starting at $39/mo + 1.5%" },
                { f: "Per-sale commission", w: "Up to 8%", c: "Varies", g: "none", d: "1.5% only" },
                { f: "Live selling", w: "Yes", c: "Yes", g: "No", d: "Yes" },
                { f: "Local discovery", w: "No", c: "No", g: "Pay to rank", d: "Free + deals" },
                { f: "Loyalty built in", w: "None", c: "Basic", g: "None", d: "Every tier" },
                { f: "Bring customers back", w: "None", c: "None", g: "None", d: "Built in" },
                { f: "AI social media", w: "None", c: "None", g: "None", d: "Pro tier" },
                { f: "White-label loyalty", w: "None", c: "None", g: "None", d: "$499/mo+" },
              ].map((row, i) => (
                <tr key={i} className="border-b border-default">
                  <td className="py-3 pr-4 text-[12px] font-medium text-secondary" style={{ fontFamily: "'DM Sans', sans-serif" }}>{row.f}</td>
                  <td className="px-3 py-3 text-center text-muted">{row.w}</td>
                  <td className="px-3 py-3 text-center text-muted">{row.c}</td>
                  <td className="px-3 py-3 text-center text-muted">{row.g}</td>
                  <td className="px-4 py-3 text-center font-semibold text-brand-teal" style={{
                    background: "rgba(0,255,135,0.04)",
                    borderLeft: "1px solid rgba(0,255,135,0.12)",
                    borderRight: "1px solid rgba(0,255,135,0.12)",
                    ...(i === 7 ? { borderBottom: "1px solid rgba(0,255,135,0.12)", borderRadius: "0 0 8px 8px" } : {}),
                  }}>{row.d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { icon: "🚫", title: "Just 1.5% per sale" },
            { icon: "💰", title: "Flat monthly fee" },
            { icon: "🔁", title: "Loyalty built in" },
            { icon: "⚡", title: "Stripe payouts" },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-default bg-surface-card p-4 text-center transition hover:border-default">
              <div className="mb-2 text-xl">{c.icon}</div>
              <div className="text-[12px] font-bold text-primary">{c.title}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link href="/merchant" className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-teal px-8 py-4 text-sm font-bold text-black transition hover:bg-brand-teal-hover">
            Put Your Shop On Air →
          </Link>
        </div>
      </section>
    </>
  );
}
