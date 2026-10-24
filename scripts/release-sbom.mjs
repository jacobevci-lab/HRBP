// Source SBOM, not an inventory of an installed container or a live Worker.
// Select from production roots by positive lockfile reachability. npm's .dev
// selector can also match runtime packages which are peers of development tools.
const PATH_PROPERTY = "cdx:npm:package:path";
export const SBOM_SCOPE = "production-root-lock-graph";
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const namePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const locationPattern = /^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/i;
function check(condition, message) { if (!condition) throw new Error(`SBOM: ${message}`); }
function fields(value, key) {
  const result = value[key] ?? {};
  check(object(result), `invalid ${key}`);
  for (const [name, spec] of Object.entries(result)) {
    check(namePattern.test(name) && name !== "." && name !== ".." && typeof spec === "string" && spec.length > 0,
      `invalid ${key} declaration`);
  }
  return result;
}
const normalized = (value) => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, "en")));
const parentLocation = (location) => {
  const index = location.lastIndexOf("/node_modules/");
  return index < 0 ? "" : location.slice(0, index);
};
const nameAt = (location) => location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
const refAt = (location) => location ? `urn:hrbp:sbom:${encodeURIComponent(location)}` : "urn:hrbp:sbom:root";
const purlFor = (name, version) => `pkg:npm/${name.replace(/^@/, "%40")}@${version}`;

export function productionLockGraph(pkg, lock) {
  check(object(pkg) && typeof pkg.name === "string" && namePattern.test(pkg.name) && typeof pkg.version === "string" && pkg.version.length > 0, "invalid application identity");
  check(object(lock) && [2, 3].includes(lock.lockfileVersion) && object(lock.packages) && object(lock.packages[""]), "a v2/v3 package lock is required");
  check(!pkg.workspaces && !lock.packages[""].workspaces, "workspace releases require a workspace-aware inventory");
  const entries = lock.packages;
  check(Object.keys(entries).length <= 50000, "lock inventory exceeds the supported bound");
  check(entries[""].name === pkg.name && entries[""].version === pkg.version, "lock application identity differs from package.json");
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    check(normalized(fields(pkg, field)) === normalized(fields(entries[""], field)), `lock root ${field} differs from package.json`);
  }
  const resolve = (from, name) => {
    let current = from;
    while (true) {
      const candidate = `${current ? `${current}/` : ""}node_modules/${name}`;
      if (own(entries, candidate)) return candidate;
      if (!current) return null;
      current = parentLocation(current);
    }
  };
  const queue = [""], nodes = new Map();
  for (let index = 0; index < queue.length; index++) {
    const location = queue[index];
    if (nodes.has(location)) continue;
    const entry = entries[location];
    check(object(entry) && !entry.link, "linked/workspace packages require an explicit release inventory");
    check(!location || locationPattern.test(location), "invalid package location");
    const name = location ? entry.name || nameAt(location) : pkg.name;
    check(namePattern.test(name) && typeof entry.version === "string" && entry.version.length > 0, `invalid locked package at ${location || "root"}`);
    const node = { location, name, version: entry.version, integrity: entry.integrity, dependencies: new Set() };
    nodes.set(location, node);
    const dependencies = fields(entry, "dependencies"), optional = fields(entry, "optionalDependencies"), peers = fields(entry, "peerDependencies");
    const edges = new Map(Object.keys(dependencies).map((name) => [name, { optional: false, peer: false }]));
    for (const name of Object.keys(optional)) edges.set(name, { optional: true, peer: false });
    for (const name of Object.keys(peers)) if (!edges.has(name)) {
      edges.set(name, { optional: entry.peerDependenciesMeta?.[name]?.optional === true, peer: true });
    }
    // Deliberately never seed root devDependencies, nor any package's devDependencies.
    for (const [name, edge] of edges) {
      const target = resolve(edge.peer ? parentLocation(location) : location, name);
      if (!target) { check(edge.optional, `required locked dependency ${name} is missing at ${location || "root"}`); continue; }
      node.dependencies.add(target);
      if (!nodes.has(target)) queue.push(target);
    }
  }
  return nodes;
}

function componentPath(component) {
  check(Array.isArray(component?.properties), "component properties are missing");
  const paths = component.properties.filter((item) => item?.name === PATH_PROPERTY);
  check(paths?.length === 1 && typeof paths[0].value === "string", "component must have one locked package path");
  return paths[0].value;
}
function validateIdentity(component, node) {
  check(component?.name === node.name && component?.version === node.version && component?.purl === purlFor(node.name, node.version),
    `component identity/version differs from lock at ${node.location || "root"}`);
  if (node.integrity) {
    check(typeof node.integrity === "string", "invalid locked integrity");
    const digests = node.integrity.split(/\s+/).map(token => token.match(/^sha(1|256|384|512)-([A-Za-z0-9+/]+={0,2})$/)).filter(Boolean)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    check(digests.length > 0, "unsupported locked integrity format");
    const digest = digests[0], bytes = Buffer.from(digest[2], "base64");
    check(bytes.length === (digest[1] === "1" ? 20 : Number(digest[1]) / 8), "invalid locked digest length");
    check(Array.isArray(component.hashes) && component.hashes.some(hash => hash?.alg === `SHA-${digest[1]}` && hash.content === bytes.toString("hex")),
      `component integrity differs from lock at ${node.location}`);
  }
}

export function createProductionSbom(full, pkg, lock) {
  const graph = productionLockGraph(pkg, lock);
  check(full?.bomFormat === "CycloneDX" && Array.isArray(full.components), "npm did not return CycloneDX components");
  const byPath = new Map();
  for (const component of full.components) {
    const location = componentPath(component);
    check(location && !byPath.has(location), "duplicate/empty npm component path");
    byPath.set(location, component);
  }
  const root = structuredClone(full.metadata?.component);
  check(root?.version === pkg.version && root?.purl === purlFor(pkg.name, pkg.version), "npm root does not match the application");
  // npm can use the checkout directory basename for root.name; use the verified
  // package identity instead, without changing the package or the lockfile.
  root.name = pkg.name;
  root.type = "application";
  root["bom-ref"] = refAt("");
  const ordered = [...graph.values()].filter((node) => node.location).sort((a, b) => a.location.localeCompare(b.location, "en"));
  const components = ordered.map((node) => {
    const component = byPath.get(node.location);
    check(component, `npm inventory omitted locked production package ${node.name}`);
    validateIdentity(component, node);
    return { ...structuredClone(component), "bom-ref": refAt(node.location) };
  });
  const dependencies = [graph.get(""), ...ordered].map((node) => ({
    ref: refAt(node.location), dependsOn: [...node.dependencies].map(refAt).sort()
  }));
  const result = { ...structuredClone(full), metadata: { ...structuredClone(full.metadata), component: root,
    properties: [...(full.metadata?.properties ?? []).filter((p) => p.name !== "hrbp:sbom:scope"),
      { name: "hrbp:sbom:scope", value: SBOM_SCOPE }] }, components, dependencies };
  validateProductionSbom(result, pkg, lock);
  return result;
}

export function validateProductionSbom(sbom, pkg, lock) {
  const graph = productionLockGraph(pkg, lock);
  check(sbom?.bomFormat === "CycloneDX" && Array.isArray(sbom.components) && Array.isArray(sbom.dependencies), "invalid CycloneDX structure");
  check(sbom.metadata?.properties?.filter((p) => p.name === "hrbp:sbom:scope" && p.value === SBOM_SCOPE).length === 1, "source inventory scope is missing");
  const components = [sbom.metadata?.component, ...sbom.components], refs = new Set();
  check(components.length === graph.size, "component inventory does not match the production lock graph");
  const seen = new Set();
  for (const component of components) {
    const location = componentPath(component), node = graph.get(location);
    check(node && !seen.has(location), "unexpected/duplicate locked package path");
    validateIdentity(component, node);
    check(component["bom-ref"] === refAt(location) && !refs.has(component["bom-ref"]), "invalid/duplicate component reference");
    seen.add(location); refs.add(component["bom-ref"]);
  }
  check(sbom.metadata.component.type === "application", "root is not the application");
  check(sbom.dependencies.length === graph.size, "dependency graph node inventory is incomplete");
  const remaining = new Map([...graph.values()].map((node) => [refAt(node.location), [...node.dependencies].map(refAt).sort()]));
  for (const edge of sbom.dependencies) {
    check(remaining.has(edge.ref) && Array.isArray(edge.dependsOn), "unexpected/duplicate dependency graph node");
    check(JSON.stringify([...edge.dependsOn].sort()) === JSON.stringify(remaining.get(edge.ref)), "dependency edges differ from the production lock graph");
    remaining.delete(edge.ref);
  }
  return { components: graph.size - 1, directDependencies: graph.get("").dependencies.size, scope: SBOM_SCOPE };
}
