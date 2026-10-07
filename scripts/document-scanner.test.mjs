import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { clamdPing, clamdScanBuffer, clamdVersion } from "./clamd-client.mjs";

async function withFakeClamd(run) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let mode = "command";
    let payload = Buffer.alloc(0);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (mode === "command") {
        const nul = buffer.indexOf(0);
        if (nul < 0) return;
        const command = buffer.subarray(0, nul).toString("utf8");
        buffer = buffer.subarray(nul + 1);

        if (command === "zPING") {
          socket.end(Buffer.from("PONG\0"));
          return;
        }
        if (command === "zVERSION") {
          socket.end(Buffer.from("ClamAV 1.5.4/99999/Test\0"));
          return;
        }
        if (command !== "zINSTREAM") {
          socket.end(Buffer.from("UNKNOWN COMMAND\0"));
          return;
        }
        mode = "stream";
      }

      if (mode === "stream") {
        while (buffer.length >= 4) {
          const length = buffer.readUInt32BE(0);
          if (length === 0) {
            buffer = buffer.subarray(4);
            const infected = payload.toString("utf8").includes("EICAR");
            socket.end(Buffer.from(infected
              ? "stream: Eicar-Test-Signature FOUND\0"
              : "stream: OK\0"));
            return;
          }
          if (buffer.length < 4 + length) return;
          payload = Buffer.concat([payload, buffer.subarray(4, 4 + length)]);
          buffer = buffer.subarray(4 + length);
        }
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.HRBP_CLAMD_HOST = "127.0.0.1";
  process.env.HRBP_CLAMD_PORT = String(address.port);
  process.env.HRBP_CLAMD_TIMEOUT_MS = "5000";
  process.env.HRBP_CLAMD_MAX_REPLY_BYTES = "8192";
  process.env.HRBP_DOCUMENT_SCAN_MAX_BYTES = String(1024 * 1024);

  try {
    await run();
  } finally {
    delete process.env.HRBP_CLAMD_HOST;
    delete process.env.HRBP_CLAMD_PORT;
    delete process.env.HRBP_CLAMD_TIMEOUT_MS;
    delete process.env.HRBP_CLAMD_MAX_REPLY_BYTES;
    delete process.env.HRBP_DOCUMENT_SCAN_MAX_BYTES;
    server.close();
    await once(server, "close");
  }
}

test("clamd client pings and reads bounded version", async () => {
  await withFakeClamd(async () => {
    assert.equal(await clamdPing(), true);
    assert.match(await clamdVersion(), /^ClamAV 1\.5\.4/);
  });
});

test("clamd INSTREAM distinguishes clean and malware verdicts", async () => {
  await withFakeClamd(async () => {
    const clean = await clamdScanBuffer(Buffer.from("ordinary document"));
    assert.equal(clean.kind, "clean");

    const infected = await clamdScanBuffer(Buffer.from("EICAR synthetic test payload"));
    assert.equal(infected.kind, "infected");
    assert.equal(infected.signature, "Eicar-Test-Signature");
  });
});

test("clamd client rejects empty and oversized buffers before transport", async () => {
  await withFakeClamd(async () => {
    await assert.rejects(() => clamdScanBuffer(new Uint8Array()), /CLAMD_INPUT_INVALID/);
    process.env.HRBP_DOCUMENT_SCAN_MAX_BYTES = "1024";
    await assert.rejects(() => clamdScanBuffer(Buffer.alloc(2048)), /CLAMD_INPUT_INVALID/);
  });
});
