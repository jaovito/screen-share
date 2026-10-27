import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type MediaProofGrant, mediaProofGrantSchema } from '@screen-share/contracts';

/** Creates one new private directory. Existing paths are never overwritten or cleaned up. */
export async function writeProofGrants(directory: string, grants: readonly MediaProofGrant[]) {
  const validated = grants.map((grant) => mediaProofGrantSchema.parse(grant));
  if (
    !validated.length ||
    new Set(validated.map((grant) => grant.participantId)).size !== validated.length
  )
    throw new Error('Unique participant grants are required.');

  await mkdir(directory, { mode: 0o700 });
  const created: string[] = [];

  try {
    for (const grant of validated) {
      const path = join(directory, `${grant.participantId}.json`);
      await writeFile(path, `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      created.push(path);
    }
  } catch {
    for (const path of created) await unlink(path);
    await rmdir(directory);
    throw new Error('Unable to write the private grant directory.');
  }
}
