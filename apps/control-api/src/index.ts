import { readConfig } from './config.js';
import { log } from './log.js';
import { startServer } from './runtime/server.js';

try {
  startServer(readConfig());
} catch (error) {
  log('startup_failed', {
    reason:
      error instanceof Error && error.message.startsWith('Configuração inválida:')
        ? error.message
        : 'Verifique configuração e instalação',
  });
  process.exitCode = 1;
}
