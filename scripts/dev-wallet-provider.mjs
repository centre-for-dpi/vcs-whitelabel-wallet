// DEV ONLY. Minimal Wallet Provider that signs OID4VCI key attestations.
// Not a production Wallet Provider: no device integrity checks, ephemeral key, jwk header instead of x5c.
// Usage: node scripts/dev-wallet-provider.mjs [--port 8787]
import http from 'node:http';
import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const portArg = process.argv.indexOf('--port');
const port = portArg > -1 ? Number(process.argv[portArg + 1]) : 8787;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const encodeJson = (obj) => b64url(Buffer.from(JSON.stringify(obj)));

const keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const { kty, crv, x, y } = await subtle.exportKey('jwk', keyPair.publicKey);
const publicJwk = { kty, crv, x, y };
console.log('Wallet Provider public JWK:');
console.log(JSON.stringify(publicJwk));

async function signAttestation({ attested_keys, key_storage, nonce }) {
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'key-attestation+jwt', jwk: publicJwk };
  const payload = { iss: 'cdpi-dev-wallet-provider', iat, exp: iat + 300, attested_keys, key_storage, nonce };
  const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
  const sig = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keyPair.privateKey,
    Buffer.from(signingInput)
  );
  return `${signingInput}.${b64url(sig)}`;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok' });
  if (req.method === 'POST' && req.url === '/key-attestation') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'invalid_request' });
      }
      const { attested_keys, nonce } = body ?? {};
      const key_storage = body?.key_storage ?? ['iso_18045_basic'];
      if (!Array.isArray(attested_keys) || attested_keys.length === 0 || typeof nonce !== 'string' || !nonce) {
        return send(res, 400, { error: 'invalid_request' });
      }
      if (!Array.isArray(key_storage) || key_storage.length !== 1 || key_storage[0] !== 'iso_18045_basic') {
        return send(res, 400, {
          error: 'invalid_request',
          error_description: 'key_storage must be exactly ["iso_18045_basic"]',
        });
      }
      try {
        send(res, 200, { key_attestation: await signAttestation({ attested_keys, key_storage, nonce }) });
      } catch (e) {
        console.error(e);
        send(res, 500, { error: 'server_error' });
      }
    });
    return;
  }
  send(res, 404, { error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log('*** DEV ONLY: NOT a production Wallet Provider. Unauthenticated and LAN-exposed (0.0.0.0): run on trusted networks only. ***');
  console.log(`Dev Wallet Provider listening on http://0.0.0.0:${port}`);
});
