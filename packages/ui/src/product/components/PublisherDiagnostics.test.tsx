import { beforeEach, expect, it } from 'bun:test';
import { LocaleProvider, localeStorageKey } from '@screen-share/i18n';
import { render, screen } from '@testing-library/react';
import { sharingStatus } from '../fixtures.test';
import { productTranslations } from '../locales';
import type { NativeSharingStatus } from '../types';
import { PublisherDiagnostics } from './PublisherDiagnostics';

beforeEach(() => localStorage.setItem(localeStorageKey, 'en'));
function panel(status: NativeSharingStatus) {
  return (
    <LocaleProvider translations={productTranslations} titleKey="documentTitle">
      <PublisherDiagnostics status={status} />
    </LocaleProvider>
  );
}

it('explains every allowlisted native stop reason without rendering arbitrary engine content', () => {
  const view = render(panel(sharingStatus('stopped')));
  expect(screen.queryByText(/The selected source was closed/)).toBeNull();
  const reasons = [
    'source_closed',
    'selection_canceled',
    'authorization_failed',
    'capture_failed',
    'encoder_failed',
    'transport_failed',
    'cleanup_failed',
    'lease_expired',
    'invalid_request',
    'worker_failed',
    'engine_missing',
    'child_unresponsive',
    'stopped_by_user',
    'unsupported_platform',
  ];
  for (const reason of reasons) {
    view.rerender(panel({ ...sharingStatus('stopped'), reason }));
    expect(screen.queryByText(/Sharing stopped for an unavailable reason/)).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(2);
  }
  view.rerender(panel({ ...sharingStatus('failed'), reason: '<private-engine-content>' }));
  expect(screen.getByText(/Sharing stopped for an unavailable reason/)).toBeDefined();
  expect(document.body.textContent).not.toContain('<private-engine-content>');
  view.rerender(panel({ ...sharingStatus('stopped'), reason: 'source_closed' }));
  expect(screen.getByText(/The selected source was closed/)).toBeDefined();
});

it('shows measured pipeline timing after five seconds and resets diagnosis on pause, gaps and generation changes', () => {
  const status: NativeSharingStatus = {
    ...sharingStatus('sharing'),
    captureFps: 60,
    encodedFps: 20,
    targetFps: 60,
    diagnosticsGeneration: 1,
    diagnosticsElapsedMs: 0,
    conversionSubmissionMs: 2,
    encoderOutputLatencyMs: 40,
    availableSendBitrateBps: 10_000_000,
    manualBitrateBps: 10_000_000,
  };
  const view = render(panel(status));
  expect(screen.getByText(/not enough continuous evidence/)).toBeDefined();
  for (let at = 1000; at <= 5000; at += 1000)
    view.rerender(panel({ ...status, diagnosticsElapsedMs: at }));
  expect(
    screen.getByText(/Captured frames keep up, but encoded output falls behind/),
  ).toBeDefined();
  expect(screen.getByText('2.0 ms')).toBeDefined();
  expect(screen.getByText('40.0 ms')).toBeDefined();
  expect(screen.getByText(/Source rendering activity is unavailable/)).toBeDefined();
  view.rerender(panel({ ...status, state: 'paused', diagnosticsElapsedMs: 6000 }));
  expect(screen.getByText(/not enough continuous evidence/)).toBeDefined();
  view.rerender(
    panel({
      ...status,
      diagnosticsGeneration: 2,
      diagnosticsElapsedMs: 0,
      captureFps: null,
      encodedFps: null,
      targetFps: null,
      conversionSubmissionMs: null,
      encoderOutputLatencyMs: null,
      availableSendBitrateBps: null,
    }),
  );
  expect(screen.queryByText('40.0 ms')).toBeNull();
  view.rerender(panel({ ...status, diagnosticsElapsedMs: 10_000 }));
  expect(screen.getByText(/not enough continuous evidence/)).toBeDefined();
});

it('separates fresh transport pressure from unavailable source activity and avoids diagnosing low static-scene cadence', () => {
  const status: NativeSharingStatus = {
    ...sharingStatus('sharing'),
    captureFps: 60,
    encodedFps: 20,
    diagnosticsGeneration: 1,
    diagnosticsElapsedMs: 0,
    encoderOutputLatencyMs: 1,
    availableSendBitrateBps: 1_000_000,
    manualBitrateBps: 10_000_000,
  };
  const view = render(panel(status));
  for (let at = 1000; at <= 5000; at += 1000)
    view.rerender(panel({ ...status, diagnosticsElapsedMs: at }));
  expect(screen.getByText(/fresh media transport bitrate target remains below/)).toBeDefined();
  expect(screen.queryByText(/Captured frames keep up, but encoded output falls behind/)).toBeNull();
  for (let at = 0; at <= 5000; at += 1000)
    view.rerender(
      panel({
        ...status,
        diagnosticsGeneration: 2,
        diagnosticsElapsedMs: at,
        captureFps: 1,
        encodedFps: 1,
        availableSendBitrateBps: null,
        encoderOutputLatencyMs: null,
      }),
    );
  expect(screen.getByText(/not enough continuous evidence/)).toBeDefined();
  expect(screen.queryByText(/Verified source activity exceeds/)).toBeNull();
  expect(screen.queryByText(/source is confirmed inactive/)).toBeNull();
});
