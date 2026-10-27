import { describe, expect, it } from 'bun:test';
import { analyzeSource, findCycles, importsOf, normalizedPath } from './analyze';

describe('architecture boundaries', () => {
  it('reads static imports, exports and dynamic imports without matching comments', () => {
    expect(
      importsOf(
        'a.ts',
        `import type { A } from './a'; export * from './b'; void import('./c'); const name='./ignored'; void import(name); // import 'bad'`,
      ),
    ).toEqual(['./a', './b', './c']);
  });

  it('requires public APIs and correct frontend dependency direction', () => {
    expect(
      analyzeSource(
        'apps/desktop/src/app/App/index.tsx',
        `import '@screen-share/contracts/dist/index.js';`,
      ),
    ).toContain('Workspaces must be imported through public exports.');
    expect(
      analyzeSource('apps/desktop/src/app/App/index.tsx', `import '@screen-share/ui/styles.css';`),
    ).toEqual([]);
    const page = 'apps/viewer-web/src/features/viewer/pages/Page/index.tsx';

    expect(analyzeSource(page, `import 'pg'; import 'node:fs';`)).toHaveLength(2);
    expect(analyzeSource(page, `import '../../../other/components/Private';`)).toContain(
      'Cross-feature imports must use the public index.',
    );
    expect(analyzeSource(page, `import '../../../other';`)).toEqual([]);
    expect(
      analyzeSource('apps/viewer-web/src/features/viewer/index.ts', `import '../../app/App';`),
    ).toContain('Feature must not depend on app composition.');
    expect(
      analyzeSource('apps/viewer-web/src/shared/index.ts', `import '../features/viewer';`),
    ).toContain('Shared must not depend on app or features.');
    expect(
      analyzeSource('apps/viewer-web/src/app/main.tsx', `import '../../../control-api/src/app';`),
    ).toContain('Browser cannot import API internals.');
  });

  it('keeps domain/application independent from outbound adapters', () => {
    expect(
      analyzeSource(
        'apps/control-api/src/modules/rooms/domain/room.ts',
        `import 'hono'; import '../adapters/db';`,
      ),
    ).toHaveLength(2);
    expect(
      analyzeSource(
        'apps/control-api/src/modules/rooms/application/room.ts',
        `import '../adapters/db';`,
      ),
    ).toHaveLength(1);
    expect(
      analyzeSource(
        'apps/control-api/src/modules/rooms/application/room.ts',
        `import '../domain/room';`,
      ),
    ).toEqual([]);
  });

  it('rejects cycles, tolerates external imports and normalizes paths', () => {
    expect(
      findCycles(
        new Map([
          ['/a.ts', `import './b'; import 'react';`],
          ['/b.ts', `import './a';`],
        ]),
      ),
    ).toHaveLength(1);
    expect(findCycles(new Map([['/a.ts', `import './missing';`]]))).toEqual([]);
    expect(normalizedPath('/repo', '/repo/apps/viewer.ts')).toBe('apps/viewer.ts');
  });
});

it('enforces boundaries and detects cycles through aliases', () => {
  const page = 'apps/viewer-web/src/features/viewer/pages/Page/index.tsx';
  expect(analyzeSource(page, "import '@features/other/components/Private';")).toContain(
    'Cross-feature imports must use the public index.',
  );
  expect(analyzeSource(page, "import '@features/other';")).toEqual([]);
  expect(analyzeSource(page, "import '@app/App';")).toContain(
    'Feature must not depend on app composition.',
  );
  expect(
    analyzeSource('apps/viewer-web/src/shared/state.ts', "import '@features/viewer';"),
  ).toContain('Shared must not depend on app or features.');
  expect(
    analyzeSource(
      'apps/control-api/src/modules/rooms/domain/room.ts',
      "import '@modules/rooms/adapters/db';",
    ),
  ).toContain('Domain dependencies must point inward.');
  expect(
    analyzeSource(
      'apps/control-api/src/modules/rooms/application/use-case.ts',
      "import '@modules/rooms/adapters/db';",
    ),
  ).toContain('Application must depend on ports, not adapters.');
  expect(
    analyzeSource(
      'apps/control-api/src/modules/rooms/domain/room.ts',
      "import '@modules/profiles/domain/profile';",
    ),
  ).toEqual([]);
  expect(
    analyzeSource('apps/control-api/src/modules/rooms/domain/room.ts', "import '@runtime/server';"),
  ).toContain('Domain dependencies must point inward.');
  expect(
    analyzeSource(
      'apps/control-api/src/modules/rooms/application/use-case.ts',
      "import '@runtime/server';",
    ),
  ).toContain('Application must depend on ports, not adapters.');

  expect(
    findCycles(
      new Map([
        ['/repo/apps/viewer-web/src/features/one/index.ts', "import '@features/two';"],
        ['/repo/apps/viewer-web/src/features/two/index.ts', "import '@features/one';"],
      ]),
    ),
  ).toHaveLength(1);
});
