import { spawnSync } from 'node:child_process';
import { randomBytes, X509Certificate } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { root } from './lib';

const allowed = new Set([
  '--site-host',
  '--rtc-host',
  '--turn-host',
  '--web-ip',
  '--rtc-ip',
  '--acme-email',
  '--turn-cert',
  '--turn-key',
  '--validate-only',
]);
const options = new Map<string, string>();
for (let index = 2; index < process.argv.length; index++) {
  const flag = process.argv[index];
  if (!flag || !allowed.has(flag) || options.has(flag))
    throw new Error('Unknown or duplicate production option');
  if (flag === '--validate-only') {
    options.set(flag, 'true');
    continue;
  }
  const value = process.argv[++index];
  if (!value || value.startsWith('--')) throw new Error('Every production option requires a value');
  options.set(flag, value);
}

function required(flag: string) {
  const value = options.get(flag);
  if (!value) throw new Error(`Missing required production option ${flag}`);
  return value;
}

function hostname(flag: string) {
  const value = required(flag).toLowerCase();
  if (
    value.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) ||
    /(?:^|\.)(?:localhost|local|test|invalid|example)$/.test(value) ||
    /(?:^|\.)example\.(?:com|net|org)$/.test(value)
  ) {
    throw new Error('Production hostnames must be explicit public DNS names');
  }
  return value;
}

function publicAddress(flag: string) {
  const value = required(flag);
  const [first, second, third] = value.split('.').map(Number);
  if (
    isIP(value) !== 4 ||
    first === undefined ||
    second === undefined ||
    third === undefined ||
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 168 || second === 0)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
  ) {
    throw new Error(
      'Production requires two distinct routable public IPv4 addresses assigned to the server',
    );
  }
  return value;
}

async function boundedFile(path: string) {
  const file = await open(resolve(path), 'r');
  try {
    if (!(await file.stat()).isFile())
      throw new Error('TURN certificate inputs must be regular files');
    const buffer = Buffer.alloc(65_537);
    let count = 0;
    while (count < buffer.length) {
      const result = await file.read(buffer, count, buffer.length - count, count);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    if (count === 0 || count > 65_536)
      throw new Error('TURN certificate inputs exceed the allowed size');
    return buffer.subarray(0, count).toString('utf8');
  } finally {
    await file.close();
  }
}

const site = hostname('--site-host');
const rtc = hostname('--rtc-host');
const turn = hostname('--turn-host');
const webIp = publicAddress('--web-ip');
const rtcIp = publicAddress('--rtc-ip');
if (new Set([site, rtc, turn]).size !== 3 || webIp === rtcIp)
  throw new Error('Web/RTC addresses and site/RTC/TURN names must be distinct');
const email = required('--acme-email');
if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(email) || email.length > 254)
  throw new Error('A valid ACME contact email is required');
const certificate = await boundedFile(required('--turn-cert'));
const privateKey = await boundedFile(required('--turn-key'));
const certificateCheck = await mkdtemp(resolve(tmpdir(), 'screen-share-turn-check-'));
try {
  const leaf = new X509Certificate(certificate);
  if (leaf.ca || leaf.issuer === leaf.subject || !leaf.subjectAltName || !leaf.checkHost(turn))
    throw new Error('A CA-issued leaf is required');
  const certPath = resolve(certificateCheck, 'fullchain.pem');
  const keyPath = resolve(certificateCheck, 'private.pem');
  await writeFile(certPath, certificate, { mode: 0o600, flag: 'wx' });
  await writeFile(keyPath, privateKey, { mode: 0o600, flag: 'wx' });
  const openssl = (args: string[], input?: Buffer) => {
    const result = spawnSync('openssl', args, {
      timeout: 5000,
      maxBuffer: 65_536,
      ...(input ? { input } : {}),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    if (result.status !== 0) throw new Error('OpenSSL validation failed');
    return result.stdout;
  };
  // Use the platform's established PKIX verifier/trust store, never a custom chain verifier.
  openssl([
    'verify',
    '-purpose',
    'sslserver',
    ...(process.env.SSL_CERT_FILE ? ['-CAfile', resolve(process.env.SSL_CERT_FILE)] : []),
    '-untrusted',
    certPath,
    certPath,
  ]);
  const publicPem = openssl(['x509', '-in', certPath, '-pubkey', '-noout']);
  const certificatePublic = openssl(['pkey', '-pubin', '-outform', 'DER'], publicPem);
  const privatePublic = openssl(['pkey', '-in', keyPath, '-pubout', '-outform', 'DER']);
  if (certificatePublic.length === 0 || !certificatePublic.equals(privatePublic))
    throw new Error('TURN key mismatch');
} catch {
  throw new Error(
    'TURN needs a current hostname-matching certificate trusted by OpenSSL and its matching unencrypted PEM private key; OpenSSL must be installed',
  );
} finally {
  await rm(certificateCheck, { recursive: true, force: true });
}
if (options.has('--validate-only')) {
  console.log(
    'Production inputs passed structural checks. Public browser/SDK trust, DNS, assigned addresses and connectivity still require operator validation. No files or services changed.',
  );
} else {
  if (process.platform === 'win32')
    throw new Error(
      'Generate production secrets on Linux/macOS with private Unix file permissions',
    );
  const output = resolve(root, 'infra/production/.generated');
  await mkdir(output, { mode: 0o700 });
  try {
    const password = randomBytes(32).toString('hex');
    const key = randomBytes(18).toString('hex');
    const secret = randomBytes(48).toString('hex');
    const env = {
      SITE_HOST: site,
      RTC_HOST: rtc,
      TURN_HOST: turn,
      WEB_PUBLIC_IP: webIp,
      RTC_PUBLIC_IP: rtcIp,
      ACME_EMAIL: email,
      POSTGRES_PASSWORD: password,
      AUTH_SECRET: randomBytes(48).toString('hex'),
      LIVEKIT_API_KEY: key,
      LIVEKIT_API_SECRET: secret,
    };
    await writeFile(
      resolve(output, 'production.env'),
      [...Object.entries(env).map(([name, value]) => `${name}=${JSON.stringify(value)}`), ''].join(
        '\n',
      ),
      { mode: 0o600, flag: 'wx' },
    );
    const livekit = [
      'port: 7880',
      'bind_addresses: ["0.0.0.0"]',
      'rtc:',
      '  tcp_port: 7881',
      '  udp_port: 7882',
      '  use_external_ip: false',
      `  node_ip: ${JSON.stringify(rtcIp)}`,
      'keys:',
      `  ${JSON.stringify(key)}: ${JSON.stringify(secret)}`,
      'turn:',
      '  enabled: true',
      `  domain: ${JSON.stringify(turn)}`,
      '  tls_port: 443',
      '  udp_port: 3478',
      '  cert_file: /etc/turn/fullchain.pem',
      '  key_file: /etc/turn/private-key.pem',
      'logging:',
      '  level: error',
      '',
    ].join('\n');
    await writeFile(resolve(output, 'livekit.yaml'), livekit, { mode: 0o600, flag: 'wx' });
    await writeFile(resolve(output, 'turn-fullchain.pem'), certificate, {
      mode: 0o600,
      flag: 'wx',
    });
    await writeFile(resolve(output, 'turn-private-key.pem'), privateKey, {
      mode: 0o600,
      flag: 'wx',
    });
    console.log(
      'Prepared exclusive private production files. Existing installations were not overwritten. No services were started.',
    );
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}
