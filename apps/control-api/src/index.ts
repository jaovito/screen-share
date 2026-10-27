import { runCommand } from '@runtime/command';
import { log } from './log';

void runCommand(process.argv[2]).catch((error: unknown) => {
  log('command_failed', {
    reason:
      error instanceof Error && error.message.startsWith('Invalid configuration:')
        ? error.message
        : 'Check configuration and installation',
  });
  process.exitCode = 1;
});
