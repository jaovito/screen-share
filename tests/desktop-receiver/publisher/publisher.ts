import { type ProductMediaGrant, productMediaGrantSchema } from '@screen-share/contracts';
import { ExternalE2EEKeyProvider, LocalVideoTrack, Room, setLogLevel, Track } from 'livekit-client';
import { z } from 'zod';

declare global {
  interface Window {
    desktopPublisher: {
      start: (input: ProductMediaGrant) => Promise<string>;
      stop: () => Promise<void>;
    };
  }
}

let room: Room | undefined;
let worker: Worker | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let audio: AudioContext | undefined;
let videoTrack: LocalVideoTrack | undefined;
let audioTrack: MediaStreamTrack | undefined;

async function stop() {
  clearInterval(timer);
  videoTrack?.stop();
  audioTrack?.stop();
  await room?.disconnect();
  worker?.terminate();
  await audio?.close();
}

window.desktopPublisher = {
  async start(input) {
    const grant = productMediaGrantSchema.parse(input);
    if (grant.role !== 'publisher') throw new Error('Publisher authorization required');
    const canvas = document.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('Synthetic canvas unavailable');
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const provider = new ExternalE2EEKeyProvider();
    worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' });
    room = new Room({ encryption: { keyProvider: provider, worker } });
    try {
      setLogLevel('silent');
      await provider.setKey(key);
      await room.setE2EEEnabled(true);
      await room.connect(grant.serverUrl, grant.accessToken, {
        autoSubscribe: false,
        maxRetries: 0,
      });
      let frame = 0;
      const draw = () => {
        context.fillStyle = frame++ % 2 ? '#2847df' : '#d74351';
        context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#ffffff';
        context.fillRect((frame * 13) % 280, 50, 40, 40);
      };
      draw();
      timer = setInterval(draw, 200);
      const capture = canvas.captureStream(5).getVideoTracks()[0];
      if (!capture) throw new Error('Synthetic video unavailable');
      videoTrack = new LocalVideoTrack(capture);
      await room.localParticipant.publishTrack(videoTrack, {
        source: Track.Source.ScreenShare,
        videoCodec: 'h264',
        simulcast: false,
        videoEncoding: { maxBitrate: 200_000, maxFramerate: 5 },
      });
      const outbound = z.object({
        type: z.literal('outbound-rtp'),
        kind: z.literal('video'),
        codecId: z.string(),
        framesEncoded: z.number().positive(),
      });
      const codec = z.object({ mimeType: z.string() });
      let h264 = false;
      for (let attempt = 0; attempt < 30 && !h264; attempt++) {
        const report = await videoTrack.getRTCStatsReport();
        report?.forEach((value: unknown) => {
          const parsed = outbound.safeParse(value);
          if (!parsed.success) return;
          const negotiated = codec.safeParse(report.get(parsed.data.codecId));
          h264 ||= negotiated.success && negotiated.data.mimeType.toLowerCase() === 'video/h264';
        });
        if (!h264) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!h264) throw new Error('Actual synthetic sender did not negotiate H264');
      audio = new AudioContext();
      const oscillator = audio.createOscillator();
      oscillator.frequency.value = 440;
      const destination = audio.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await audio.resume();
      const samples = destination.stream.getAudioTracks()[0];
      if (!samples) throw new Error('Synthetic audio unavailable');
      audioTrack = samples;
      await room.localParticipant.publishTrack(audioTrack, {
        source: Track.Source.ScreenShareAudio,
      });
      return key;
    } catch (error) {
      await stop();
      throw error;
    }
  },
  stop,
};
