import { expect, it, mock } from 'bun:test';
import { Track } from 'livekit-client';
import { createEncryptedAudio } from '../src/encrypted-audio';

function publication(trackSid = 'audio') {
  return {
    trackSid,
    kind: Track.Kind.Audio,
    source: Track.Source.ScreenShareAudio,
    isEncrypted: true,
    setSubscribed: mock((_value: boolean) => {}),
  };
}

function track() {
  return {
    kind: Track.Kind.Audio,
    attach: mock((element?: HTMLMediaElement) => element ?? document.createElement('audio')),
    detach: mock((element?: HTMLMediaElement) => (element ? [element] : [])),
    stop: mock(() => {}),
  };
}

it('requires an explicitly rendered sink and encrypted system-audio from the designated publisher', () => {
  const element = document.createElement('audio');
  const sink = createEncryptedAudio(element, 'publisher', true);
  const pub = publication();
  expect(
    createEncryptedAudio(undefined, 'publisher', true).subscribe(pub, { identity: 'publisher' }),
  ).toBe(false);
  expect(
    createEncryptedAudio(element, 'publisher', false).subscribe(pub, { identity: 'publisher' }),
  ).toBe(false);
  for (const invalid of [
    { ...pub, isEncrypted: false },
    { ...pub, source: Track.Source.Microphone },
    { ...pub, kind: Track.Kind.Video },
  ]) {
    expect(sink.subscribe(invalid, { identity: 'publisher' })).toBe(false);
  }
  expect(sink.subscribe(pub, { identity: 'another' })).toBe(false);
  expect(sink.attach(track(), pub, { identity: 'publisher' })).toBe(false);
  expect(sink.subscribe(pub, { identity: 'publisher' })).toBe(true);
  const audio = track();
  expect(sink.attach(audio, pub, { identity: 'publisher' })).toBe(true);
  expect(audio.attach).toHaveBeenCalledWith(element);
  expect(sink.subscribe(publication('second'), { identity: 'publisher' })).toBe(false);
  expect(sink.attach(track(), pub, { identity: 'publisher' })).toBe(false);
  sink.stop('old-unknown-track');
  expect(audio.stop).not.toHaveBeenCalled();
  sink.stop('audio');
  expect(audio.detach).toHaveBeenCalledWith(element);
  expect(audio.stop).toHaveBeenCalledTimes(1);
  expect(element.srcObject).toBeNull();
  expect(sink.subscribe(publication('renewed'), { identity: 'publisher' })).toBe(true);
});

it('releases every audio resource after independent SDK cleanup exceptions', () => {
  const element = document.createElement('audio');
  const sink = createEncryptedAudio(element, 'publisher', true);
  const pub = publication();
  const audio = track();
  sink.subscribe(pub, { identity: 'publisher' });
  sink.attach(audio, pub, { identity: 'publisher' });
  audio.detach.mockImplementation(() => {
    throw new Error('private audio error');
  });
  audio.stop.mockImplementation(() => {
    throw new Error('private cleanup error');
  });
  sink.stop();
  sink.stop();
  expect(audio.stop).toHaveBeenCalledTimes(1);
  expect(element.srcObject).toBeNull();
});
