/**
 * LiveOnYourSiteHome, the homepage (founder direction 2026-10-19).
 *
 * The pitch is "go live on your own website": one line of code, a live
 * video card in the corner of the merchant's own site, customers buy
 * without leaving the page. The dum.club shop page is the fallback for
 * businesses with no website, not the lead. Red and white look.
 *
 * Sections, top to bottom: red hero with a phone mockup of a pizzeria
 * site carrying the live card, the "works on" strip, three steps, the
 * interactive go-live demo (#demo, GoLiveDemoPhone, unchanged), the
 * always-open states, the no-website fallback, the pricing strip, and
 * the Discover band. The Discover feed itself lives on /discover.
 *
 * Honesty rules (CLAUDE.md §12) still hold: the mockup photos are stock
 * images of an example shop, the LIVE pill only appears on the mockup
 * of a shop being live, and the replay state wears a black REPLAY pill,
 * never red, so red keeps meaning live.
 */

import Link from "next/link";
import { GoLiveDemoPhone } from "./GoLiveDemoPhone";

const SNIPPET =
  '<script src="https://www.dum.club/embed.js" data-business-id="your-shop"></script>';

const MENU = [
  { name: "Grandma pie", price: "$23", img: "/images/home/pie.jpg" },
  { name: "Chicken parm", price: "$15", img: "/images/home/parm.jpg" },
  { name: "Cannoli", price: "$6", img: "/images/home/cannoli.jpg" },
];

function LivePill({ small }: { small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-state-live font-extrabold uppercase tracking-[0.14em] text-white ${
        small ? "px-[7px] py-[3px] text-[8px]" : "px-2.5 py-1 text-[10px]"
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
      Live
    </span>
  );
}

function PrimaryButton({
  href,
  children,
  onRed,
}: {
  href: string;
  children: React.ReactNode;
  onRed?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-full px-7 py-4 text-base font-extrabold transition hover:brightness-95 ${
        onRed ? "bg-white text-dum-red" : "bg-dum-red text-white"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * Phone mockup of a REAL merchant site: topgunmaintenance.com, founding
 * merchant #1, which has the DUM embed installed today. The bubble is
 * drawn in its offline REPLAY state (black pill, no viewer count)
 * because Topgun is not broadcasting while a visitor reads this page;
 * CLAUDE.md section 12 forbids a LIVE tag on a real shop that is not
 * live. Photo is the merchant's own (topgunmaintenance.com/images).
 */
function SiteWithBubble() {
  return (
    <div
      className="relative h-[560px] w-[340px] overflow-hidden rounded-[28px] bg-[#0f1a2b] text-[12px] shadow-[0_30px_70px_rgba(11,18,32,0.35),0_0_0_1px_rgba(255,255,255,0.08)] sm:w-[360px]"
      aria-label="topgunmaintenance.com, a real merchant site, with the DUM live card in the corner"
      role="img"
    >
      <div className="flex h-12 items-center justify-between bg-[#ff6a2b] px-4 text-[11px] font-bold text-[#1a1a1a]">
        <span>AOG? Call or text (201) 452-1986</span>
        <span className="text-[10px] font-semibold">Message Us</span>
      </div>
      <div className="flex flex-col gap-2 px-5 pt-7 text-center">
        <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#3fd0ff]">
          Strictly mobile A&amp;P/IA mechanic
        </div>
        <div className="text-[30px] font-black leading-[1] tracking-wide text-white">TOPGUN</div>
        <div className="text-[30px] font-black leading-[1] tracking-wide text-[#ff6a2b]">MAINTENANCE</div>
        <div className="mx-auto max-w-[260px] pt-1 text-[11px] leading-snug text-white/70">
          An FAA A&amp;P/IA comes to your hangar with the tools, does the work by the book, and gets you back in the air.
        </div>
      </div>
      <div className="mt-5 flex flex-col gap-2.5 px-5">
        {[
          ["WHAT WE DO", "Professional Aircraft Maintenance & Inspections"],
          ["WHERE WE GO", "Your Hangar or Tie Down in NJ, NY, PA"],
          ["WHEN YOU NEED US", "AOG & Emergency Response Available"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-md border-t-2 border-[#3fd0ff] bg-[#182642] px-4 py-3 text-center">
            <div className="text-[8px] font-semibold uppercase tracking-[0.22em] text-[#3fd0ff]">{k}</div>
            <div className="mt-1 text-[11px] font-semibold text-white">{v}</div>
          </div>
        ))}
      </div>

      {/* The DUM live card, bottom right of the merchant's own page. */}
      <div className="absolute bottom-4 right-4 flex w-[132px] flex-col gap-1.5">
        <div className="flex items-center gap-1.5 rounded-[10px] bg-white px-2 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
          <img
            src="/images/home/topgun-jacking.jpg"
            alt=""
            width={24}
            height={24}
            className="h-6 w-6 shrink-0 rounded-md object-cover"
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="text-[7px] font-extrabold tracking-[0.14em] text-dum-red">FEATURED</div>
            <div className="truncate text-[10px] font-semibold text-[#1a1a1a]">Annual Inspection</div>
          </div>
          <div className="font-mono text-[10px] font-bold text-dum-red-700">$850</div>
        </div>
        <div className="relative h-[208px] w-[132px] overflow-hidden rounded-2xl bg-[#16213a] shadow-[0_16px_36px_rgba(0,0,0,0.45)]">
          <img
            src="/images/home/topgun-pilot.jpg"
            alt=""
            width={132}
            height={208}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#1a1a1a] px-[7px] py-[3px] text-[8px] font-extrabold uppercase tracking-[0.14em] text-white">
            <svg aria-hidden="true" width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Replay
          </div>
          <div
            className="absolute right-[7px] top-[7px] flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[12px] font-bold text-[#1a1a1a]"
            aria-hidden="true"
          >
            ×
          </div>
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-b from-transparent to-[rgba(11,18,32,0.85)] px-2 pb-2 pt-[30px]">
            <div className="text-[10px] font-bold text-white">Topgun Maintenance</div>
            <div className="text-[9px] font-semibold text-white/85">Watch the last show</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LiveOnYourSiteHome() {
  return (
    <main className="bg-white text-[#1a1a1a]">
      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="bg-dum-red">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-12 px-4 pb-14 pt-16">
          <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-[22px]">
            <p className="text-xs font-extrabold tracking-[0.18em] text-white">ALWAYS BE LIVE!</p>
            <h1 className="text-[clamp(40px,6vw,58px)] font-black leading-[1.05] tracking-[-0.02em] text-white">
              Go live on your own website.
            </h1>
            <p className="max-w-[560px] text-lg leading-relaxed text-dum-red-ink-soft sm:text-[19px]">
              Paste one line on your site. A small live video shows up in the corner. Your
              customers watch your show and buy right there, without leaving your page.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <PrimaryButton href="/merchant" onRed>
                Start your 30 day free trial
              </PrimaryButton>
              <a
                href="#demo"
                className="inline-flex items-center gap-2 rounded-full border-2 border-white/70 px-[22px] py-[14px] text-base font-bold text-white transition hover:bg-white/10"
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                Watch a 30 second demo
              </a>
            </div>
            <p className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-sm text-dum-red-ink-soft">
              <span>No new website</span>
              <span aria-hidden="true">·</span>
              <span>No app to download</span>
              <span aria-hidden="true">·</span>
              <span>Keep your own site and your own customers</span>
            </p>
          </div>
          <div className="flex min-w-0 flex-[1_1_360px] flex-col items-center gap-3">
            <SiteWithBubble />
            <p className="text-center text-xs font-semibold text-dum-red-ink-soft">
              Real site: topgunmaintenance.com, DUM Club founding merchant. The card is live on it today.
            </p>
          </div>
        </div>
      </section>

      {/* ── Works on ───────────────────────────────────────────── */}
      <section className="border-b border-dum-red-border bg-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-x-7 gap-y-2.5 px-4 py-[18px] text-sm font-bold">
          <span className="font-extrabold text-dum-red">Works on</span>
          <span>Wix</span>
          <span>Squarespace</span>
          <span>GoDaddy</span>
          <span>WordPress</span>
          <span>Shopify</span>
          <span>Any site that lets you add code</span>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────── */}
      <section id="how" className="mx-auto flex max-w-[1180px] flex-col gap-9 px-4 pb-10 pt-20">
        <div className="flex max-w-[640px] flex-col gap-2.5">
          <p className="text-xs font-extrabold tracking-[0.18em] text-dum-red">HOW IT WORKS</p>
          <h2 className="text-[clamp(30px,4vw,38px)] font-black leading-[1.1] tracking-[-0.01em] text-[#0b1220]">
            Three steps. About five minutes.
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-3.5 rounded-[20px] border border-dum-red-border bg-white p-7">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dum-red text-base font-extrabold text-white">
              1
            </div>
            <div className="text-xl font-extrabold text-[#0b1220]">Paste one line on your site</div>
            <p className="text-[15px] leading-relaxed text-[#3b4556]">
              We give you one line of code. Drop it in your site&apos;s custom code box. If
              you&apos;d rather not touch it, we add it for you on a quick call.
            </p>
            <pre className="overflow-x-auto whitespace-nowrap rounded-[10px] bg-[#0b1220] px-3.5 py-3 font-mono text-[11px] leading-relaxed text-dum-red-ink-soft">
              {SNIPPET}
            </pre>
          </div>
          <div className="flex flex-col gap-3.5 rounded-[20px] border border-dum-red-border bg-white p-7">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dum-red text-base font-extrabold text-white">
              2
            </div>
            <div className="text-xl font-extrabold text-[#0b1220]">Go live from your phone</div>
            <p className="text-[15px] leading-relaxed text-[#3b4556]">
              Snap a photo of today&apos;s special, set the price, tap Go Live. Your show
              appears in the corner of your website in seconds.
            </p>
            <div className="flex items-center gap-2.5 rounded-xl bg-dum-red-bg px-3.5 py-3">
              <img
                src="/images/home/pie.jpg"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="text-[13px] font-bold">Grandma pie</div>
                <div className="text-xs text-[#5b6478]">$23 · 6 left</div>
              </div>
              <span className="rounded-full bg-state-live px-3.5 py-2 text-[11px] font-extrabold tracking-[0.1em] text-white">
                GO LIVE
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-3.5 rounded-[20px] border border-dum-red-border bg-white p-7">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-dum-red text-base font-extrabold text-white">
              3
            </div>
            <div className="text-xl font-extrabold text-[#0b1220]">They buy on your site</div>
            <p className="text-[15px] leading-relaxed text-[#3b4556]">
              Customers watch, ask questions in chat, and tap Buy. The money goes straight to
              your bank through Stripe. We never hold it.
            </p>
            <div className="flex items-center gap-2.5 rounded-xl bg-dum-red-bg px-3.5 py-3">
              <img
                src="/images/home/pie.jpg"
                alt=""
                width={40}
                height={40}
                className="h-10 w-10 shrink-0 rounded-lg object-cover"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="text-[13px] font-bold">Grandma pie</div>
                <div className="text-xs font-bold text-dum-red-700">$23</div>
              </div>
              <span className="rounded-full bg-dum-red px-4 py-2 text-xs font-extrabold text-white">
                Buy
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Interactive demo (unchanged walkthrough) ───────────── */}
      <section
        id="demo"
        className="mx-auto max-w-[1180px] scroll-mt-24 px-4 pb-10 pt-6 lg:scroll-mt-28"
      >
        <div className="rounded-3xl bg-surface-inverse px-6 py-14 pb-10 sm:px-10 sm:py-16 sm:pb-12">
          <GoLiveDemoPhone />
          <p className="mt-8 text-center text-sm text-white/75">
            Have a website already?{" "}
            <Link
              href="/demo"
              className="font-semibold text-white underline underline-offset-4 hover:opacity-90"
            >
              See the live bubble on your own site →
            </Link>
          </p>
        </div>
      </section>

      {/* ── Always open ────────────────────────────────────────── */}
      <section className="mx-auto flex max-w-[1180px] flex-col gap-9 px-4 pb-20 pt-10">
        <div className="flex max-w-[640px] flex-col gap-2.5">
          <p className="text-xs font-extrabold tracking-[0.18em] text-dum-red">ALWAYS OPEN</p>
          <h2 className="text-[clamp(30px,4vw,38px)] font-black leading-[1.1] tracking-[-0.01em] text-[#0b1220]">
            Your live counter never closes.
          </h2>
          <p className="text-[17px] leading-relaxed text-[#3b4556]">
            When you are live, it says LIVE. When you are closed, your last show loops.
            Customers can still see the special and buy it for pickup.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-3 rounded-[20px] bg-dum-red p-6 text-white">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-white px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-dum-red">
              <span className="h-1.5 w-1.5 rounded-full bg-dum-red" aria-hidden="true" />
              LIVE
            </span>
            <div className="text-[19px] font-extrabold">While you are live</div>
            <p className="text-sm leading-relaxed text-dum-red-ink-soft">
              Red LIVE tag, viewer count, live chat, and a buy button with a countdown. Real
              live only, we never fake it.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-[20px] border border-dum-red-border bg-white p-6">
            <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-[#1a1a1a] px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-white">
              <svg aria-hidden="true" width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              REPLAY
            </span>
            <div className="text-[19px] font-extrabold text-[#0b1220]">When you are closed</div>
            <p className="text-sm leading-relaxed text-[#3b4556]">
              Your last show plays on a loop in the corner. Deals keep running all day, all
              week, even when you are not there.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-[20px] border border-dum-red-border bg-white p-6">
            <span className="inline-flex self-start rounded-full bg-white px-2.5 py-1 text-[10px] font-extrabold tracking-[0.14em] text-[#1a1a1a] shadow-[0_0_0_1px_rgba(26,26,26,0.5)]">
              NEXT SHOW FRI 7:00 PM
            </span>
            <div className="text-[19px] font-extrabold text-[#0b1220]">Before your next show</div>
            <p className="text-sm leading-relaxed text-[#3b4556]">
              Set a weekly time. The corner shows when you go live next, and your customers
              get a reminder.
            </p>
          </div>
        </div>
      </section>

      {/* ── Real merchant ──────────────────────────────────────── */}
      <section className="border-y border-dum-red-border bg-dum-red-bg">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-10 px-4 py-[72px]">
          <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-3.5">
            <p className="text-xs font-extrabold tracking-[0.18em] text-dum-red">A REAL SHOP, LIVE ON ITS OWN SITE</p>
            <h2 className="text-[clamp(28px,4vw,34px)] font-black leading-[1.1] tracking-[-0.01em] text-[#0b1220]">
              Built by a mechanic who needed it first.
            </h2>
            <p className="max-w-[560px] text-[17px] leading-relaxed text-[#3b4556]">
              Topgun Maintenance is a one man mobile aircraft shop in New Jersey. Its
              website is topgunmaintenance.com. The DUM card sits in the corner of that
              site right now. When Julian goes live from his phone, pilots watching his
              site see the show and can book an inspection on the spot.
            </p>
            <p className="max-w-[560px] text-[17px] leading-relaxed text-[#3b4556]">
              Your shop works the same way. You log in here. The show plays on your site.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="https://www.topgunmaintenance.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full bg-dum-red px-[22px] py-3.5 text-[15px] font-extrabold text-white transition hover:brightness-95"
              >
                See it on topgunmaintenance.com
              </a>
              <Link
                href="/merchant"
                className="inline-flex items-center justify-center rounded-full border border-[#c9d1dc] bg-white px-[22px] py-3.5 text-[15px] font-bold text-[#1a1a1a] transition hover:border-dum-red"
              >
                Put it on my site
              </Link>
            </div>
          </div>
          <div className="flex min-w-0 flex-[1_1_320px] justify-center">
            <div className="relative h-[220px] w-[340px] overflow-hidden rounded-[20px] bg-[#16213a] shadow-[0_20px_50px_rgba(11,18,32,0.25)]">
              <img
                src="/images/home/topgun-jacking.jpg"
                alt="Topgun Maintenance working on an aircraft at night"
                width={340}
                height={220}
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-b from-transparent to-[rgba(11,18,32,0.85)] px-4 pb-3 pt-10 text-white">
                <div className="text-sm font-extrabold">Topgun Maintenance LLC</div>
                <div className="text-xs text-white/85">Founding merchant · Morristown, NJ</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing strip ──────────────────────────────────────── */}
      <section
        id="pricing"
        className="mx-auto flex max-w-[1180px] flex-col items-center gap-7 px-4 py-20 text-center"
      >
        <p className="text-xs font-extrabold tracking-[0.18em] text-dum-red">PRICING</p>
        <h2 className="text-[clamp(30px,4vw,38px)] font-black leading-[1.1] tracking-[-0.01em] text-[#0b1220]">
          One flat price. Keep more of every sale.
        </h2>
        <div className="flex w-full flex-wrap justify-center gap-4">
          {[
            { big: "30 days", small: "free to try", hot: false },
            { big: "$39", small: "a month after that", hot: true },
            { big: "1.5%", small: "per sale, paid to you by Stripe", hot: false },
          ].map((t) => (
            <div
              key={t.big}
              className={`flex max-w-[260px] flex-[1_1_200px] flex-col gap-1.5 rounded-[18px] p-6 ${
                t.hot ? "border-2 border-dum-red" : "border border-dum-red-border"
              }`}
            >
              <div className="text-[34px] font-black text-[#0b1220]">{t.big}</div>
              <div className="text-sm font-semibold text-[#5b6478]">{t.small}</div>
            </div>
          ))}
        </div>
        <p className="max-w-[640px] text-[15px] leading-relaxed text-[#3b4556]">
          Marketplaces take up to 8% per sale. Delivery apps take 15 to 30%. Cancel any time.
          DUM Points loyalty, the AI sales helper and your Discover listing are all included.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <PrimaryButton href="/merchant">Start your 30 day free trial</PrimaryButton>
          <Link
            href="/pricing"
            className="text-sm font-semibold text-[#1a1a1a] underline underline-offset-4 hover:text-dum-red"
          >
            See all plans
          </Link>
        </div>
      </section>

      {/* ── Discover band ──────────────────────────────────────── */}
      <section className="bg-dum-red text-white">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-6 px-4 py-[72px]">
          <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
            <p className="text-xs font-extrabold tracking-[0.18em] text-white">YOUR TOWN WATCHING</p>
            <h2 className="text-[clamp(26px,3.5vw,30px)] font-black leading-[1.15]">
              Your shop. Your show. Your town watching.
            </h2>
            <p className="max-w-[560px] text-base leading-relaxed text-dum-red-ink-soft">
              Every live shop is also listed on Discover, where people nearby browse who is on
              air right now. Free traffic, on top of your own site.
            </p>
          </div>
          <Link
            href="/discover"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-white px-6 py-3.5 text-[15px] font-extrabold text-dum-red transition hover:brightness-95"
          >
            See who is live near you
          </Link>
        </div>
      </section>
    </main>
  );
}
