/** Canonical SDK shared-key representation. The key never enters control requests. */
export function generateMediaKey() {
  if (!globalThis.isSecureContext || !globalThis.crypto?.getRandomValues) {
    throw new Error('Secure cryptographic randomness unavailable');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  bytes.fill(0);

  return encoded;
}
