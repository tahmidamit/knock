import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    esmExternals: false,
  },
  // Allow access from local network
  allowedDevOrigins: ["192.168.0.103"],
  async rewrites() {
    return []
  },
};

export default nextConfig;
