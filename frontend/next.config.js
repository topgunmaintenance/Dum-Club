/** @type {import('next').NextConfig} */

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
const siteHost = siteUrl ? new URL(siteUrl).host : null;

const serverActionOrigins = ["localhost:3000"];
if (siteHost && !serverActionOrigins.includes(siteHost)) {
  serverActionOrigins.push(siteHost);
}

const nextConfig = {
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
};

module.exports = nextConfig;
