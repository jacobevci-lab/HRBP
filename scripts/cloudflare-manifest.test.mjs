import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { inlineLoadManifest } from '../node_modules/@opennextjs/cloudflare/dist/cli/build/patches/plugins/load-manifest.js';

test('installed adapter inlines actual Next 16.4 preview keys and still rejects unknown manifests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hrbp-manifest-'));
  try {
    const server = join(root, 'server-functions/default/.next/server');
    await mkdir(server, { recursive: true });
    const preview = { previewModeId: 'fixture-id', previewModeSigningKey: 'fixture-signing', previewModeEncryptionKey: 'fixture-encryption' };
    await writeFile(join(server, 'preview-props.json'), JSON.stringify(preview));
    let patch;
    inlineLoadManifest({ updateContent(_name, rules) { patch = rules[0].callback; } }, {
      outputDir: root, monorepoRoot: root, appBuildOutputPath: root
    });
    const source = await patch({ contents: 'function loadManifest(path, options) { throw new Error("unpatched"); }\nfunction evalManifest(path, options) { throw new Error("unpatched"); }' });
    const loadManifest = runInNewContext(source + '\nloadManifest;', { process: { env: {} } });
    assert.equal(JSON.stringify(loadManifest('/.next/server/preview-props.json')), JSON.stringify(preview));
    assert.throws(() => loadManifest('/.next/server/unknown-required.json'), /Unexpected loadManifest/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
