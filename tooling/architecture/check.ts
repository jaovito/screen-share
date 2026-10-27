import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeSource, findCycles, normalizedPath } from './analyze';

const root = resolve(import.meta.dirname, '../..');
const sources = new Map<string, string>();
let errors = 0;
const publicExports = new Map<string, Set<string>>();

for (const directory of readdirSync(resolve(root, 'packages'))) {
  const manifest: unknown = JSON.parse(
    readFileSync(resolve(root, 'packages', directory, 'package.json'), 'utf8'),
  );
  if (
    manifest &&
    typeof manifest === 'object' &&
    'exports' in manifest &&
    manifest.exports &&
    typeof manifest.exports === 'object'
  )
    publicExports.set(directory, new Set(Object.keys(manifest.exports)));
}

for (const directory of ['apps', 'packages']) {
  for (const name of readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })) {
    const normalized = name.replaceAll('\\', '/');

    if (
      !normalized.includes('/src/') ||
      /(?:node_modules|dist|src-tauri)\//.test(normalized) ||
      !/\.tsx?$/.test(normalized) ||
      /\.(test|spec)\.tsx?$/.test(normalized)
    )
      continue;

    const file = resolve(root, directory, name);
    const code = readFileSync(file, 'utf8');

    sources.set(file, code);

    const issues = analyzeSource(normalizedPath(root, file), code, publicExports);
    const lines = code.split('\n').length;

    if (lines >= 500) issues.push('Source must stay below 500 lines; refactor.');
    else if (lines > 300) console.warn(`${directory}/${name}: review size (${lines} lines).`);

    for (const issue of issues) {
      console.error(`${directory}/${name}: ${issue}`);
      errors++;
    }
  }
}

for (const issue of findCycles(sources)) {
  console.error(issue);
  errors++;
}

if (errors) process.exitCode = 1;
else console.log('Architecture boundaries verified.');
