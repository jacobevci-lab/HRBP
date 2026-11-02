export const MAX_PROFILE_SKILL_REQUIREMENTS: 50;
export type NormalizedJobProfileCreateStatus = "DRAFT" | "ACTIVE";
export type NormalizedSkillRequirement = {
  skillId: string;
  targetProficiency: "AWARENESS" | "FOUNDATION" | "PRACTITIONER" | "ADVANCED" | "EXPERT";
  required: boolean;
};
export function normalizeArchitectureCode(value: unknown): string | null;
export function normalizeLevelRank(value: unknown): number | null;
export function normalizeJobProfileCreateStatus(value: unknown): NormalizedJobProfileCreateStatus | null;
export function normalizeSkillRequirements(value: unknown): NormalizedSkillRequirement[] | null;
