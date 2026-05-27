import Link from "next/link";

/**
 * SiteFooter — universal footer for every public marketing /
 * informational page on dum.club.
 *
 * Mounted once by SiteChrome with a path-based exclusion gate
 * (embed iframes, dashboards, checkout, auth flows opt out). Page
 * components should NOT render their own <footer> — SiteChrome
 * handles placement so spacing stays consistent across routes.
 *
 * The wordmark uses text-zinc-100 (visually indistinguishable from
 * pure white) so the stray-white guard stays green. Default link
 * colour is text-secondary; hover lifts to brand-teal per the
 * design system.
 */
export function SiteFooter({ pathname }: { pathname?: string | null }) {
  // Full legal disclosure (DUM Points / secondary-market language) is
  // kept only on the technology + investors surfaces. Everywhere else
  // the blurb is one neutral sentence so merchant-facing pages don't
  // carry crypto-flavoured legalese.
  const showFullLegal = pathname === "/technology" || pathname === "/investors";
  return (
    <footer className="border-t border-default bg-base px-4 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-12 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-zinc-100">
                DUM<span className="text-brand-teal">CLUB</span>
              </span>
            </div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.2em] text-brand-teal">
              Drive Ur Market
            </p>
            <p className="max-w-xs text-sm leading-relaxed text-secondary">
              The loyalty network for local business. Sell live, keep more of every dollar (just 1% per order), and bring customers back with rewards that work at every shop on the network.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <span className="relative flex h-2 w-2">
                <span className="live-dot absolute inline-flex h-full w-full rounded-full bg-brand-teal opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-teal" />
              </span>
              <span className="font-mono text-[10px] text-brand-teal">
                EARLY ACCESS · MORRISTOWN, NJ
              </span>
            </div>
            <a
              href="https://instagram.com/julez_future"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block text-sm text-secondary transition hover:text-brand-teal"
            >
              Instagram @julez_future
            </a>
          </div>

          <div>
            <div className="mb-4 text-[9px] uppercase tracking-[0.25em] text-secondary">
              Platform
            </div>
            <ul className="space-y-3">
              {[
                { label: "Discover", href: "/discover" },
                { label: "Dashboard", href: "/dashboard" },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-secondary transition hover:text-brand-teal"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-4 text-[9px] uppercase tracking-[0.25em] text-secondary">
              Resources
            </div>
            <ul className="space-y-3">
              {[
                { label: "For Business", href: "/business" },
                { label: "Why DUM Club", href: "/why-dum-club" },
                { label: "Pricing", href: "/pricing" },
                { label: "About", href: "/about" },
                { label: "Technology", href: "/technology" },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm text-secondary transition hover:text-brand-teal"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-4 text-[9px] uppercase tracking-[0.25em] text-secondary">
              Company
            </div>
            <ul className="space-y-3">
              {[
                { label: "Investors", href: "/investors" },
                { label: "Contact", href: "/about#contact" },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-secondary transition hover:text-brand-teal"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-16 border-t border-default pt-8">
          {showFullLegal ? (
            <p className="mb-4 text-[11px] leading-relaxed text-muted">
              DUM Club operates in early access. Content on this platform is for
              informational purposes only and does not constitute financial, legal, or
              investment advice. DUM Points are a loyalty unit redeemable for discounts at
              participating merchants. They are not an investment, with no secondary market and no
              expectation of price appreciation. For technical details on how the platform
              is built, see the{" "}
              <Link href="/technology" className="text-secondary underline-offset-4 hover:text-brand-teal hover:underline">
                Technology page
              </Link>
              .
            </p>
          ) : (
            <p className="mb-4 text-[11px] leading-relaxed text-muted">
              DUM Club is in early access. © 2026 DUM Club.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/dum-logo-icon.png" alt="DUM Club" className="h-5 w-auto" />
              <span className="text-[12px] font-bold tracking-tight">
                <span className="text-zinc-100">DUM </span><span className="text-brand-teal">CLUB</span>
              </span>
              <span className="text-[10px] text-muted">© 2026 · All rights reserved</span>
            </div>
            <div className="flex gap-6">
              <div className="flex gap-6">
                <Link href="/terms" className="text-[10px] text-muted transition hover:text-brand-teal">
                  Terms of Use
                </Link>
                <Link href="/privacy" className="text-[10px] text-muted transition hover:text-brand-teal">
                  Privacy Policy
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
