import net from "node:net";

function numberEnv(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw ? Number(raw) : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function clamdConfig() {
  return {
    host: process.env.HRBP_CLAMD_HOST || "document-scanner-engine",
    port: numberEnv("HRBP_CLAMD_PORT", 3310, 1, 65535),
    timeoutMs: numberEnv("HRBP_CLAMD_TIMEOUT_MS", 30000, 3000, 120000),
    maxReplyBytes: numberEnv("HRBP_CLAMD_MAX_REPLY_BYTES", 8192, 1024, 65536)
  };
}

function connectSocket(config) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    const done = (error) => {
      socket.removeListener("connect", onConnect);
      socket.removeListener("error", onError);
      if (error) {
        socket.destroy();
        reject(error);
      }
    };
    const onConnect = () => {
      socket.setTimeout(config.timeoutMs);
      resolve(socket);
    };
    const onError = (error) => done(error);
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

async function collectReply(socket, config) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners("data");
      socket.removeAllListeners("error");
      socket.removeAllListeners("timeout");
      socket.removeAllListeners("end");
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.on("data", (chunk) => {
      length += chunk.length;
      if (length > config.maxReplyBytes) return finish(new Error("CLAMD_REPLY_TOO_LARGE"));
      chunks.push(chunk);
      if (chunk.includes(0)) {
        const reply = Buffer.concat(chunks).subarray(0, length);
        const nul = reply.indexOf(0);
        return finish(null, reply.subarray(0, nul >= 0 ? nul : undefined).toString("utf8").trim());
      }
    });
    socket.once("end", () => {
      const reply = Buffer.concat(chunks).toString("utf8").replace(/\0/g, "").trim();
      finish(null, reply);
    });
    socket.once("timeout", () => finish(new Error("CLAMD_TIMEOUT")));
    socket.once("error", () => finish(new Error("CLAMD_CONNECTION_FAILED")));
  });
}

export async function clamdCommand(command) {
  if (!/^[A-Z]+$/.test(command)) throw new Error("CLAMD_COMMAND_INVALID");
  const config = clamdConfig();
  const socket = await connectSocket(config);
  socket.write(Buffer.from("z" + command + "\0", "utf8"));
  return collectReply(socket, config);
}

export async function clamdPing() {
  const reply = await clamdCommand("PING");
  if (reply !== "PONG") throw new Error("CLAMD_PING_FAILED");
  return true;
}

export async function clamdVersion() {
  const reply = await clamdCommand("VERSION");
  if (!reply || reply === "COMMAND UNAVAILABLE") return "ClamAV";
  return reply.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "ClamAV";
}

async function writeChunk(socket, chunk) {
  if (socket.write(chunk)) return;
  await new Promise((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("CLAMD_CONNECTION_FAILED"));
    };
    const cleanup = () => {
      socket.removeListener("drain", onDrain);
      socket.removeListener("error", onError);
    };
    socket.once("drain", onDrain);
    socket.once("error", onError);
  });
}

export async function clamdScanBuffer(bytes) {
  const config = clamdConfig();
  const maxBytes = numberEnv("HRBP_DOCUMENT_SCAN_MAX_BYTES", 30 * 1024 * 1024, 1024, 100 * 1024 * 1024);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new Error("CLAMD_INPUT_INVALID");
  }

  const socket = await connectSocket(config);
  try {
    await writeChunk(socket, Buffer.from("zINSTREAM\0", "utf8"));
    const chunkSize = 64 * 1024;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      const chunk = Buffer.from(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
      const length = Buffer.allocUnsafe(4);
      length.writeUInt32BE(chunk.length, 0);
      await writeChunk(socket, length);
      await writeChunk(socket, chunk);
    }
    await writeChunk(socket, Buffer.alloc(4));
    const reply = await collectReply(socket, config);
    if (reply === "stream: OK" || reply.endsWith(": OK")) return { kind: "clean", reply };

    const found = /^(?:stream|[^:]+):\s*(.+)\s+FOUND$/.exec(reply);
    if (found) {
      const signature = found[1].replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
      return { kind: "infected", signature: signature || "MALWARE_SIGNATURE", reply: "FOUND" };
    }

    if (/ERROR$/i.test(reply) || /INSTREAM size limit exceeded/i.test(reply)) {
      return { kind: "error", code: "CLAMD_SCAN_ERROR" };
    }
    return { kind: "error", code: "CLAMD_UNEXPECTED_REPLY" };
  } catch (error) {
    socket.destroy();
    if (error instanceof Error && /^CLAMD_/.test(error.message)) throw error;
    throw new Error("CLAMD_CONNECTION_FAILED");
  }
}
