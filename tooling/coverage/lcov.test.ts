import { expect, it } from 'bun:test';
import { enforceCoverage, metric, parseLcov } from './lcov.ts';

it('parses real Bun line/function counters and identifies uncovered lines', () => {
  const files = parseLcov(
    'TN:\nSF:apps/api.ts\nFNF:2\nFNH:1\nDA:1,3\nDA:2,0\nLF:2\nLH:1\nend_of_record\n',
    '/repo',
  );
  expect(files[0]?.lines).toEqual({ total: 2, covered: 1, pct: 50 });
  expect(files[0]?.functions.pct).toBe(50);
  expect(files[0]?.uncoveredLines).toEqual([2]);
  expect(() => enforceCoverage(files)).toThrow('por arquivo');
});

it('never lets a highly covered module compensate a low-coverage module', () => {
  const files = [
    {
      file: 'large.ts',
      lines: metric(1000, 1000),
      functions: metric(100, 100),
      uncoveredLines: [],
    },
    { file: 'small.ts', lines: metric(2, 1), functions: metric(2, 1), uncoveredLines: [2] },
  ];
  expect(() => enforceCoverage(files)).toThrow('small.ts');
  expect(() =>
    enforceCoverage([files[0]].filter((file): file is NonNullable<typeof file> => Boolean(file))),
  ).not.toThrow();
});

it('rejects malformed/empty reports and invalid counters', () => {
  for (const source of [
    '',
    'SF:a.ts',
    'SF:a.ts\nend_of_record',
    'SF:a.ts\nFNF:1\nFNH:1\nDA:2,-1\nend_of_record',
  ])
    expect(() => parseLcov(source, '/repo')).toThrow();
  expect(() => metric(1, 2)).toThrow('Contadores');
  expect(metric(0, 0).pct).toBe(100);
  expect(() =>
    enforceCoverage([
      {
        file: 'borderline.ts',
        lines: metric(20000, 15999),
        functions: metric(1, 1),
        uncoveredLines: [],
      },
    ]),
  ).toThrow('borderline.ts');
});
