import type { NextConfig } from "next";

// Server-side only — not exposed to browser
const BACKEND_ORIGIN = process.env.BACKEND_URL || "http://localhost:8000"

const nextConfig: NextConfig = {
  transpilePackages: ["@assistant-ui/react", "@assistant-ui/react-ai-sdk", "@assistant-ui/react-markdown"],
  async rewrites() {
    return [
      {
        // Proxy user-sync endpoint
        source: "/api/me",
        destination: `${BACKEND_ORIGIN}/api/me`,
      },
      {
        // Proxy all backend API calls — eliminates CORS entirely
        source: "/api/deals/:path*",
        destination: `${BACKEND_ORIGIN}/api/deals/:path*`,
      },
      {
        // Proxy classifications API
        source: "/api/classifications/:path*",
        destination: `${BACKEND_ORIGIN}/api/classifications/:path*`,
      },
      {
        source: "/api/classifications",
        destination: `${BACKEND_ORIGIN}/api/classifications`,
      },
      {
        source: "/api/webhooks/:path*",
        destination: `${BACKEND_ORIGIN}/api/webhooks/:path*`,
      },
      {
        source: "/api/health",
        destination: `${BACKEND_ORIGIN}/api/health`,
      },
    ]
  },
};

export default nextConfig;
