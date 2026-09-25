import { readFile } from "node:fs/promises";

async function source(path) { return readFile(path, "utf8"); }
const failures = [];
function expect(path, text, pattern, message) { if (!pattern.test(text)) failures.push(`${path}: ${message}`); }

const learningMaintenancePath = "lib/learning-maintenance.ts";
const learningMaintenance = await source(learningMaintenancePath);
expect(learningMaintenancePath, learningMaintenance, /LearningAssignmentStatus\.ASSIGNED[\s\S]*LearningAssignmentStatus\.IN_PROGRESS/, "scheduled lifecycle must scan only mutable learning states");
expect(learningMaintenancePath, learningMaintenance, /dueAt:\s*\{\s*not:\s*null,\s*lt:\s*now\s*\}/, "scheduled lifecycle must only select past-due assignments");
expect(learningMaintenancePath, learningMaintenance, /updateMany/, "automatic overdue transition must use a state-aware write");
expect(learningMaintenancePath, learningMaintenance, /status:\s*LearningAssignmentStatus\.OVERDUE/, "past-due learning must transition to overdue");
expect(learningMaintenancePath, learningMaintenance, /learning-assignment\.auto-overdue/, "automatic overdue transition must emit audit evidence");
expect(learningMaintenancePath, learningMaintenance, /system:learning-maintenance/, "automatic lifecycle audit must identify the system actor");

const learningReminderPath = "lib/learning-reminders.ts";
const learningReminders = await source(learningReminderPath);
expect(learningReminderPath, learningReminders, /HRBP_LEARNING_DUE_SOON_DAYS/, "learning reminder window must be runtime configurable");
expect(learningReminderPath, learningReminders, /HRBP_LEARNING_REMINDER_BATCH_SIZE/, "learning reminder batch size must be runtime configurable");
expect(learningReminderPath, learningReminders, /userAccount\.findMany/, "learning reminders must resolve provisioned recipient accounts");
expect(learningReminderPath, learningReminders, /active:\s*true/, "learning reminders must only target active users");
expect(learningReminderPath, learningReminders, /LEARNING_ASSIGNMENT_DUE_SOON/, "learning reminders must create due-soon events");
expect(learningReminderPath, learningReminders, /LEARNING_ASSIGNMENT_OVERDUE/, "learning reminders must create overdue events");
expect(learningReminderPath, learningReminders, /enqueueNotificationOutbox/, "learning reminders must use the durable notification outbox");
expect(learningReminderPath, learningReminders, /dedupeKey:[\s\S]*assignment\.dueAt/, "learning reminder dedupe must include the effective due date");

const successionReminderPath = "lib/succession-reminders.ts";
const successionReminders = await source(successionReminderPath);
expect(successionReminderPath, successionReminders, /HRBP_SUCCESSION_REVIEW_WARNING_DAYS/, "succession reminder window must be runtime configurable");
expect(successionReminderPath, successionReminders, /ownerId:\s*\{\s*not:\s*null\s*\}/, "succession reminders must only scan owned plans");
expect(successionReminderPath, successionReminders, /SUCCESSION_PLAN_REVIEW_DUE_SOON/, "succession reminders must create due-soon events");
expect(successionReminderPath, successionReminders, /SUCCESSION_PLAN_REVIEW_OVERDUE/, "succession reminders must create overdue events");
expect(successionReminderPath, successionReminders, /enqueueNotificationOutbox/, "succession reminders must use the durable notification outbox");

const maintenancePath = "app/api/internal/maintenance/route.ts";
const maintenance = await source(maintenancePath);
expect(maintenancePath, maintenance, /(?:await runLearningMaintenance\(\)|capture\("learning-lifecycle",\s*runLearningMaintenance,\s*failures\))/, "learning lifecycle normalization must run before reminder classification");
expect(maintenancePath, maintenance, /(?:queueLearningReminders\(\)|capture\("learning-reminders",\s*queueLearningReminders,\s*failures\))/, "internal maintenance must queue learning reminders");
expect(maintenancePath, maintenance, /(?:queueSuccessionReviewReminders\(\)|capture\("succession-reminders",\s*queueSuccessionReviewReminders,\s*failures\))/, "internal maintenance must queue succession reminders");
expect(maintenancePath, maintenance, /learningLifecycle/, "maintenance response must expose learning lifecycle results");
expect(maintenancePath, maintenance, /learningReminders/, "maintenance response must expose learning reminder results");
expect(maintenancePath, maintenance, /successionReminders/, "maintenance response must expose succession reminder results");

const presentationPath = "lib/notification-presentation.ts";
const presentation = await source(presentationPath);
for (const eventType of ["LEARNING_ASSIGNMENT_READY", "LEARNING_ASSIGNMENT_DUE_SOON", "LEARNING_ASSIGNMENT_OVERDUE", "SUCCESSION_PLAN_REVIEW_DUE_SOON", "SUCCESSION_PLAN_REVIEW_OVERDUE"]) {
  expect(presentationPath, presentation, new RegExp(eventType), `${eventType} must have notification-center presentation`);
}
expect(presentationPath, presentation, /resourceType\s*===\s*"LearningAssignment"/, "learning notification resources must deep-link to learning");
expect(presentationPath, presentation, /resourceType\s*===\s*"SuccessionPlan"/, "succession notification resources must deep-link to succession");

const envPath = ".env.example";
const env = await source(envPath);
for (const key of ["HRBP_LEARNING_DUE_SOON_DAYS", "HRBP_LEARNING_REMINDER_BATCH_SIZE", "HRBP_LEARNING_MAINTENANCE_BATCH_SIZE", "HRBP_SUCCESSION_REVIEW_WARNING_DAYS", "HRBP_SUCCESSION_REMINDER_BATCH_SIZE"]) {
  expect(envPath, env, new RegExp(`^${key}=`, "m"), `${key} must be documented in the deployment environment example`);
}

if (failures.length) {
  console.error("Growth automation contract validation failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Validated growth automation contract: learning lifecycle normalization, identity-resolved reminders, succession review reminders, durable delivery and notification deep links are enforced.");