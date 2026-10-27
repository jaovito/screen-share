import { isIP } from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';

export function fixtureRtcAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  hostedWindows: boolean,
) {
  if (!hostedWindows) return '127.0.0.1';
  for (const addresses of Object.values(interfaces)) {
    for (const entry of addresses ?? []) {
      if (
        !entry.internal &&
        entry.family === 'IPv4' &&
        isIP(entry.address) === 4 &&
        /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(entry.address)
      )
        return entry.address;
    }
  }
  throw new Error('Hosted Windows media fixture requires its own private IPv4 interface');
}
