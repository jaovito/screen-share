import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { parseSync } from 'oxc-parser';

const entrypoints = new Set([
  'apps/control-api/src/index.ts',
  'apps/control-api/src/migrate.ts',
  'apps/control-api/src/smoke.ts',
]);

export function verifyCoverageInventory(
  root: string,
  report = resolve(root, 'coverage/coverage-summary.json'),
) {
  const summary: unknown = JSON.parse(readFileSync(report, 'utf8'));
  if (!summary || typeof summary !== 'object') throw new Error('Relatório de cobertura inválido');

  const measured = new Set(Object.keys(summary).map((file) => resolve(file)));
  const runtimeFiles: string[] = [];

  for (const directory of ['apps', 'packages']) {
    for (const name of readdirSync(resolve(root, directory), {
      recursive: true,
      encoding: 'utf8',
    })) {
      const path = `${directory}/${name.replaceAll('\\', '/')}`;
      if (
        !path.includes('/src/') ||
        /(?:node_modules|dist|src-tauri)\//.test(path) ||
        !/\.tsx?$/.test(path) ||
        /\.(?:test|spec|d)\.tsx?$/.test(path) ||
        entrypoints.has(path)
      )
        continue;

      const file = resolve(root, path);
      const { program, errors } = parseSync(file, readFileSync(file, 'utf8'));
      if (errors.length) throw new Error(`Fonte inválida: ${path}`);

      const executable = program.body.some((node) => {
        if (node.type.startsWith('TS')) return false;
        if (node.type === 'ImportDeclaration' && node.importKind === 'type') return false;
        if (
          node.type === 'ExportNamedDeclaration' &&
          (node.exportKind === 'type' || node.declaration?.type.startsWith('TS'))
        )
          return false;
        return true;
      });
      if (executable) runtimeFiles.push(file);
    }
  }

  const missing = runtimeFiles
    .filter((file) => !measured.has(file))
    .map((file) => relative(root, file));
  if (missing.length) throw new Error(`Fontes sem relatório de cobertura: ${missing.join(', ')}`);

  return runtimeFiles.length;
}
