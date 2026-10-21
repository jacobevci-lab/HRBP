# Build compatibility checkpoint — 21 October 2026

## Corrected diagnosis

CI run 39562177618, job 119099942076, stopped at OpenNext's unsupported-Next-15.5.27 gate. The earlier PR/report claim of `malformed Headers object` / `normalizeRequest` is withdrawn: that stack is not present in this job's raw log. The log independently records an ESLint `context.getAncestors` exception from `@next/next/no-duplicate-head` on the history-export route. Neither diagnostic establishes the separate Cloudflare provider failure's root cause or the deployed revision.

## Scoped repair

The runtime is pinned to Next 16.4.2 with an npm-generated lock. React, Prisma, OpenNext and other direct runtime roots retain their previous versions. Webpack is selected explicitly to preserve the existing adapter build path. No support-check bypass is used.

Next 16 no longer runs lint during `next build`. `lint:app` is therefore mandatory in the normal prebuild chain and both production-browser workflows. All earlier governance checks remain. Dependency/configuration changes now trigger UI Deep Inspection as well.

The existing security-motivated lint override documented in `platform-audit-remediation.md` is retained: eslint-config-next 15 and the pinned older Next rules. This is a tested compatibility exception, not a claim that all lint tooling has been upgraded to version 16. Official `@eslint/compat` 2.1.1 wraps those rules for ESLint 9; no severity, rule option or source ignore is relaxed. Future removal of this exception requires fresh dependency audit and behavioral parity evidence.

## Independently executed candidate evidence

Lint probe 39567069579 reproduced six actual-config failures (2/8 passed before), then passed all eight after the wrapper. Ordinary API returns, the real affected route, one/two/three Head fixtures, every configured severity/option, Next/React/TypeScript findings and ignore boundaries are covered. Full app/components/lib lint: 570 files, zero errors, 16 retained warnings. npm audit reported zero vulnerabilities. Artifact 12329743808 SHA-256: `69191e6a27ddec97de532060e6a3b55301eb1ec5c738844d7dedca655d628c55`.

Supported-framework probe 39568291102, job 119115859166, completed successfully using disposable loopback PostgreSQL: exact runtime verification, migrations, TypeScript, explicit application lint, the real-config regression, the retained prebuild validations, Next compilation and OpenNext bundle generation. The log ends with `.open-next/worker.js` and `OpenNext build complete`. Artifact 12331335495 SHA-256: `a7555b40610a20b9791a0e835bd7721fc15880d5247190694fffc8b0b54c0429`.

The earlier framework probe used `/hrbp_probe`; an existing integration-test safety guard requires `/hrbp`. That attempt correctly failed. Only the isolated fixture database name was corrected; no safety guard or test was skipped. The first lint probe also had a separate test-loader issue, corrected before the before/after comparison. Neither failed attempt is counted as a successful application build.

Eight additional build-policy tests require exact runtime/lock alignment, explicit lint/Webpack, retained type/support gates, browser workflow wiring and dependency-change triggers. They supplement actual builds; they are not a substitute for them.

## Acceptance boundary

Candidate probe evidence is not acceptance of the final PR commit. Require all five workflows on the final head, including full CI, on-prem image/restore/smoke and repeated browser/API tests. Prior 321/321 UI and 48/48 Platform results belong to 61503956 and must not be attributed to a new commit. Preserve the 16 lint warnings as follow-up findings rather than disabling rules or changing business behavior merely to hide them.

No business endpoint, authorization, database schema, customer record or theme is changed in this repair. The temporary probe workflows and their write permissions are not included in the product PR. No main merge or manual deployment is performed. A successful local Worker build is not proof of a Cloudflare provider deployment.

## Primary technical references

- ESLint compatibility utilities: https://eslint.org/blog/2024/05/eslint-compatibility-utilities/
- Next 16 upgrade and explicit lint/Webpack behavior: https://nextjs.org/docs/app/guides/upgrading/version-16
- Next support policy: https://nextjs.org/support-policy
- OpenNext Cloudflare CLI: https://opennext.js.org/cloudflare/cli
