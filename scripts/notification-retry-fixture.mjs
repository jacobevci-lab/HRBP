/** A temporary local binding lease, never a production runtime override.
 * runtimeString reads Cloudflare bindings before process.env; setting only the
 * child process tenant cannot override the default wrangler.vars tenant.
 * Refuse existing .dev.vars rather than editing a developer's configuration.
 */
import { open, lstat, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

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
    let current;
    try { current = await lstat(path); }
    catch (error) { if (error.code === 'ENOENT') { cleaned = true; return; } throw error; }
    if (!current.isFile() || current.dev !== identity.dev || current.ino !== identity.ino ||
        await readFile(path, 'utf8') !== content) throw new Error('RETRY_FIXTURE_BINDINGS_CHANGED');
    await unlink(path); cleaned = true;
  };
}
