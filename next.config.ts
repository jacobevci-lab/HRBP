import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // Keep Prisma packages external to Next's server bundling so OpenNext can
  // resolve and patch their workerd-specific exports for Cloudflare Workers.
  // This avoids Node filesystem-based WASM loading from .prisma/client.
  serverExternalPackages: ["@prisma/client", ".prisma/client"]
};

// Makes Cloudflare bindings available when running `next dev` locally.
initOpenNextCloudflareForDev();

export default nextConfig;
