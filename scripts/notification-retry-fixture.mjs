/** A temporary local binding lease, never a production runtime override.
 * runtimeString reads Cloudflare bindings before process.env; setting only the
 * child process tenant cannot override the default wrangler.vars tenant.
 * Refuse existing .dev.vars rather than editing a developer's configuration.
 */
import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

async function restoreUnexpectedCandidate(candidatePath, path) {
  try {
    await link(candidatePath, path);
    await unlink(candidatePath);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function createRetryTestBindings(directory, tenantId, env = process.env) {
  const db = new URL(env.DATABASE_URL || 'invalid:');
  if (env.HRBP_DISPOSABLE_AUDIT !== 'true' || !['postgres:', 'postgresql:'].includes(db.protocol) ||
      !['localhost', '127.0.0.1'].includes(db.hostname) || db.pathname !== '/hrbp_audit' ||
      !/^qaretry[a-f0-9]{12}$/.test(tenantId)) throw new Error('RETRY_FIXTURE_NOT_DISPOSABLE');
  const path = join(directory, '.dev.vars');
  const content = `HRBP_AUTH_TENANT_ID="${tenantId}"\nHRBP_LOCAL_AUTH_ENABLED="true"\nHRBP_SMTP_ENABLED="false"\n`;
  const handle = await open(path, 'wx', 0o600);
  let identity;
  try { identity = await handle.stat(); await handle.writeFile(content); }
  catch (error) { await handle.close(); await unlink(path); throw error; }
  await handle.close();
  let cleaned = false;
  return async () => {
    if (cleaned) return;

    // Move the exact pathname entry first, then inspect the moved object through
    // its file descriptor. This removes the lstat/readFile TOCTOU window while
    // keeping an unexpected concurrent replacement recoverable.
    const candidatePath = join(directory, `.dev.vars.hrbp-cleanup-${process.pid}-${randomUUID()}`);
    try { await rename(path, candidatePath); }
    catch (error) { if (error.code === 'ENOENT') { cleaned = true; return; } throw error; }

    let candidate;
    try {
      candidate = await open(candidatePath, 'r');
      const current = await candidate.stat();
      if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
          await candidate.readFile('utf8') !== content) {
        await candidate.close(); candidate = undefined;
        await restoreUnexpectedCandidate(candidatePath, path);
        throw new Error('RETRY_FIXTURE_BINDINGS_CHANGED');
      }
      await candidate.close(); candidate = undefined;
      await unlink(candidatePath);
      cleaned = true;
    } catch (error) {
      if (candidate) await candidate.close().catch(() => {});
      if (error.message === 'RETRY_FIXTURE_BINDINGS_CHANGED') throw error;
      await restoreUnexpectedCandidate(candidatePath, path).catch(() => {});
      throw error;
    }
  };
}
