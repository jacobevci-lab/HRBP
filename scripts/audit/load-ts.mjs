import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
const require = createRequire(import.meta.url);
/** Test-only CJS transpilation: does not modify application builds. */
export function loadTs(path, mocks = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name.startsWith('@/')) return loadTs(resolve(name.slice(2) + '.ts'), mocks);
    return require(name);
  });
  return module.exports;
}
export function requireDisposableDatabase() {
  const url = new URL(process.env.DATABASE_URL || 'invalid:');
  if (process.env.CI !== 'true' || !['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/hrbp') throw new Error('Product audit requires the disposable loopback CI hrbp database.');
}
