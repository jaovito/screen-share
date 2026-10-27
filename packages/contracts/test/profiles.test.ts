import { describe, expect, it } from 'bun:test';
import { videoProfiles } from '../../../apps/control-api/src/modules/profiles/domain/profiles';
import { profilesResponseSchema, videoProfileSchema } from '../src/index';

describe('product catalog', () => {
  it('rejects inconsistent dimensions and duplicate catalog entries', () => {
    expect(
      videoProfileSchema.safeParse({
        id: '1080p60',
        width: 1280,
        height: 1080,
        fps: 60,
      }).success,
    ).toBe(false);
    expect(
      profilesResponseSchema.safeParse({
        profiles: Array(8).fill({
          id: '1080p60',
          width: 1920,
          height: 1080,
          fps: 60,
        }),
      }).success,
    ).toBe(false);
  });
  it('has eight unique combinations, correct dimensions, and discrete FPS', () => {
    const profiles = profilesResponseSchema.parse({
      profiles: videoProfiles,
    }).profiles;

    expect(new Set(profiles.map((p) => p.id)).size).toBe(8);
    expect(profiles.filter((p) => p.height === 1440).map((p) => p.width)).toEqual([2560, 2560]);

    for (const height of [480, 720, 1080, 1440])
      expect(profiles.filter((p) => p.height === height).map((p) => p.fps)).toEqual([30, 60]);

    expect(
      videoProfileSchema.safeParse({
        id: '1080p45',
        width: 1920,
        height: 1080,
        fps: 45,
      }).success,
    ).toBe(false);
  });
});
