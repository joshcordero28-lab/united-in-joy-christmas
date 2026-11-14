import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // CSP and most security headers are set per-request in proxy.ts (nonce-based).
};

export default nextConfig;
