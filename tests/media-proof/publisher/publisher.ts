import { type MediaProofGrant, mediaProofGrantSchema } from '@screen-share/contracts';
import { ExternalE2EEKeyProvider, LocalVideoTrack, Room, setLogLevel, Track } from 'livekit-client';
import { z } from 'zod';

declare global {
  interface Window {
    mediaTest: {
      start: (grant: MediaProofGrant) => Promise<string>;
      stop: () => Promise<void>;
      exportSyntheticPackets: () => Promise<void>;
    };
  }
}

let room: Room | undefined;
let worker: Worker | undefined;
let track: LocalVideoTrack | undefined;
let animation: ReturnType<typeof setInterval> | undefined;

async function stop() {
  clearInterval(animation);
  track?.stop();
  await room?.disconnect();
  worker?.terminate();
}

window.mediaTest = {
  async start(input) {
    const grant = mediaProofGrantSchema.parse(input);
    if (grant.role !== 'publisher') throw new Error('Synthetic publisher grant required.');
    const canvas = document.querySelector('canvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) throw new Error('Synthetic canvas unavailable.');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const key = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    const provider = new ExternalE2EEKeyProvider();
    worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' });
    room = new Room({ encryption: { keyProvider: provider, worker } });

    let stage = 'key setup';
    try {
      setLogLevel('silent');
      await provider.setKey(key);
      stage = 'encryption setup';
      await room.setE2EEEnabled(true);
      stage = 'RTC connection';
      await room.connect(grant.serverUrl, grant.accessToken, {
        autoSubscribe: false,
        maxRetries: 0,
      });
      stage = 'synthetic track creation';
      let counter = 0;
      const draw = () => {
        context.fillStyle = counter++ % 2 ? '#2847df' : '#d74351';
        context.fillRect(0, 0, 320, 180);
        context.fillStyle = '#ffffff';
        context.fillRect((counter * 13) % 280, 50, 40, 40);
      };
      draw();
      animation = setInterval(draw, 200);
      const videoTrack = canvas.captureStream(5).getVideoTracks()[0];
      if (!videoTrack) throw new Error('Synthetic video track unavailable.');
      track = new LocalVideoTrack(videoTrack);
      stage = 'track publication';
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.ScreenShare,
        videoCodec: 'h264',
        simulcast: false,
        videoEncoding: { maxBitrate: 200_000, maxFramerate: 5 },
      });
      stage = 'H264 codec verification';
      let h264 = false;
      const outbound = z.object({
        type: z.literal('outbound-rtp'),
        kind: z.literal('video'),
        codecId: z.string(),
        framesEncoded: z.number().positive(),
      });
      const codec = z.object({ mimeType: z.string() });
      for (let attempt = 0; attempt < 20 && !h264; attempt++) {
        const report = await track.getRTCStatsReport();
        report?.forEach((value: unknown) => {
          const parsed = outbound.safeParse(value);
          if (!parsed.success) return;
          const negotiated = codec.safeParse(report.get(parsed.data.codecId));
          h264 ||= negotiated.success && negotiated.data.mimeType.toLowerCase() === 'video/h264';
        });
        if (!h264) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!h264) throw new Error('Required H264 codec was not used.');
      return key;
    } catch {
      await stop();
      throw new Error(`Synthetic publication failed during ${stage}.`);
    }
  },
  async exportSyntheticPackets() {
    if (!('VideoEncoder' in globalThis)) throw new Error('WebCodecs unavailable.');
    const canvas = document.createElement('canvas');
    canvas.width = 854;
    canvas.height = 480;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Synthetic canvas unavailable.');
    const parts: BlobPart[] = [];
    let total = 0;
    let failure = false;
    const encoder = new VideoEncoder({
      output(chunk) {
        total += chunk.byteLength;
        if (total > 8 * 1024 * 1024) {
          failure = true;
          return;
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const header = new ArrayBuffer(4);
        new DataView(header).setUint32(0, data.length, true);
        parts.push(header, data);
      },
      error() {
        failure = true;
      },
    });
    try {
      encoder.configure({
        codec: 'avc1.42001e',
        width: 854,
        height: 480,
        framerate: 5,
        bitrate: 200_000,
        latencyMode: 'realtime',
        avc: { format: 'annexb' },
      });
      for (let i = 0; i < 20; i++) {
        context.fillStyle = i % 2 ? '#2b47de' : '#df4860';
        context.fillRect(0, 0, 854, 480);
        context.fillStyle = '#ffffff';
        context.fillRect((i * 25) % 800, 100, 50, 50);
        const frame = new VideoFrame(canvas, { timestamp: i * 200_000 });
        try {
          encoder.encode(frame, { keyFrame: i % 5 === 0 });
        } finally {
          frame.close();
        }
      }
      await encoder.flush();
      if (failure || parts.length !== 40) throw new Error('Synthetic encoder failed.');
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'synthetic-access-units.bin';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      encoder.close();
    }
  },
  stop,
};
