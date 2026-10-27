import { createServer } from 'node:net';

export function freePort(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No temporary port available'));
        return;
      }
      server.close(() => resolve(String(address.port)));
    });
  });
}
