import { z } from 'zod';

/** Local native metadata only: never include these values in control API requests. */
export const audioSourceSchema = z.strictObject({
  processId: z.number().int().min(1).max(0xffff_ffff),
  label: z.string().min(1).max(256),
  creationTime: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .refine((value) => BigInt(value) <= 0xffff_ffff_ffff_ffffn),
});
export const audioSourcesResponseSchema = z
  .strictObject({
    state: z.enum(['ready', 'unsupported_platform', 'unavailable']),
    sources: z.array(audioSourceSchema).max(128),
  })
  .refine(
    (response) =>
      (response.state === 'ready' || response.sources.length === 0) &&
      new Set(response.sources.map((source) => source.processId)).size === response.sources.length,
  );

export type AudioSource = z.infer<typeof audioSourceSchema>;
export type AudioSourcesResponse = z.infer<typeof audioSourcesResponseSchema>;
