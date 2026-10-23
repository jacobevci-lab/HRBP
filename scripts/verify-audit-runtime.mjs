/** Read-only evidence that the audited application's direct runtime packages
 * still match the committed lock after installing isolated browser tooling.
 * This is not a complete installed/transitive SBOM or a deployment attestation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sorted = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')));
const requireThat = (condition, message) => { if (!condition) throw Error(message); };
export function verifyAuditRuntime(root = process.cwd()) {
  const read = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
  const pkg = read('package.json'), lock = read('package-lock.json');
  requireThat([2, 3].includes(lock.lockfileVersion) && object(lock.packages?.['']), 'A v2/v3 package lock is required.');
  requireThat(object(pkg.dependencies) && object(lock.packages[''].dependencies), 'Runtime declarations are missing.');
  requireThat(sorted(pkg.dependencies) === sorted(lock.packages[''].dependencies), 'Runtime declarations differ from the lock.');
  const packages = [];
  for (const name of Object.keys(pkg.dependencies).sort()) {
    requireThat(/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) && name !== '.' && name !== '..', 'Invalid runtime package name.');
    const location = `node_modules/${name}`, locked = lock.packages[location];
    requireThat(object(locked) && !locked.link && typeof locked.version === 'string', `Unsupported or missing locked runtime: ${name}`);
    const installed = read(`${location}/package.json`);
    requireThat(installed.name === name && installed.version === locked.version,
      `Installed runtime differs from the lock: ${name} (expected ${locked.version}, observed ${installed.version})`);
    packages.push({ name, version: installed.version, location });
  }
  requireThat(packages.length > 0, 'No runtime packages were verified.');
  return { scope: 'direct-installed-runtime-vs-committed-lock', packages,
    packageLockSha256: createHash('sha256').update(readFileSync(path.join(root, 'package-lock.json'))).digest('hex') };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(verifyAuditRuntime(), null, 2)); }
  catch (error) { console.error('Audit runtime verification failed:', error.message); process.exitCode = 1; }
}
