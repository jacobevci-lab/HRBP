# Provider deployment verification

This repository distinguishes a successful local/CI Worker build from an actual Cloudflare deployment.

## Why the extra Version ID check exists

Cloudflare creates a unique Worker Version ID for each uploaded version, while a deployment determines which version is serving traffic. The Worker Version Metadata binding exposes the active version ID from inside the running Worker. HRBP exposes only that UUID on the existing public runtime-health response; version tags, timestamps, account identifiers, bindings and secrets are not returned.

The ordinary runtime response stays backward compatible when provider metadata is unavailable. Local Node and local Worker smoke tests therefore do not fabricate a Cloudflare Version ID.

## Strict operator verification

After an authorized operator has evidence of a successful provider build/deployment:

1. Retain the exact 40-character source commit expected to be deployed.
2. Retain the full Cloudflare Worker Version ID reported for the successful deployment.
3. Manually run **Release Verification**, supplying both values.
4. The live job performs exactly one anonymous, no-cache GET to the runtime-health endpoint.
5. Success requires the fresh response to contain both the expected source revision and the exact provider Version ID.

A missing, malformed or different provider Version ID fails closed. The operator-supplied expected ID is not inferred from candidate files or CI output.

## Assurance boundary

This check proves only that the responding Worker reports the expected source revision and that Cloudflare's runtime Version Metadata binding reports the expected active Version ID. It does not prove the contents of provider build logs, deployment permissions, quota state, database migration compatibility, customer acceptance, or business-workflow correctness.

Issue #220 still requires sanitized provider failure/success evidence and any approved operational database/migration checks before closure.
