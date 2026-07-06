/** @type {import('next').NextConfig} */

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
const siteHost = siteUrl ? new URL(siteUrl).host : null;

const serverActionOrigins = ["localhost:3000"];
if (siteHost && !serverActionOrigins.includes(siteHost)) {
  serverActionOrigins.push(siteHost);
}

const nextConfig = {
  env: {
    // Expose Vercel's system git commit SHA to the browser bundle.
    // VERCEL_GIT_COMMIT_SHA is auto-set by Vercel at build time but is not
    // NEXT_PUBLIC_ prefixed, so we relay it here.
    NEXT_PUBLIC_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
  experimental: {
    serverActions: { allowedOrigins: serverActionOrigins },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // Long-lived immutable cache for static brand assets. The logo files
  // are content-stable; serving them with a 1-year immutable header lets
  // the browser + CDN skip revalidation entirely. Safe because a changed
  // logo ships under a new filename, not a mutated one.
  async headers() {
    return [
      {
        source: "/dum-logo-:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
  // Permanent redirects for renamed routes. Old links and any external
  // marketing copy still pointing at /explore or /ai-chat resolve to
  // the canonical pages (/discover, /chat) without a 404.
  async redirects() {
    return [
      { source: "/explore", destination: "/discover", permanent: true },
      // /chat no longer exists (the standalone AI-chat page was retired);
      // both old paths land on the homepage instead of a 404.
      { source: "/ai-chat", destination: "/", permanent: true },
      { source: "/chat", destination: "/", permanent: true },
      // /leaderboard retired (founder decision 2026-07-02) — ranking two
      // shops was noise; revisit when there are shops to rank.
      { source: "/leaderboard", destination: "/discover", permanent: false },
      // Merchant short-URL alias. /m/<slug> is a public-facing
      // shorthand for the storefront page at /project/<slug>. The
      // canonical URL stays /project/<slug>, but any printed
      // material, business cards, QR codes, or external posts
      // typed as dum.club/m/<slug> resolve correctly. 308 permanent
      // so search engines consolidate signal on the canonical URL.
      { source: "/m/:slug", destination: "/project/:slug", permanent: true },
      // Investor-page aliases. /raise and /wefunder are convenience
      // URLs printed on social bios, business cards, and the WeFunder
      // profile itself. Canonical page is /investors.
      { source: "/raise", destination: "/investors", permanent: true },
      { source: "/wefunder", destination: "/investors", permanent: true },
      // NOTE (2026-07-06): /demo is a REAL PAGE — the "see the live
      // bubble on your own website" sales tool at app/demo/page.tsx.
      // A redirect /demo -> /#demo briefly shipped here and shadowed
      // it (config redirects outrank filesystem routes); do not re-add
      // one. The homepage walkthrough lives at /#demo; the two are
      // cross-linked, not merged.
      { source: "/watch-demo", destination: "/#demo", permanent: false },
      // Footer / external-link aliases so no link 404s. /contact lands
      // on the About page's #contact anchor; /for-business and
      // /become-a-merchant map to the canonical /business and /merchant.
      { source: "/contact", destination: "/about#contact", permanent: false },
      { source: "/for-business", destination: "/business", permanent: true },
      { source: "/become-a-merchant", destination: "/merchant", permanent: true },
      // /welcome was the standalone merchant marketing page. Removed
      // 2026-07-01: its pitch + interactive go-live demo now render on
      // the root homepage (ClubHome homeVariant), so old links land there.
      { source: "/welcome", destination: "/", permanent: true },
      // Signup aliases. /signup and /register previously 404'd, so any
      // ad, email, or referral link using those common paths dead-ended.
      // Merchant signup lives at /merchant. 308 permanent so the redirect
      // is cached and search signal consolidates on the canonical page.
      { source: "/signup", destination: "/merchant", permanent: true },
      { source: "/register", destination: "/merchant", permanent: true },
    ];
  },
};

module.exports = nextConfig;
