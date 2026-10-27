import { z } from 'zod';

const desktopConfig = z.object({
  app: z.object({ windows: z.array(z.record(z.string(), z.unknown())).length(1) }),
});

export function fixtureWindowConfig(
  input: unknown,
  appDataDirectory: string,
  debugPort: number,
  allowLoopback = false,
) {
  const config = desktopConfig.parse(input);
  const port = z.number().int().min(1).max(65535).parse(debugPort);
  const directory = z.string().min(1).parse(appDataDirectory);
  return {
    app: {
      appDirectoriesOverride: directory,
      windows: config.app.windows.map((window) => ({
        ...window,
        dataDirectory: null,
        // Preserve pinned Wry defaults; add automation only to the fixture binary.
        additionalBrowserArgs:
          '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection ' +
          `--remote-debugging-port=${port} ` +
          (allowLoopback ? '--allow-loopback-in-peer-connection ' : '') +
          '--autoplay-policy=no-user-gesture-required',
      })),
    },
  };
}
