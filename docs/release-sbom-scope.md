# Production-root source SBOM

The release artifact `hrbp-one.cdx.json` describes the dependency graph rooted
in the application's production declarations in `package.json`, resolved from
the **committed npm v2/v3 lockfile**. It is a pre-build source inventory, not an
attestation of the packages actually installed in a container, running Worker
or customer environment. The manifest and SBOM both label the scope as
`production-root-lock-graph`.

## Why generation changed

QA found that the old populated-document/count check accepted an SBOM missing
Next.js, React and React DOM. The native `npm sbom --omit=dev` selector can omit
runtime packages which also have development-tool peer relationships. The
problem was reproduced on this repository's exact locked graph, separately
from the existing successful application build; it is not an installation or
CVE finding. npm's upstream report is https://github.com/npm/cli/issues/7909.

The generator requests the full lock-only native CycloneDX inventory with all
dependency types explicitly included. It then selects **positive reachability
from production roots**, never root `devDependencies`. Transitive dependencies,
resolved peers and optional packages are retained. All platform-specific
optional variants recorded in the lock are included, even when not installed
on the current runner; absent optional dependencies are not fabricated. A
package reachable through a production optional/peer relation may also be
listed as a root development tool (for example Prisma/TypeScript). It remains
in this source inventory because of that production relation. Exclusively
build-time packages such as ESLint are not production roots.

Names, versions, package URLs, source integrity hashes and metadata come from
the lock and native npm inventory, not a fabricated package list. Dependency
resolution respects nested installation paths and scoped packages. Distinct
locked paths receive unique CycloneDX references even when native npm repeats
a name/version reference. The source package and lockfile are not rewritten.
Workspaces, linked packages and non-registry identities which cannot be proved
by this validator fail closed rather than receiving an incomplete inventory.

## Release gate

Both generation and standalone validation compare every selected package's
path, exact identity/version/purl and locked integrity, and all direct and
transitive graph edges. Missing packages cannot pass by padding the component
count. Duplicate, dangling, disconnected or changed edges are rejected.
Artifact hashes, revision identity, migration inventory and secret-leak checks
remain in place. A self-consistent artifact checksum is not enough to bypass
the independent source graph checks.

`node --test scripts/release-sbom.test.mjs` exercises the projection and negative
cases plus real npm generation/validation in an isolated temporary Git fixture.
No network or package installation is required for the lock-only SBOM command.
The production dependency audit remains a separate unchanged command. Source
SBOM completeness does not certify the absence of vulnerabilities or the live
deployed revision. See npm's lock-only metadata limitations at
https://docs.npmjs.com/cli/commands/npm-sbom/.
