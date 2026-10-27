import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

const publisherId = '2be00d58-9715-4319-a747-725ac0735130';
const participantId = 'e9128130-5c5a-43c1-a571-3146240e4ea5';
const rtcRoom = 'm1-6cfb37ba-b89c-4406-8880-caa4973752d4';
const rooms: FakeRoom[] = [];
const workers: FakeWorker[] = [];
const keys: FakeKeyProvider[] = [];
const setLogLevel = mock((_level: string) => {});
let supported = true;
let constructionFails = false;
let keyFails = false;
let connectPending: Promise<void> | undefined;

class FakeWorker {
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = mock(() => {});
  constructor() {
    workers.push(this);
  }
}

class FakeKeyProvider {
  setKey = mock(async (_key: string) => {
    if (keyFails) throw new Error('sensitive key provider error');
  });
  constructor() {
    keys.push(this);
  }
}

type Publication = ReturnType<typeof publication>;

class FakeRoom extends EventEmitter {
  name = rtcRoom;
  localParticipant = { identity: participantId };
  remoteParticipants = new Map<
    string,
    { identity: string; trackPublications: Map<string, Publication> }
  >();
  setE2EEEnabled = mock(async (_enabled: boolean) => {});
  connect = mock(async (_url: string, _token: string, _options: unknown) => {
    await connectPending;
  });
  disconnect = mock(async () => {});

  constructor(
    readonly options: {
      encryption: { keyProvider: unknown; worker: unknown };
      reconnectPolicy: { nextRetryDelayInMs: () => null };
    },
  ) {
    super();
    if (constructionFails) throw new Error('private construction failure');
    rooms.push(this);
  }
}

mock.module('livekit-client', () => ({
  ExternalE2EEKeyProvider: FakeKeyProvider,
  setLogLevel,
  isE2EESupported: () => supported,
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

const { receiveEncryptedSession } = await import('./encrypted-reception');
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
const originalSecure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');

function grant() {
  return {
    version: 1,
    sessionId: 'e8c4591d-e665-4d88-9e80-88f7411088f1',
    epoch: 1,
    rtcRoom,
    participantId,
    publisherId,
    role: 'viewer',
    serverUrl: 'ws://127.0.0.1:7880',
    accessToken: 'synthetic.synthetic.synthetic',
    expiresAt: Math.floor(Date.now() / 1000) + 120,
  };
}

function input(overrides: Partial<Parameters<typeof receiveEncryptedSession>[0]> = {}) {
  return {
    grant: grant(),
    mediaKey: 'a'.repeat(43),
    video: document.createElement('video'),
    onState: mock((_state: string) => {}),
    ...overrides,
  };
}

function publication(overrides: Record<string, unknown> = {}) {
  return {
    trackSid: 'track-1',
    kind: 'video',
    source: 'screen_share',
    isEncrypted: true,
    setSubscribed: mock((_subscribed: boolean) => {}),
    ...overrides,
  };
}

function track() {
  return { kind: 'video', attach: mock(() => {}), detach: mock(() => {}), stop: mock(() => {}) };
}

async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function room() {
  const value = rooms.at(-1);
  if (!value) throw new Error('Expected an owned room');
  return value;
}

beforeEach(() => {
  rooms.length = 0;
  workers.length = 0;
  keys.length = 0;
  supported = true;
  setLogLevel.mockClear();
  constructionFails = false;
  keyFails = false;
  connectPending = undefined;
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
});

afterEach(() => {
  for (const instance of rooms) instance.emit('disconnected');
  jest.useRealTimers();
  if (originalWorker) Object.defineProperty(globalThis, 'Worker', originalWorker);
  else Reflect.deleteProperty(globalThis, 'Worker');
  if (originalSecure) Object.defineProperty(globalThis, 'isSecureContext', originalSecure);
  else Reflect.deleteProperty(globalThis, 'isSecureContext');
});

describe('encrypted M1 reception', () => {
  it('rejects malformed, publisher, expired, excessive-lifetime, and invalid-key input before SDK work', () => {
    for (const overrides of [
      { grant: {} },
      { grant: { ...grant(), role: 'publisher', participantId: publisherId } },
      { grant: { ...grant(), expiresAt: Math.floor(Date.now() / 1000) - 1 } },
      { grant: { ...grant(), expiresAt: Math.floor(Date.now() / 1000) + 301 } },
      { mediaKey: 'wrong' },
    ]) {
      const settings = input(overrides);
      receiveEncryptedSession(settings).stop();
      expect(settings.onState).toHaveBeenCalledTimes(1);
    }
    expect(rooms).toHaveLength(0);
    expect(workers).toHaveLength(0);
  });

  it('refuses unsupported encryption or an insecure browser context before network or worker startup', () => {
    supported = false;
    const settings = input();
    receiveEncryptedSession(settings);
    supported = true;
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
    receiveEncryptedSession(settings);
    expect(settings.onState).toHaveBeenNthCalledWith(1, 'unsupported');
    expect(settings.onState).toHaveBeenNthCalledWith(2, 'unsupported');
    expect(rooms).toHaveLength(0);
  });

  it('configures the local worker, matching string key derivation, receive-only subscriptions, and no reconnect', async () => {
    const settings = input();
    const handle = receiveEncryptedSession(settings);
    await flush();
    expect(setLogLevel).toHaveBeenCalledWith('silent');
    expect(keys[0]?.setKey).toHaveBeenCalledWith('a'.repeat(43));
    expect(room().setE2EEEnabled).toHaveBeenCalledWith(true);
    expect(room().connect).toHaveBeenCalledWith(
      'ws://127.0.0.1:7880',
      'synthetic.synthetic.synthetic',
      expect.objectContaining({ autoSubscribe: false, maxRetries: 0 }),
    );
    expect(room().options.encryption.worker).toBe(workers[0]);
    expect(room().options.reconnectPolicy.nextRetryDelayInMs()).toBeNull();
    expect(settings.onState).toHaveBeenLastCalledWith('waiting');
    const pub = publication();
    room().emit('trackPublished', pub, { identity: publisherId });
    expect(pub.setSubscribed).toHaveBeenCalledWith(true);
    const video = track();
    room().emit('trackSubscribed', video, pub, { identity: publisherId });
    expect(video.attach).toHaveBeenCalledWith(settings.video);
    expect(settings.onState).toHaveBeenLastCalledWith('subscribed');
    handle.stop();
    handle.stop();
    expect(video.detach).toHaveBeenCalledWith(settings.video);
    expect(video.stop).toHaveBeenCalledTimes(1);
    expect(room().disconnect).toHaveBeenCalledTimes(1);
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(room().listenerCount('trackPublished')).toBe(0);
  });

  it('inspects existing publications after connection and rejects unexpected or plaintext media', async () => {
    for (const [pub, identity] of [
      [publication({ isEncrypted: false }), publisherId],
      [publication({ kind: 'audio' }), publisherId],
      [publication({ source: 'camera' }), publisherId],
      [publication(), participantId],
    ] as const) {
      const settings = input();
      receiveEncryptedSession(settings);
      room().remoteParticipants.set(identity, {
        identity,
        trackPublications: new Map([['track-1', pub]]),
      });
      await flush();
      expect(pub.setSubscribed).not.toHaveBeenCalled();
      expect(settings.onState).toHaveBeenLastCalledWith('failed');
      expect(room().disconnect).toHaveBeenCalled();
    }
  });

  it('bounds reception to one designated track and rejects unsolicited subscriptions', async () => {
    for (const invalidTrack of [track(), { ...track(), kind: 'audio' }]) {
      const settings = input();
      receiveEncryptedSession(settings);
      await flush();
      room().emit('trackPublished', publication(), { identity: publisherId });
      room().emit('trackSubscribed', invalidTrack, publication({ trackSid: 'track-2' }), {
        identity: publisherId,
      });
      expect(invalidTrack.stop).toHaveBeenCalled();
      expect(settings.onState).toHaveBeenLastCalledWith('failed');
    }
    const settings = input();
    receiveEncryptedSession(settings);
    await flush();
    room().emit('trackPublished', publication(), { identity: publisherId });
    room().emit('trackSubscribed', track(), publication(), { identity: publisherId });
    room().emit('trackSubscribed', track(), publication(), { identity: publisherId });
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
  });

  it('fails closed on encryption, subscription, reconnect, worker, and expected-publisher loss', async () => {
    for (const event of [
      'encryptionError',
      'trackUnsubscribed',
      'trackSubscriptionFailed',
      'reconnecting',
      'signalReconnecting',
      'disconnected',
      'workerError',
      'workerMessageError',
      'publisherLeft',
      'encryptionDisabled',
    ]) {
      const settings = input();
      receiveEncryptedSession(settings);
      await flush();
      room().emit('participantDisconnected', { identity: participantId });
      room().emit('participantEncryptionStatusChanged', true, { identity: publisherId });
      room().emit('participantEncryptionStatusChanged', false, { identity: participantId });
      if (event === 'workerError') workers.at(-1)?.onerror?.();
      else if (event === 'workerMessageError') workers.at(-1)?.onmessageerror?.();
      else if (event === 'publisherLeft')
        room().emit('participantDisconnected', { identity: publisherId });
      else if (event === 'encryptionDisabled')
        room().emit('participantEncryptionStatusChanged', false, { identity: publisherId });
      else room().emit(event, new Error('private failure'));
      expect(settings.onState).toHaveBeenLastCalledWith('failed');
      expect(workers.at(-1)?.terminate).toHaveBeenCalledTimes(1);
    }
  });

  it('times out, expires, and disconnects again when a cancelled connection resolves late', async () => {
    jest.useFakeTimers();
    let resolve: (() => void) | undefined;
    connectPending = new Promise<void>((done) => {
      resolve = done;
    });
    const settings = input();
    receiveEncryptedSession(settings);
    await flush();
    jest.advanceTimersByTime(15_000);
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
    resolve?.();
    await flush();
    expect(room().disconnect).toHaveBeenCalledTimes(2);

    connectPending = undefined;
    const expiring = input();
    receiveEncryptedSession(expiring);
    await flush();
    jest.advanceTimersByTime(120_000);
    expect(expiring.onState).toHaveBeenLastCalledWith('expired');
  });

  it('cleans construction/key failures and prevents room connection when cancelled during key preparation', async () => {
    constructionFails = true;
    const settings = input();
    receiveEncryptedSession(settings);
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    constructionFails = false;
    keyFails = true;
    receiveEncryptedSession(settings);
    await flush();
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
    expect(room().connect).not.toHaveBeenCalled();
    keyFails = false;
    const handle = receiveEncryptedSession(settings);
    handle.stop();
    await flush();
    expect(room().connect).not.toHaveBeenCalled();
  });

  it('never subscribes before verifying room and participant identity, and rejects unsolicited media', async () => {
    let resolve: (() => void) | undefined;
    connectPending = new Promise<void>((done) => {
      resolve = done;
    });
    const settings = input();
    const handle = receiveEncryptedSession(settings);
    const pub = publication();
    room().emit('trackPublished', pub, { identity: publisherId });
    expect(pub.setSubscribed).not.toHaveBeenCalled();
    const unsolicited = track();
    room().emit('trackSubscribed', unsolicited, pub, { identity: publisherId });
    expect(unsolicited.stop).toHaveBeenCalled();
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
    handle.stop();
    resolve?.();
    await flush();
  });

  it('releases every other owned resource when SDK detach and track stop throw', async () => {
    const settings = input();
    const handle = receiveEncryptedSession(settings);
    await flush();
    const pub = publication();
    const videoTrack = track();
    room().emit('trackPublished', pub, { identity: publisherId });
    room().emit('trackSubscribed', videoTrack, pub, { identity: publisherId });
    videoTrack.detach.mockImplementation(() => {
      throw new Error('sensitive detach failure');
    });
    videoTrack.stop.mockImplementation(() => {
      throw new Error('sensitive stop failure');
    });
    room().emit('encryptionError', new Error('private encryption failure'));
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
    expect(videoTrack.detach).toHaveBeenCalledTimes(1);
    expect(videoTrack.stop).toHaveBeenCalledTimes(1);
    expect(room().disconnect).toHaveBeenCalledTimes(1);
    expect(workers[0]?.terminate).toHaveBeenCalledTimes(1);
    expect(room().listenerCount('trackSubscribed')).toBe(0);
    expect(settings.video.srcObject).toBeNull();
    handle.stop();
    expect(room().disconnect).toHaveBeenCalledTimes(1);
  });

  it('rejects a server room or participant different from the operator envelope', async () => {
    const settings = input();
    receiveEncryptedSession(settings);
    room().name = 'unexpected-room';
    await flush();
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
    receiveEncryptedSession(settings);
    room().localParticipant.identity = publisherId;
    await flush();
    expect(settings.onState).toHaveBeenLastCalledWith('failed');
  });
});
