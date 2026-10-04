export function getBuildRevision(options?: {
  env?: Record<string, string | undefined>;
  runGit?: (args: string[]) => string;
}): string;
