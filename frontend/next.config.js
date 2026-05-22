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
  // Permanent redirects for renamed routes. Old links and any external
  // marketing copy still pointing at /explore or /ai-chat resolve to
  // the canonical pages (/discover, /chat) without a 404.
  async redirects() {
    return [
      { source: "/explore", destination: "/discover", permanent: true },
      { source: "/ai-chat", destination: "/chat", permanent: true },
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
      // Footer / external-link aliases so no link 404s. /contact lands
      // on the About page's #contact anchor; /for-business and
      // /become-a-merchant map to the canonical /business and /merchant.
      { source: "/contact", destination: "/about#contact", permanent: false },
      { source: "/for-business", destination: "/business", permanent: true },
      { source: "/become-a-merchant", destination: "/merchant", permanent: true },
    ];
  },
};

module.exports = nextConfig;
