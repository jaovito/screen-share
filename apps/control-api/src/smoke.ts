import { readConfig } from './config.js';
import { log } from './log.js';
import { checkControlPlane } from './runtime/smoke.js';

async function main() {
  await checkControlPlane(readConfig());
}

main().catch(() => {
  log('smoke_failed');
  process.exitCode = 1;
});
