import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { getBuildRevision } from "./scripts/build-revision.cjs";
import { browserSecurityHeaders } from "./lib/browser-security-headers.mjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // Only this non-secret label is inlined at build time, never the process environment.
  env: { HRBP_BUILD_REVISION: getBuildRevision() },
  async headers() {
    return [{
      source: "/:path*",
      headers: browserSecurityHeaders()
    }];
  },
  // Keep Prisma packages external to Next's server bundling so OpenNext can
  // resolve and patch their workerd-specific exports for Cloudflare Workers.
  // This avoids Node filesystem-based WASM loading from .prisma/client.
  serverExternalPackages: ["@prisma/client", ".prisma/client"]
};

// Makes Cloudflare bindings available when running `next dev` locally.
initOpenNextCloudflareForDev();

export default nextConfig;
