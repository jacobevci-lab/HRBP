import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PROFILE_SKILL_REQUIREMENTS,
  normalizeArchitectureCode,
  normalizeJobProfileCreateStatus,
  normalizeJobProfileLifecycleAction,
  normalizeLevelRank,
  normalizeSkillRequirements
} from "../lib/job-architecture-input.mjs";

test("architecture codes are canonical, bounded and control-character free", () => {
  assert.equal(normalizeArchitectureCode(" eng.platform "), "ENG.PLATFORM");
  for (const value of ["", "a b", "A/B", "x".repeat(65), "A\nB", null, 7]) {
    assert.equal(normalizeArchitectureCode(value), null);
  }
});

test("level rank requires an explicit safe integer from 1 through 1000", () => {
  for (const value of [1, 10, 1000]) assert.equal(normalizeLevelRank(value), value);
  for (const value of [0, 1001, -1, 1.5, "4", NaN, Infinity]) assert.equal(normalizeLevelRank(value), null);
});

test("new profiles default to DRAFT and only DRAFT or ACTIVE can be created", () => {
  assert.equal(normalizeJobProfileCreateStatus(undefined), "DRAFT");
  assert.equal(normalizeJobProfileCreateStatus(" active "), "ACTIVE");
  assert.equal(normalizeJobProfileCreateStatus("DRAFT"), "DRAFT");
  for (const value of ["RETIRED", "unknown", 1, {}, []]) assert.equal(normalizeJobProfileCreateStatus(value), null);
});

test("skill requirements are bounded, unique and use reviewed proficiency values", () => {
  assert.deepEqual(normalizeSkillRequirements(undefined), []);
  assert.deepEqual(normalizeSkillRequirements([
    { skillId: "skill-1", targetProficiency: "advanced" },
    { skillId: "skill-2", targetProficiency: "FOUNDATION", required: false }
  ]), [
    { skillId: "skill-1", targetProficiency: "ADVANCED", required: true },
    { skillId: "skill-2", targetProficiency: "FOUNDATION", required: false }
  ]);
  for (const value of [
    {},
    [{ skillId: "", targetProficiency: "ADVANCED" }],
    [{ skillId: "skill-1", targetProficiency: "MASTER" }],
    [{ skillId: "skill-1", targetProficiency: "ADVANCED", required: "yes" }],
    [{ skillId: "skill-1", targetProficiency: "ADVANCED", extra: true }],
    [
      { skillId: "skill-1", targetProficiency: "ADVANCED" },
      { skillId: "skill-1", targetProficiency: "EXPERT" }
    ],
    Array.from({ length: MAX_PROFILE_SKILL_REQUIREMENTS + 1 }, (_, i) => ({
      skillId: "skill-" + i, targetProficiency: "AWARENESS"
    }))
  ]) assert.equal(normalizeSkillRequirements(value), null);
});

test("profile lifecycle accepts only explicit ACTIVATE or RETIRE actions", () => {
  assert.equal(normalizeJobProfileLifecycleAction(" activate "), "ACTIVATE");
  assert.equal(normalizeJobProfileLifecycleAction("RETIRE"), "RETIRE");
  for (const value of ["DELETE", "DRAFT", "", null, 1, {}]) assert.equal(normalizeJobProfileLifecycleAction(value), null);
});
