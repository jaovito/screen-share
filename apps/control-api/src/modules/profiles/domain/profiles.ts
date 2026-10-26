export interface VideoProfile {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly fps: 30 | 60;
}

const resolutions = [
  [480, 854],
  [720, 1280],
  [1080, 1920],
  [1440, 2560],
] as const;
export const videoProfiles: readonly VideoProfile[] = Object.freeze(
  resolutions.flatMap(([height, width]) =>
    ([30, 60] as const).map((fps) => Object.freeze({ id: `${height}p${fps}`, width, height, fps })),
  ),
);
