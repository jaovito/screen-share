import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { verifyCoverageInventory } from './inventory';
import { enforceCoverage, type FileCoverage, metric, parseLcov } from './lcov';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function writeCoverageReport(root: string, suites: string[]) {
  const sources = suites.map((suite) =>
    readFileSync(resolve(root, `coverage/${suite}/lcov.info`), 'utf8'),
  );
  const files = sources.flatMap((source) => parseLcov(source, root));
  // Check every occurrence, including modules measured in multiple suites.
  enforceCoverage(files);
  const unique = new Map<string, FileCoverage>();

  for (const file of files) {
    const previous = unique.get(file.file);
    // For duplicates, retain the occurrence with lower coverage rather than averaging.
    if (
      !previous ||
      Math.min(file.lines.pct, file.functions.pct) <
        Math.min(previous.lines.pct, previous.functions.pct)
    )
      unique.set(file.file, file);
  }

  const entries = [...unique.values()];
  const totals = {
    lines: metric(
      entries.reduce((sum, file) => sum + file.lines.total, 0),
      entries.reduce((sum, file) => sum + file.lines.covered, 0),
    ),
    functions: metric(
      entries.reduce((sum, file) => sum + file.functions.total, 0),
      entries.reduce((sum, file) => sum + file.functions.covered, 0),
    ),
  };
  const summary = Object.fromEntries(
    entries.map((file) => [file.file, { lines: file.lines, functions: file.functions }]),
  );
  writeFileSync(
    resolve(root, 'coverage/coverage-summary.json'),
    JSON.stringify({ total: totals, ...summary }, null, 2),
  );
  writeFileSync(resolve(root, 'coverage/lcov.info'), sources.join('\n'));

  const rows = entries
    .map(
      (file) =>
        `<tr><td>${escapeHtml(relative(root, file.file))}</td><td>${file.lines.pct}%</td><td>${file.functions.total ? `${file.functions.pct}%` : '—'}</td><td>${file.uncoveredLines.join(', ') || '—'}</td></tr>`,
    )
    .join('');
  writeFileSync(
    resolve(root, 'coverage/index.html'),
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cobertura Bun Test</title><style>body{font:16px system-ui;margin:32px;background:#0c1018;color:#e6e9ef}table{border-collapse:collapse;width:100%;font-size:14px}td,th{padding:12px;text-align:left;border-bottom:1px solid #344053}h1{font-size:28px}</style><h1>Cobertura Bun Test</h1><p>Linhas: ${totals.lines.pct}% · Funções: ${totals.functions.pct}% · Mínimo por arquivo: 80%</p><p>Contadores nativos LCOV. Arquivos sem funções próprias aparecem como —.</p><table><thead><tr><th>Arquivo</th><th>Linhas</th><th>Funções</th><th>Linhas não cobertas</th></tr></thead><tbody>${rows}</tbody></table></html>`,
  );

  const count = verifyCoverageInventory(root);
  console.log(
    `Coverage inventory verified: ${count} runtime files measured; lines ${totals.lines.pct}%, functions ${totals.functions.pct}%.`,
  );
  return totals;
}
