const { execFileSync } = require('node:child_process');

function revision(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}

/** Build-time label only; never read arbitrary environment values into Next's env config. */
function getBuildRevision({ env = process.env, runGit } = {}) {
  const git = runGit || ((args) => execFileSync('git', args, {
    encoding: 'utf8', timeout: 2000, maxBuffer: 4096, stdio: ['ignore', 'pipe', 'ignore']
  }).trim());
  const declared = [env.WORKERS_CI_COMMIT_SHA, env.GITHUB_SHA].filter(value => value !== undefined && value !== '');
  if (declared.some(value => !revision(value))) throw new Error('Invalid CI source revision.');
  const declarations = [...new Set(declared.map(revision))];
  if (declarations.length > 1) throw new Error('Conflicting CI source revisions.');
  let checkout;
  try { checkout = revision(git(['rev-parse', '--verify', 'HEAD'])); } catch { /* Archive build: use CI declaration. */ }
  if (checkout) {
    if (declarations[0] && checkout !== declarations[0]) throw new Error('Checkout and CI source revisions disagree.');
    // A locally modified tracked source tree must not advertise its parent as the deployed release.
    try { if (git(['status', '--porcelain', '--untracked-files=no'])) return 'unknown'; }
    catch { return 'unknown'; }
    return checkout;
  }
  return declarations[0] || 'unknown';
}
module.exports = { getBuildRevision };
