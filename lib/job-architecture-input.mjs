export const MAX_PROFILE_SKILL_REQUIREMENTS = 50;
const PROFICIENCIES = new Set(["AWARENESS", "FOUNDATION", "PRACTITIONER", "ADVANCED", "EXPERT"]);
const CREATE_STATUSES = new Set(["DRAFT", "ACTIVE"]);

export function normalizeArchitectureCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9._-]{1,64}$/.test(normalized) ? normalized : null;
}

export function normalizeLevelRank(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 1000 ? value : null;
}

export function normalizeJobProfileCreateStatus(value) {
  if (value === undefined || value === null || value === "") return "DRAFT";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return CREATE_STATUSES.has(normalized) ? normalized : null;
}

function normalizedIdentifier(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 191 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export function normalizeSkillRequirements(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PROFILE_SKILL_REQUIREMENTS) return null;
  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const keys = Object.keys(entry);
    if (keys.some((key) => !["skillId", "targetProficiency", "required"].includes(key))) return null;
    const skillId = normalizedIdentifier(entry.skillId);
    const proficiency = typeof entry.targetProficiency === "string"
      ? entry.targetProficiency.trim().toUpperCase()
      : "";
    const required = entry.required === undefined ? true : entry.required;
    if (!skillId || !PROFICIENCIES.has(proficiency) || typeof required !== "boolean" || seen.has(skillId)) return null;
    seen.add(skillId);
    normalized.push({ skillId, targetProficiency: proficiency, required });
  }
  return normalized;
}
