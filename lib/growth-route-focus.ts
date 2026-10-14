export type GrowthFocusSlug = "benefits" | "performance" | "talent" | "succession" | "learning";
export type GrowthSearch = Record<string, string | string[] | undefined>;
export type GrowthSearchParams = Promise<GrowthSearch>;

const focusKeys: Record<GrowthFocusSlug, readonly string[]> = {
  benefits: ["enrollment"],
  performance: ["review"],
  talent: ["developmentPlan"],
  succession: ["plan", "candidate"],
  learning: ["assignment"]
};

/**
 * Accept only one bounded, scalar record identifier from a notification URL.
 * Never coerce array values, silently truncate an id or interpret unknown query keys.
 * The target loader must independently enforce actor, tenant and relationship scope.
 */
export function pickGrowthFocus(slug: GrowthFocusSlug, search: GrowthSearch): string | undefined {
  for (const key of focusKeys[slug]) {
    const value = search[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !value || value.length > 128 ||
        value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
    return value;
  }
  return undefined;
}
