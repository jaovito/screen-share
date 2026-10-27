import { mediaProofGrantSchema } from '@screen-share/contracts';
import {
  ExternalE2EEKeyProvider,
  isE2EESupported,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  setLogLevel,
  Track,
} from 'livekit-client';

export type ReceptionState =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'subscribed'
  | 'invalidGrant'
  | 'invalidKey'
  | 'unsupported'
  | 'expired'
  | 'failed';

type ReceptionInput = {
  grant: unknown;
  mediaKey: string;
  video: HTMLVideoElement;
  onState: (state: ReceptionState) => void;
};

/** An explicitly started, receive-only M1 experiment; never acquires local media. */
export function receiveEncryptedSession({
  grant: rawGrant,
  mediaKey,
  video,
  onState,
}: ReceptionInput) {
  const parsed = mediaProofGrantSchema.safeParse(rawGrant);
  const noop = { stop() {} };

  if (!parsed.success || parsed.data.role !== 'viewer') {
    onState('invalidGrant');
    return noop;
  }

  const grant = parsed.data;
  const { publisherId, rtcRoom, participantId, serverUrl } = grant;
  let accessToken = grant.accessToken;
  const remainingMs = grant.expiresAt * 1000 - Date.now();

  if (remainingMs <= 0 || remainingMs > 300_000) {
    onState('expired');
    return noop;
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(mediaKey)) {
    onState('invalidKey');
    return noop;
  }
  if (!isE2EESupported() || !globalThis.isSecureContext) {
    onState('unsupported');
    return noop;
  }

  let worker: Worker | undefined;
  let room: Room;
  let keyProvider: ExternalE2EEKeyProvider;

  try {
    setLogLevel('silent');
    keyProvider = new ExternalE2EEKeyProvider();
    worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), {
      type: 'module',
    });
    room = new Room({
      encryption: { keyProvider, worker },
      reconnectPolicy: { nextRetryDelayInMs: () => null },
      disconnectOnPageLeave: true,
      adaptiveStream: false,
      dynacast: false,
    });
  } catch {
    bestEffort(() => worker?.terminate());
    onState('failed');
    return noop;
  }

  let stopped = false;
  let verified = false;
  let selectedSid: string | undefined;
  let attached: RemoteTrack | undefined;
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;

  function bestEffort(action: () => unknown) {
    try {
      action();
    } catch {
      // One failing SDK resource must not prevent releasing the remaining resources.
    }
  }

  function disconnect() {
    bestEffort(() => {
      void room.disconnect().catch(() => {});
    });
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    mediaKey = '';
    accessToken = '';
    clearTimeout(connectionTimer);
    clearTimeout(expiryTimer);
    bestEffort(() => room.removeAllListeners());
    bestEffort(() => attached?.detach(video));
    bestEffort(() => attached?.stop());
    bestEffort(() => {
      video.srcObject = null;
    });
    disconnect();
    bestEffort(() => worker?.terminate());
  }

  function fail(state: ReceptionState = 'failed') {
    if (stopped) return;
    stop();
    onState(state);
  }

  function accepts(publication: RemoteTrackPublication, participant: RemoteParticipant) {
    return (
      participant.identity === publisherId &&
      publication.kind === Track.Kind.Video &&
      publication.source === Track.Source.ScreenShare &&
      publication.isEncrypted &&
      (selectedSid === undefined || selectedSid === publication.trackSid)
    );
  }

  function subscribe(publication: RemoteTrackPublication, participant: RemoteParticipant) {
    if (stopped || !verified) return;
    if (!accepts(publication, participant)) {
      fail();
      return;
    }
    selectedSid = publication.trackSid;
    try {
      publication.setSubscribed(true);
    } catch {
      fail();
    }
  }

  room.on(RoomEvent.TrackPublished, subscribe);
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (stopped) {
      bestEffort(() => track.stop());
      return;
    }
    if (
      !verified ||
      selectedSid !== publication.trackSid ||
      !accepts(publication, participant) ||
      track.kind !== Track.Kind.Video ||
      attached
    ) {
      bestEffort(() => track.stop());
      fail();
      return;
    }
    selectedSid = publication.trackSid;
    attached = track;
    try {
      track.attach(video);
      onState('subscribed');
    } catch {
      fail();
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, () => fail());
  room.on(RoomEvent.TrackSubscriptionFailed, () => fail());
  room.on(RoomEvent.EncryptionError, () => fail());
  room.on(RoomEvent.Reconnecting, () => fail());
  room.on(RoomEvent.SignalReconnecting, () => fail());
  room.on(RoomEvent.Disconnected, () => fail());
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant.identity === publisherId) fail();
  });
  room.on(RoomEvent.ParticipantEncryptionStatusChanged, (encrypted, participant) => {
    if (participant?.identity === publisherId && !encrypted) fail();
  });
  worker.onerror = () => fail();
  worker.onmessageerror = () => fail();

  onState('connecting');
  connectionTimer = setTimeout(() => fail(), 15_000);
  expiryTimer = setTimeout(() => fail('expired'), remainingMs);

  async function connect() {
    try {
      // String material selects PBKDF2, matching the native shared-key provider.
      await keyProvider.setKey(mediaKey);
      mediaKey = '';
      if (stopped) return;
      await room.setE2EEEnabled(true);
      if (stopped) return;
      await room.connect(serverUrl, accessToken, {
        autoSubscribe: false,
        maxRetries: 0,
        websocketTimeout: 10_000,
        peerConnectionTimeout: 10_000,
      });
      accessToken = '';
      if (stopped) {
        disconnect();
        return;
      }
      if (room.name !== rtcRoom || room.localParticipant.identity !== participantId) {
        fail();
        return;
      }
      verified = true;
      clearTimeout(connectionTimer);
      if (!attached) onState('waiting');
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          subscribe(publication, participant);
        }
      }
    } catch {
      fail();
    }
  }

  void connect();
  return { stop };
}
