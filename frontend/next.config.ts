import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@assistant-ui/react", "@assistant-ui/react-ai-sdk", "@assistant-ui/react-markdown"],
};

export default nextConfig;
