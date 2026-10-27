import { expect, it } from 'bun:test';
import type { NetworkInterfaceInfo } from 'node:os';
import { fixtureRtcAddress } from './network';

function address(value: string, internal = false): NetworkInterfaceInfo {
  return {
    address: value,
    family: value.includes(':') ? 'IPv6' : 'IPv4',
    netmask: '255.255.255.0',
    mac: '00:00:00:00:00:00',
    cidr: null,
    scopeid: 0,
    internal,
  };
}

it('preserves loopback for local operator runs', () => {
  expect(fixtureRtcAddress({ owned: [address('10.0.0.2')] }, false)).toBe('127.0.0.1');
});

it('uses only an enumerated private IPv4 belonging to the hosted runner', () => {
  for (const value of ['10.1.0.2', '192.168.0.5', '172.16.0.5', '172.31.255.2']) {
    expect(
      fixtureRtcAddress(
        {
          missing: undefined,
          public: [address('8.8.8.8')],
          loopback: [address('127.0.0.1', true)],
          ipv6: [address('::1', true)],
          owned: [address(value)],
        },
        true,
      ),
    ).toBe(value);
  }
});

it('refuses absent, public, malformed and non-private interfaces rather than advertising another host', () => {
  for (const value of ['172.15.0.1', '172.32.0.1', '192.167.0.1', '10.999.0.1', '8.8.8.8']) {
    expect(() => fixtureRtcAddress({ owned: [address(value)] }, true)).toThrow('own private IPv4');
  }
  expect(() => fixtureRtcAddress({}, true)).toThrow('own private IPv4');
});
