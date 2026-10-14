/** Bounded, fail-closed text reader for local postflight and metrics probes. */
export const POSTFLIGHT_MAX_RESPONSE_BYTES = 64 * 1024;

export async function readBoundedPostflightBody(response, maxBytes = POSTFLIGHT_MAX_RESPONSE_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > POSTFLIGHT_MAX_RESPONSE_BYTES) {
    throw new RangeError("Invalid postflight response budget.");
  }
  if (!response?.body) throw new Error("Postflight response has no body.");

  const rawLength = response.headers?.get("content-length");
  if (rawLength !== null && rawLength !== undefined && /^\d+$/.test(rawLength)) {
    const declared = Number(rawLength);
    if (declared > maxBytes) {
      await response.body.cancel().catch(() => {});
      throw new Error("Postflight response exceeds the maximum allowed bytes.");
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("Postflight response exceeds the maximum allowed bytes.");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    // Even on invalid UTF-8, streams, oversize or transport failure, release
    // the reader without retaining or logging any upstream response body.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
