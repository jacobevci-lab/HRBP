import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auditPage = readFileSync("components/audit-live-page.tsx", "utf8");
const historyRoute = readFileSync("app/api/action-center/history/route.ts", "utf8");
const historyComponent = readFileSync("components/action-center-decision-history.tsx", "utf8");

test("Audit Ledger preflights its 5000-row CSV evidence limit in the UI", () => {
  assert.match(auditPage, /const exportBlocked = data\.total > 5000/);
  assert.match(auditPage, /audit-export-disabled/);
  assert.match(auditPage, /5,000-row export limit/);
  assert.match(auditPage, /aria-disabled="true"/);
});

test("Action Center exposes total governed decisions and preflights the 500-row CSV limit", () => {
  assert.match(historyRoute, /db\.auditEvent\.count\(\{ where \}\)/);
  assert.match(historyRoute, /total,\s*items:/);
  assert.match(historyComponent, /const \[total, setTotal\] = useState\(0\)/);
  assert.match(historyComponent, /setTotal\(body\.data\?\.total \?\? 0\)/);
  assert.match(historyComponent, /const exportBlocked = total > 500/);
  assert.match(historyComponent, /workflow-history-export-disabled/);
  assert.match(historyComponent, /500-row CSV limit/);
  assert.match(historyComponent, /<strong>\{total\}<\/strong>/);
});
