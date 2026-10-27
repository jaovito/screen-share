import { z } from 'zod';

const widths: Record<number, number> = {
  480: 854,
  720: 1280,
  1080: 1920,
  1440: 2560,
};
export const videoProfileSchema = z
  .object({
    id: z.string().regex(/^(480|720|1080|1440)p(30|60)$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.union([z.literal(30), z.literal(60)]),
  })
  .refine(
    (profile) =>
      widths[profile.height] === profile.width && profile.id === `${profile.height}p${profile.fps}`,
    { message: 'Perfil fora do catálogo' },
  );
export const profilesResponseSchema = z.object({
  profiles: z
    .array(videoProfileSchema)
    .length(8)
    .refine((profiles) => new Set(profiles.map((profile) => profile.id)).size === 8, {
      message: 'Perfis duplicados',
    }),
});

export type VideoProfileDto = z.infer<typeof videoProfileSchema>;

export const appInfoSchema = z.object({
  version: z.string().min(1),
  platform: z.string().min(1),
  mediaStatus: z.enum(['not_implemented', 'unsupported_platform']),
});

export type AppInfoDto = z.infer<typeof appInfoSchema>;

export {
  type MediaProofGrant,
  mediaProofGrantSchema,
  mediaProofServerSchema,
} from './media-proof';
