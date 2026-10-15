import type { NextConfig } from "next";

const apiBase = process.env.LABFORGE_API_URL ?? "http://127.0.0.1:8000";

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@labforge/schema"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiBase}/api/v1/:path*`,
      },
    ];
  },
};

export default config;
