import { mock } from 'bun:test';
import { EventEmitter } from 'node:events';

export const publisherId = '2be00d58-9715-4319-a747-725ac0735130';
export const participantId = 'e9128130-5c5a-43c1-a571-3146240e4ea5';
export const rtcRoom = 'm1-6cfb37ba-b89c-4406-8880-caa4973752d4';
export const rooms: FakeRoom[] = [];
export const workers: FakeWorker[] = [];
export const keys: FakeKeyProvider[] = [];
export const setLogLevel = mock((_level: string) => {});
export const sdkState: {
  supported: boolean;
  constructionFails: boolean;
  keyFails: boolean;
  connectPending: Promise<void> | undefined;
} = { supported: true, constructionFails: false, keyFails: false, connectPending: undefined };

export class FakeWorker {
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = mock(() => {});
  constructor() {
    workers.push(this);
  }
}

class FakeKeyProvider {
  setKey = mock(async (_key: string) => {
    if (sdkState.keyFails) throw new Error('sensitive key provider error');
  });
  constructor() {
    keys.push(this);
  }
}

type Publication = ReturnType<typeof publication>;

type RoomOptions = {
  encryption: { keyProvider: unknown; worker: unknown };
  reconnectPolicy: { nextRetryDelayInMs: () => null };
};

class FakeRoom extends EventEmitter {
  readonly options: RoomOptions;
  name = rtcRoom;
  localParticipant = { identity: participantId };
  remoteParticipants = new Map<
    string,
    { identity: string; trackPublications: Map<string, Publication> }
  >();
  setE2EEEnabled = mock(async (_enabled: boolean) => {});
  connect = mock(async (_url: string, _token: string, _options: unknown) => {
    await sdkState.connectPending;
  });
  disconnect = mock(async () => {});

  constructor(options: RoomOptions) {
    super();
    this.options = options;
    if (sdkState.constructionFails) throw new Error('private construction failure');
    rooms.push(this);
  }
}

mock.module('livekit-client', () => ({
  ExternalE2EEKeyProvider: FakeKeyProvider,
  setLogLevel,
  isE2EESupported: () => sdkState.supported,
  Room: FakeRoom,
  RoomEvent: {
    TrackPublished: 'trackPublished',
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    TrackSubscriptionFailed: 'trackSubscriptionFailed',
    EncryptionError: 'encryptionError',
    Reconnecting: 'reconnecting',
    SignalReconnecting: 'signalReconnecting',
    Disconnected: 'disconnected',
    ParticipantDisconnected: 'participantDisconnected',
    ParticipantEncryptionStatusChanged: 'participantEncryptionStatusChanged',
  },
  Track: { Kind: { Video: 'video' }, Source: { ScreenShare: 'screen_share' } },
}));

export function publication(overrides: Record<string, unknown> = {}) {
  return {
    trackSid: 'track-1',
    kind: 'video',
    source: 'screen_share',
    isEncrypted: true,
    setSubscribed: mock((_subscribed: boolean) => {}),
    ...overrides,
  };
}

export function track() {
  return { kind: 'video', attach: mock(() => {}), detach: mock(() => {}), stop: mock(() => {}) };
}

export async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

export function room() {
  const value = rooms.at(-1);
  if (!value) throw new Error('Expected an owned room');
  return value;
}
