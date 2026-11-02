# Read-only S3 pilot evidence collector

## Boundary

`scripts/audit-pilot-s3-collector.mjs` is an explicitly opted-in operator-host tool. It invokes an approved, locally installed AWS CLI v2 binary for five S3 read operations. It is not an application endpoint, scheduled job, signing service, delete/overwrite probe or deployment command. It makes no remote writes and does not download the object body: a separately supplied local archive is compared with HEAD's full-object checksum.

Collection is not authorization. Success returns `S3_OBSERVATIONS_COLLECTED`, never GO. The existing offline verifier continues to report `liveProviderVerified: false`; collecting files does not turn them into AWS-signed attestations. A trusted collector host, binary installation, credential custody, independently approved target, network/TLS trust and subsequent reviewer checks remain essential. A compromised binary/host can fabricate outputs. No customer AWS account was used in the committed tests.

## Sequence and independently pinned request

Collect BEFORE reviewing G04, constructing the pilot packet, enrolling its policy digest and signing it. Reusing the completed v2 policy as a collection request would create a circular dependency because that policy already pins the G04-bearing packet.

Create a bounded (16 KiB) request with exactly `schemaVersion: 1`, `scope: "HRBP_S3_READ_COLLECTION:1"`, `region`, and `requirements`. Serialize as UTF-8 `JSON.stringify(request) + "\n"`. Duplicate keys, pretty printing, BOM and unknown top-level fields are refused. The `requirements` object is exactly the existing schema in `AUDIT-PILOT-S3-RETENTION.md`: profile, bucket, key, explicit non-null versionId, expectedBucketOwner, archiveSha256, archiveSizeBytes, minRetentionUntilUtc, maxObservationAgeSeconds and legalHoldRequired. Obtain the request SHA-256 through the independently approved operator register; calculating a digest of an attacker-supplied request is not enrollment.

The archive must be a regular, single-link, non-symlink file of at most 4 MiB. Its exact bytes must match the request's size and SHA-256 BEFORE any AWS subprocess starts. The requested deadline must still be in the future.

## Credentials, execution and supported endpoints

Provision an approved AWS CLI v2 executable and Node 22 on an operator-controlled POSIX host. Pass its absolute path. The path can resolve through the approved installation's symlink; all executable components and parent directories must remain trusted. The wrapper is not an executable sandbox or binary attestation mechanism.

Use a separately approved temporary session scoped to the exact bucket/object/version. Only `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` are inherited as credentials; all three are required. Do not place values in a command argument, ticket, CI configuration, repository or this document. Obtain the session via the institution's approved secret/session process, not by expanding this tool's privileges. The wrapper does not itself prove session expiry or acquire/refresh credentials.

Shared config and credentials files are set to `/dev/null`; profile selection, credential_process, container/instance metadata credentials, custom CA/endpoint settings, proxy variables and loader injection variables are not inherited. The child environment disables metadata credential discovery and sets `AWS_MAX_ATTEMPTS=1`. No application secrets are forwarded.

Each command uses an explicit HTTPS endpoint `https://s3.<approved-region>.amazonaws.com`, standard TLS verification, literal `--cli-input-json`, JSON output, no pager/auto-prompt, a five-second connection timeout and ten-second read timeout. No flag allows disabling TLS verification or unsigned requests. The process is bounded to 20 seconds with SIGKILL and 64 KiB output; version discovery is bounded to five seconds. SDK internal behavior (including regional redirects) is not a guarantee of exactly five HTTP exchanges.

Only standard commercial-region general-purpose buckets are supported. GovCloud, China, isolated partitions, custom/VPC/FIPS endpoints, access-point aliases/ARNs, MRAP, Outposts, directory buckets, Requester Pays and SSE-C are outside this profile. Unsupported configurations fail rather than silently weakening checks.

## Operator invocation

Run only after approving network access and the target. The explicit acknowledgement is mandatory but is NOT evidence of organizational authorization.

```sh
node scripts/audit-pilot-s3-collector.mjs \
  --request /controlled/collection-request.json \
  --expected-request-sha256 <independently-approved-64-hex-digest> \
  --archive /controlled/archive.bin \
  --aws-cli /usr/local/bin/aws \
  --out-dir /controlled/new-collection \
  --allow-read-only-aws
```

The only S3 commands are `get-bucket-versioning`, `get-object-lock-configuration`, `head-object`, `get-object-retention`, and `get-object-legal-hold`, in that order. Every command binds ExpectedBucketOwner; the last three bind the exact Key and VersionId. HEAD includes ChecksumMode ENABLED. Literal JSON keeps keys such as `file://...` or leading-dash values from becoming file loads or command options. Failed, timed-out or malformed commands stop the sequence; the wrapper does not retry.

The operator's least-privilege review should cover `s3:GetBucketVersioning`, `s3:GetBucketObjectLockConfiguration`, the applicable version-specific object read permission, `s3:GetObjectRetention` and `s3:GetObjectLegalHold`. Checksum retrieval for KMS-encrypted objects can additionally require approved KMS permissions. Scope these externally; do not grant broad access just to make this tool pass. No IAM or storage policy is changed by the collector.

## Normalization and publication

The five exact CLI stdout byte sequences are retained as `<operation>.raw.json`. They are CLI representations, not HTTP wire captures or provider signatures. `G04.bin` is a compact projection into the existing observation schema. `G05.bin` is the exact supplied archive. UTC ISO8601 timestamps with `Z` or `+00:00` are normalized; invalid calendar dates are rejected. An absent DeleteMarker header on successful HEAD is represented as false; missing retention, legal-hold status, checksum or checksum type is NOT invented. Event-hold fields are unsupported. Bucket default retention does not override object-specific retention.

The existing semantic validator must pass before publication. It checks enabled versioning/lock, exact version/size/full-object checksum, timed COMPLIANCE retention, legal-hold consistency and freshness. This pre-review check uses collection completion as a local validation cutoff, not as a reviewer approval. Actual G04 review and dual approvals must occur afterward.

The output is a NEW 0700 directory with exclusive 0600 files. Existing directories/symlinks are refused, including on retries; no old evidence is overwritten or deleted. `collection-manifest.json` is written last and records request/raw/output digests, command start/end times and CLI version. A crash or filesystem failure can leave a partial directory; preserve and inspect it, do not automatically repair or overwrite it. This is not atomic whole-directory publication, immutable storage or a trusted timestamp.

Stdout contains only a small result code, counts and digests. AWS stderr, supplied paths, target names and credentials are not echoed. The protected bundle itself contains target identifiers and may contain HEAD metadata: handle it as restricted evidence. The raw files and collection manifest are NOT automatically authenticated by the pilot's twelve-file verifier. Retain their provenance in the approved evidence store, review them independently, and bind the G04/G05 bytes into the separately approved v2 packet/policy before using `audit-pilot-evidence.mjs --require-retention-profile AWS_S3_OBJECT_LOCK_COMPLIANCE_V1`.

## Tests and limits

The mandatory pilot suite runs this collector against local synthetic executables only. Tests exercise actual child processes, argument/environment isolation, raw-response projection, checksum binding, no-overwrite behavior, interruption/overflow/error handling, a real version-command timeout and CLI non-disclosure. No AWS SDK installation, real credential or network connection is needed by CI. Passing these tests is not a successful live AWS acceptance run, a delete-denial test, a full product build or resolution of #209/#220.

## Primary references

- AWS CLI HEAD and permission/checksum/conditional-header behavior: https://docs.aws.amazon.com/cli/latest/reference/s3api/head-object.html
- Versioning: https://docs.aws.amazon.com/cli/latest/reference/s3api/get-bucket-versioning.html
- Object Lock configuration: https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object-lock-configuration.html
- Version-specific retention: https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object-retention.html
- Legal hold: https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object-legal-hold.html
- Environment and precedence: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html
