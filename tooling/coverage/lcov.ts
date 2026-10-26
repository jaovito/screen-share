import { resolve } from 'node:path';

export type CoverageMetric = { total: number; covered: number; pct: number };
export type FileCoverage = {
  file: string;
  lines: CoverageMetric;
  functions: CoverageMetric;
  uncoveredLines: number[];
};

export function metric(total: number, covered: number): CoverageMetric {
  if (
    !Number.isInteger(total) ||
    !Number.isInteger(covered) ||
    total < 0 ||
    covered < 0 ||
    covered > total
  )
    throw new Error('Contadores LCOV inválidos');

  return { total, covered, pct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100 };
}

export function parseLcov(source: string, root: string): FileCoverage[] {
  const files: FileCoverage[] = [];
  let filename: string | undefined;
  let functionTotal: number | undefined;
  let functionHits: number | undefined;
  let lines = new Map<number, number>();

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('SF:')) filename = resolve(root, line.slice(3));
    if (line.startsWith('FNF:')) functionTotal = Number(line.slice(4));
    if (line.startsWith('FNH:')) functionHits = Number(line.slice(4));
    if (line.startsWith('DA:')) {
      const [number, hits] = line.slice(3).split(',').map(Number);
      if (!number || hits === undefined || !Number.isInteger(hits) || hits < 0)
        throw new Error('Linha LCOV inválida');
      lines.set(number, Math.max(lines.get(number) ?? 0, hits));
    }

    if (line === 'end_of_record') {
      if (!filename || functionTotal === undefined || functionHits === undefined)
        throw new Error('Registro LCOV incompleto');
      const missing = [...lines].filter(([, hits]) => hits === 0).map(([number]) => number);
      files.push({
        file: filename,
        functions: metric(functionTotal, functionHits),
        lines: metric(lines.size, lines.size - missing.length),
        uncoveredLines: missing,
      });
      filename = undefined;
      functionTotal = undefined;
      functionHits = undefined;
      lines = new Map();
    }
  }

  if (filename || files.length === 0) throw new Error('Relatório LCOV ausente ou incompleto');
  return files;
}

export function enforceCoverage(files: FileCoverage[], minimum = 80) {
  const failed = files.filter(
    (file) =>
      file.lines.covered * 100 < file.lines.total * minimum ||
      file.functions.covered * 100 < file.functions.total * minimum,
  );
  if (failed.length)
    throw new Error(
      `Cobertura abaixo de ${minimum}% por arquivo: ${failed.map((file) => file.file).join(', ')}`,
    );
}
