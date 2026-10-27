import { expect, it } from 'bun:test';
import { fixtureWindowConfig } from './config';

const mainWindow = {
  label: 'main',
  useHttpsScheme: true,
  width: 1120,
  minWidth: 720,
  dataDirectory: 'original-profile',
};
const config = {
  app: { windows: [mainWindow], security: { csp: "default-src 'self'" } },
  plugins: { updater: { pubkey: 'synthetic-public-key' } },
  bundle: { externalBin: ['binaries/ss-media-proof'] },
};

it('configures CDP through the WebView API while preserving the secure window and base configuration', () => {
  const original = structuredClone(config);
  const override = fixtureWindowConfig(config, '/owned-fixture/app-data', 9222);
  expect(config).toEqual(original);
  expect(Object.keys(override)).toEqual(['app']);
  expect(Object.keys(override.app)).toEqual(['appDirectoriesOverride', 'windows']);
  expect(override.app.appDirectoriesOverride).toBe('/owned-fixture/app-data');
  expect(override.app.windows[0]).toMatchObject({
    label: 'main',
    useHttpsScheme: true,
    width: 1120,
    minWidth: 720,
    dataDirectory: null,
  });
  expect(override.app.windows[0]?.additionalBrowserArgs).toContain('--remote-debugging-port=9222');
  expect(override.app.windows[0]?.additionalBrowserArgs).not.toContain('disable-web-security');
  expect(override.app.windows[0]?.additionalBrowserArgs).not.toContain('no-sandbox');
  expect(override.app.windows[0]?.additionalBrowserArgs).not.toContain('allow-loopback');
  expect(
    fixtureWindowConfig(config, '/owned-fixture', 9222, true).app.windows[0]?.additionalBrowserArgs,
  ).toContain('--allow-loopback-in-peer-connection');
});

it('rejects invalid ports, absent profile directories and unexpected window topology', () => {
  for (const port of [0, 65536, 9222.5, Number.NaN])
    expect(() => fixtureWindowConfig(config, '/owned-fixture/app-data', port)).toThrow();
  expect(() => fixtureWindowConfig(config, '', 9222)).toThrow();
  expect(() => fixtureWindowConfig({}, '/owned-fixture', 9222)).toThrow();
  expect(() =>
    fixtureWindowConfig({ app: { windows: [mainWindow, mainWindow] } }, '/owned-fixture', 9222),
  ).toThrow();
});
