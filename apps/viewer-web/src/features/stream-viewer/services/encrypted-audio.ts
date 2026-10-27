import { type RemoteTrackPublication, Track } from 'livekit-client';

type Publication = Pick<
  RemoteTrackPublication,
  'trackSid' | 'kind' | 'source' | 'isEncrypted' | 'setSubscribed'
>;
type AudioTrack = {
  kind: Track.Kind;
  attach(element: HTMLMediaElement): unknown;
  detach(element: HTMLMediaElement): unknown;
  stop(): void;
};
type Participant = { identity: string };

/** One explicitly rendered audio sink, never microphone acquisition or plaintext fallback. */
export function createEncryptedAudio(
  element: HTMLAudioElement | undefined,
  publisherId: string,
  enabled: boolean,
) {
  let sid: string | undefined;
  let attached: AudioTrack | undefined;

  function accepts(publication: Publication, participant: Participant) {
    return (
      enabled &&
      element !== undefined &&
      participant.identity === publisherId &&
      publication.kind === Track.Kind.Audio &&
      publication.source === Track.Source.ScreenShareAudio &&
      publication.isEncrypted &&
      (sid === undefined || sid === publication.trackSid)
    );
  }

  function subscribe(publication: Publication, participant: Participant) {
    if (!accepts(publication, participant)) return false;
    sid = publication.trackSid;
    publication.setSubscribed(true);
    return true;
  }

  function attach(track: AudioTrack, publication: Publication, participant: Participant) {
    if (
      !element ||
      !accepts(publication, participant) ||
      sid !== publication.trackSid ||
      attached ||
      track.kind !== Track.Kind.Audio
    )
      return false;
    attached = track;
    track.attach(element);
    return true;
  }

  function stop(publicationSid?: string) {
    if (publicationSid !== undefined && sid !== publicationSid) return;
    try {
      if (element) attached?.detach(element);
    } catch {
      /* Release independent resources. */
    }
    try {
      attached?.stop();
    } catch {
      /* Do not keep a detached audio stream alive. */
    }
    try {
      if (element) element.srcObject = null;
    } catch {
      /* Continue cleanup on a detached DOM element. */
    }
    attached = undefined;
    sid = undefined;
  }

  return { accepts, subscribe, attach, stop };
}
