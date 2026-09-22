import { readdir } from "node:fs/promises";
import path from "node:path";

const appDir = path.resolve("app");
const routeFiles = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (entry.name === "route.ts" || entry.name === "route.tsx" || entry.name === "page.ts" || entry.name === "page.tsx") {
      routeFiles.push(full);
    }
  }
}

await walk(appDir);

const dynamicPrefixNames = new Map();
const conflicts = [];

for (const file of routeFiles) {
  const relativeDir = path.relative(appDir, path.dirname(file));
  const segments = relativeDir.split(path.sep).filter(Boolean);
  const normalized = [];

  for (const segment of segments) {
    const match = /^\[([^.[\]]+)\]$/.exec(segment);
    if (match) {
      const name = match[1];
      normalized.push("[]");
      const key = normalized.join("/");
      const previous = dynamicPrefixNames.get(key);
      if (previous && previous.name !== name) {
        conflicts.push({ key, first: previous, second: { name, file: path.relative(process.cwd(), file) } });
      } else if (!previous) {
        dynamicPrefixNames.set(key, { name, file: path.relative(process.cwd(), file) });
      }
    } else {
      normalized.push(segment);
    }
  }
}

if (conflicts.length) {
  console.error("Next.js dynamic route parameter conflicts detected:\n");
  for (const conflict of conflicts) {
    console.error(`- ${conflict.key}: [${conflict.first.name}] in ${conflict.first.file} conflicts with [${conflict.second.name}] in ${conflict.second.file}`);
  }
  process.exit(1);
}

console.log(`Validated ${routeFiles.length} Next.js route/page files: dynamic segment names are consistent.`);
