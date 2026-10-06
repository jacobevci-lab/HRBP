import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { getBuildRevision } from "./scripts/build-revision.cjs";

const onPremBuild = process.env.HRBP_BUILD_TARGET === "onprem";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  ...(onPremBuild ? { output: "standalone" as const } : {}),
  env: { HRBP_BUILD_REVISION: getBuildRevision() },
  serverExternalPackages: ["@prisma/client", ".prisma/client"]
};

if (!onPremBuild) initOpenNextCloudflareForDev();

export default nextConfig;
