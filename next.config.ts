import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // Prisma's engine-less client loads its query compiler WASM at runtime.
  // Next.js output tracing cannot infer that dynamic filesystem read, so force
  // the generated WASM module into every server route's standalone trace. The
  // OpenNext Cloudflare build consumes this traced output for the Worker bundle.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/.prisma/client/*.wasm"]
  }
};

export default nextConfig;
