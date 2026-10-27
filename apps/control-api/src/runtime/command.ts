import { readConfig } from '../config';
import { migrateDatabase } from './migrate';
import { startServer } from './server';
import { checkControlPlane } from './smoke';

export async function runCommand(command = 'serve') {
  if (!['serve', 'migrate', 'smoke', 'ready'].includes(command))
    throw new Error('Unknown control API command');

  const config = readConfig();
  switch (command) {
    case 'serve':
      startServer(config);
      break;
    case 'migrate':
      await migrateDatabase(config);
      break;
    case 'smoke':
      await checkControlPlane(config);
      break;
    case 'ready': {
      const response = await fetch(`http://127.0.0.1:${config.PORT}/readyz`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error('API is not ready');
    }
  }
}
