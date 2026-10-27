import type {
  AudioSourcesResponse,
  NativeSharingStatus,
  ProductMediaGrant,
} from '@screen-share/contracts';
import type { ReceiverMetrics } from '@screen-share/diagnostics';

export type { NativeSharingStatus } from '@screen-share/contracts';

export type PublisherAdapter = {
  managesAuthorization?: true;
  start(request: {
    roomId?: string;
    grant: ProductMediaGrant;
    profileId: string;
    bitrateBps: number;
    mediaKey: string;
    audioMode?: 'off' | 'system' | 'process';
    audioProcessId?: number;
    audioProcessCreatedAt?: string;
    qualityMode?: 'motion' | 'text';
  }): Promise<NativeSharingStatus>;
  renew(
    grant: ProductMediaGrant,
    profileId?: string,
    bitrateBps?: number,
  ): Promise<NativeSharingStatus>;
  stop(): Promise<NativeSharingStatus>;
  pause(): Promise<NativeSharingStatus>;
  resume(): Promise<NativeSharingStatus>;
  status(): Promise<NativeSharingStatus>;
  audioSources?(): Promise<AudioSourcesResponse>;
  changeProfile?(profileId: string, bitrateBps: number): Promise<NativeSharingStatus>;
};

export type ReceiverAdapter = (input: {
  grant: ProductMediaGrant;
  mediaKey: string;
  video: HTMLVideoElement;
  audio?: HTMLAudioElement;
  onState(state: string): void;
  onMetrics?(metrics: ReceiverMetrics): void;
}) => Promise<{ stop(): void }>;

export type ProductControlTransport = (request: {
  method: string;
  path: string;
  body?: object;
  signal: AbortSignal;
}) => Promise<{ status: number; body: unknown }>;

export type UpdateInfo = {
  state: 'notConfigured' | 'upToDate' | 'available';
  version: string | null;
};

export type UpdaterAdapter = {
  check(): Promise<UpdateInfo>;
  install(): Promise<void>;
};

export type ProductWorkspaceProps = {
  apiUrl: string;
  updater?: UpdaterAdapter | undefined;
  control?: ProductControlTransport | undefined;
  publisher?: PublisherAdapter | undefined;
  receiver?: ReceiverAdapter | undefined;
};
