// Syntax check every JavaScript file in the project.
//
// `node --check` is not enough here: it silently skips files that contain
// `import` statements, and it does not understand JSX. This script uses the
// same parser that the Next.js build uses (SWC), so it catches the same
// problems the build would.
//
// Usage: npm run check

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('next/dist/build/swc');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'dist', 'coverage', '.vercel']);
const EXTENSIONS = new Set(['.js', '.mjs', '.jsx']);

async function collect(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...(await collect(full)));
    } else if (EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

const files = (await collect(ROOT)).sort();
let failures = 0;

for (const file of files) {
  const code = await readFile(file, 'utf8');
  try {
    await parse(code, { filename: file, syntax: 'ecmascript', jsx: true, target: 'es2022' });
  } catch (error) {
    failures += 1;
    console.error(`✗ ${relative(ROOT, file)}\n  ${error?.message?.split('\n')[0] || error}`);
  }
}

if (failures) {
  console.error(`\n${failures} of ${files.length} files failed to parse.`);
  process.exit(1);
}

console.log(`✓ ${files.length} JavaScript files parsed without syntax errors.`);
