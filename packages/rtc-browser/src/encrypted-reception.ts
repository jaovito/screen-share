import { mediaProofGrantSchema, productMediaGrantSchema } from '@screen-share/contracts';
import {
  type ReceiverBaseline,
  type ReceiverMetrics,
  receiverSample,
} from '@screen-share/diagnostics/receiver';
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
import { createEncryptedAudio } from './encrypted-audio';

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

export type ReceptionInput = {
  grant: unknown;
  mediaKey: string;
  video: HTMLVideoElement;
  audio?: HTMLAudioElement;
  onState: (state: ReceptionState) => void;
  onMetrics?: (metrics: ReceiverMetrics) => void;
};

/** Explicit receive-only encrypted playback; never acquires local media. */
export function receiveEncryptedSession({
  grant: rawGrant,
  mediaKey,
  video,
  audio: audioElement,
  onState,
  onMetrics,
}: ReceptionInput) {
  const parsed = mediaProofGrantSchema.or(productMediaGrantSchema).safeParse(rawGrant);
  const noop = { stop() {} };

  if (!parsed.success || parsed.data.role !== 'viewer') {
    onState('invalidGrant');
    return noop;
  }

  const grant = parsed.data;
  const productSession = grant.rtcRoom.startsWith('ss-');
  const audio = createEncryptedAudio(audioElement, grant.publisherId, productSession);
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
  let metricsTimer: ReturnType<typeof setInterval> | undefined;
  let statsGeneration = 0;
  let baseline: ReceiverBaseline | undefined;

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

  function releaseTrack() {
    audio.stop();
    statsGeneration++;
    clearInterval(metricsTimer);
    baseline = undefined;
    bestEffort(() => attached?.detach(video));
    bestEffort(() => attached?.stop());
    attached = undefined;
    selectedSid = undefined;
    bestEffort(() => {
      video.srcObject = null;
    });
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    mediaKey = '';
    accessToken = '';
    clearTimeout(connectionTimer);
    clearTimeout(expiryTimer);
    clearInterval(metricsTimer);
    baseline = undefined;
    bestEffort(() => room.removeAllListeners());
    releaseTrack();
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
    if (publication.kind === Track.Kind.Audio) {
      try {
        if (!audio.subscribe(publication, participant)) fail();
      } catch {
        fail();
      }
      return;
    }
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
    if (publication.kind === Track.Kind.Audio) {
      try {
        if (!verified || !audio.attach(track, publication, participant)) {
          bestEffort(() => track.stop());
          fail();
        }
      } catch {
        fail();
      }
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
      if (onMetrics) {
        let statsPending = false;
        const sampleGeneration = ++statsGeneration;
        metricsTimer = setInterval(() => {
          if (stopped || statsPending) return;
          statsPending = true;
          void Promise.resolve()
            .then(() => track.getRTCStatsReport())
            .then((report) => {
              if (stopped || sampleGeneration !== statsGeneration || !report) return;
              const previous = baseline;
              const sample = receiverSample(report.values(), previous);
              const next = sample.baseline;
              baseline = next;
              const reset =
                !sample.metrics ||
                (previous &&
                  next &&
                  (
                    ['frames', 'bytes', 'dropped', 'decodeSeconds', 'packets', 'lost'] as const
                  ).some((key) => {
                    const before = previous[key];
                    const after = next[key];
                    return before !== null && after !== null && after < before;
                  }));
              onMetrics(
                reset || !sample.metrics
                  ? {
                      intervalMs: 0,
                      decodedFps: null,
                      inboundBitrateBps: null,
                      droppedFrames: null,
                      averageDecodeMs: null,
                      packetLossRatio: null,
                      jitterMs: null,
                      transportRttMs: null,
                      width: null,
                      height: null,
                    }
                  : sample.metrics,
              );
            })
            .catch(() => {
              baseline = undefined;
            })
            .finally(() => {
              statsPending = false;
            });
        }, 1000);
      }
      onState('subscribed');
    } catch {
      fail();
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
    if (stopped) return;
    if (!productSession || participant?.identity !== publisherId) {
      fail();
      return;
    }
    if (publication?.kind === Track.Kind.Audio) {
      audio.stop(publication.trackSid);
      return;
    }
    if (selectedSid !== publication?.trackSid) return;
    releaseTrack();
    onState('waiting');
  });
  room.on(RoomEvent.TrackSubscriptionFailed, () => fail());
  room.on(RoomEvent.EncryptionError, () => fail());
  room.on(RoomEvent.Reconnecting, () => fail());
  room.on(RoomEvent.SignalReconnecting, () => fail());
  room.on(RoomEvent.Disconnected, () => fail());
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (participant.identity !== publisherId || stopped) return;
    if (!productSession) {
      fail();
      return;
    }
    releaseTrack();
    onState('waiting');
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
