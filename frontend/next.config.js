/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
  images: {
    domains: ["your-project.supabase.co"],
  },
};

module.exports = nextConfig;
