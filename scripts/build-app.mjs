// Copies the shared modules in src/ (with their folders) into docs/app/lib/ so GitHub Pages can
// serve them, and refreshes the precache list and cache version inside docs/app/sw.js.
// Usage: node scripts/build-app.mjs [--check]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
const app = join(root, 'docs', 'app');
const lib = join(app, 'lib');
const check = process.argv.includes('--check');

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const outputs = new Map();
for (const file of walk(src).filter((f) => f.endsWith('.js')).sort()) {
  const rel = relative(src, file).split(sep).join('/');
  outputs.set(join(lib, rel), `// Generated from src/${rel} by scripts/build-app.mjs. Edit the source, not this copy.\n${readFileSync(file, 'utf8')}`);
}

// Stale copies of removed sources
const stale = walk(lib).filter((f) => !outputs.has(f));

const swPath = join(app, 'sw.js');
if (existsSync(swPath)) {
  const files = new Map();
  for (const file of walk(app)) {
    if (file === swPath || file.startsWith(lib)) continue;
    files.set(file, readFileSync(file));
  }
  for (const [file, text] of outputs) files.set(file, Buffer.from(text));
  const list = [...files.keys()].map((f) => relative(app, f).split(sep).join('/')).sort();
  const hash = createHash('sha256');
  for (const name of list) hash.update(name).update(files.get(join(app, ...name.split('/'))) ?? '');
  const version = hash.digest('hex').slice(0, 12);
  const block = `// precache:start\nconst CACHE_VERSION = '${version}';\nconst PRECACHE = ${JSON.stringify(['./', ...list], null, 2).replace(/"/g, "'")};\n// precache:end`;
  const sw = readFileSync(swPath, 'utf8').replace(/\/\/ precache:start[\s\S]*?\/\/ precache:end/, block);
  outputs.set(swPath, sw);
}

let changed = 0;
for (const [file, text] of outputs) {
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === text) continue;
  changed++;
  if (check) console.error(`Out of date: ${relative(root, file)}`);
  else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}
for (const f of stale) {
  changed++;
  if (check) console.error(`Stale: ${relative(root, f)}`);
  else rmSync(f);
}
if (check && changed) {
  console.error('Run npm run build:app and commit the result.');
  process.exit(1);
}
console.log(check ? 'App build is up to date.' : `App build written (${outputs.size} files checked, ${changed} changed).`);
