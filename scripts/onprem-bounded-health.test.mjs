import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POSTFLIGHT_MAX_RESPONSE_BYTES, readBoundedPostflightBody } from "./onprem-bounded-health.mjs";

function streamResponse(chunks, { headers = {} } = {}) {
  let cancelled = 0;
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulls < chunks.length) controller.enqueue(chunks[pulls++]);
      else controller.close();
    },
    cancel() { cancelled++; }
  });
  return { response: new Response(stream, { headers }), get cancelled() { return cancelled; }, get pulls() { return pulls; } };
}

test("small health JSON and exact-boundary metrics text remain readable", async () => {
  const small = Response.json({ ok: true, service: "hrbp" });
  assert.deepEqual(JSON.parse(await readBoundedPostflightBody(small)), { ok: true, service: "hrbp" });
  const atLimit = new Response("a".repeat(POSTFLIGHT_MAX_RESPONSE_BYTES));
  assert.equal((await readBoundedPostflightBody(atLimit)).length, POSTFLIGHT_MAX_RESPONSE_BYTES);
});

test("chunked no-content-length response is rejected before accumulating beyond 64 KiB", async () => {
  const chunks = [
    new Uint8Array(32 * 1024).fill(97),
    new Uint8Array(32 * 1024).fill(97),
    new Uint8Array(1).fill(97),
    new Uint8Array(8 * 1024).fill(97)
  ];
  const stream = streamResponse(chunks);
  await assert.rejects(readBoundedPostflightBody(stream.response), /maximum allowed bytes/);
  assert.ok(stream.cancelled >= 1);
  assert.ok(stream.pulls <= chunks.length);
});

test("declared oversized responses are rejected without consuming their data", async () => {
  const stream = streamResponse([new Uint8Array(1)], {
    headers: { "content-length": String(POSTFLIGHT_MAX_RESPONSE_BYTES + 1) }
  });
  await assert.rejects(readBoundedPostflightBody(stream.response), /maximum allowed bytes/);
  assert.ok(stream.cancelled >= 1);
});

test("invalid UTF-8 is blocked instead of silently replacing bytes", async () => {
  const stream = streamResponse([Uint8Array.from([0xc3, 0x28])]);
  await assert.rejects(readBoundedPostflightBody(stream.response), /encoded data|valid|utf-8/i);
  assert.ok(stream.cancelled >= 1);
});

test("truncated multibyte text and missing response bodies fail closed", async () => {
  const truncated = streamResponse([Uint8Array.from([0xe2, 0x82])]);
  await assert.rejects(readBoundedPostflightBody(truncated.response));
  await assert.rejects(readBoundedPostflightBody(new Response(null)), /no body/);
});

test("bounded reader cannot silently raise its maximum to hide oversized replies", async () => {
  for (const bound of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, POSTFLIGHT_MAX_RESPONSE_BYTES + 1]) {
    const stream = streamResponse([new Uint8Array(1)]);
    await assert.rejects(readBoundedPostflightBody(stream.response, bound), RangeError);
  }
});

test("onprem postflight streams both JSON and privileged metrics with bounded reads", () => {
  const script = readFileSync("scripts/onprem-postflight.mjs", "utf8");
  assert.match(script, /import \{ readBoundedPostflightBody \} from "\.\/onprem-bounded-health\.mjs"/);
  assert.equal((script.match(/await readBoundedPostflightBody\(response\)/g) || []).length, 2);
  assert.doesNotMatch(script, /await response\.text\(\)/);
  assert.match(script, /HRBP_METRICS_TOKEN/);
  assert.match(script, /approvedRevisionVerified/);
});
