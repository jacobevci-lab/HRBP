import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // OpenNext transforms Next.js standalone output for Cloudflare Workers.
  // Prisma's engine-less client loads query compiler WASM and related runtime
  // files dynamically, which static tracing cannot reliably infer. Keep the
  // complete generated Prisma runtime in the standalone trace so OpenNext can
  // carry it into the Worker bundle.
  output: "standalone",
  outputFileTracingIncludes: {
    "*": ["node_modules/.prisma/client/**/*"]
  }
};

export default nextConfig;
