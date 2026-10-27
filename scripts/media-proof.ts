import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeProofGrants } from '../tooling/media-proof/grant-files';
import { issueProofGrants } from '../tooling/media-proof/grants';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--authorized-plan')
    throw new Error(
      'Usage: bun run media:grants --authorized-plan <plan.json> <new-private-directory>',
    );

  const planPath = args[1];
  const directory = args[2];
  if (!planPath || !directory) throw new Error('Plan and destination are required.');
  const file = await open(resolve(planPath), 'r');
  const planFile = Buffer.alloc(16_385);
  let offset = 0;
  try {
    if (!(await file.stat()).isFile())
      throw new Error('A regular authorized plan file is required.');
    while (offset < planFile.length) {
      const { bytesRead } = await file.read(planFile, offset, planFile.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
  } finally {
    await file.close();
  }
  if (offset > 16384) throw new Error('Authorized plan is too large.');

  const grants = await issueProofGrants(JSON.parse(planFile.subarray(0, offset).toString('utf8')), {
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    serverUrl: process.env.LIVEKIT_PUBLIC_URL,
  });
  await writeProofGrants(resolve(directory), grants);
  console.log('Private proof grants created. Deliver each only to its authorized participant.');
  console.log('No media key was generated or stored. This does not start capture or a session.');
}

void main().catch(() => {
  console.error(
    'Proof grant creation failed. Check the authorized plan, private destination, and server configuration. No credentials were printed.',
  );
  process.exitCode = 1;
});
