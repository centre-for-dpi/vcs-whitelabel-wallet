import { requestKeyAttestation } from '../agent/keyAttestation/walletProviderClient';
import { KeyAttestationError } from '../agent/keyAttestation/requirements';

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const makeJwt = (header: object, payload: object) => `${b64url(header)}.${b64url(payload)}.sig`;

const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'abc', kid: 'k1' };
const goodHeader = { alg: 'ES256', typ: 'key-attestation+jwt' };
const goodPayload = { nonce: 'n-1', attested_keys: [jwk] };
const opts = { walletProviderUrl: 'https://wp.test/', attestedKey: jwk, nonce: 'n-1', keyStorage: 'iso_18045_basic' };

const okResponse = (jwt: string) => ({ ok: true, status: 200, json: async () => ({ key_attestation: jwt }) });

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

const expectCode = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(KeyAttestationError);
  await expect(p).rejects.toMatchObject({ code });
};

describe('requestKeyAttestation', () => {
  test('POSTs keys, nonce and key_storage to /key-attestation and returns the jwt', async () => {
    const jwt = makeJwt(goodHeader, goodPayload);
    const fetchMock = jest.fn().mockResolvedValue(okResponse(jwt));
    global.fetch = fetchMock as any;
    const result = await requestKeyAttestation(opts);
    expect(fetchMock.mock.calls[0][0]).toBe('https://wp.test/key-attestation');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      attested_keys: [jwk],
      nonce: 'n-1',
      key_storage: ['iso_18045_basic'],
    });
    expect(result).toBe(jwt);
  });

  test('rejects attestation with a different nonce', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse(makeJwt(goodHeader, { ...goodPayload, nonce: 'other' }))) as any;
    await expectCode(requestKeyAttestation(opts), 'invalid_attestation');
  });

  test('rejects attestation attesting a different key', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(okResponse(makeJwt(goodHeader, { ...goodPayload, attested_keys: [{ ...jwk, x: 'zzz' }] }))) as any;
    await expectCode(requestKeyAttestation(opts), 'invalid_attestation');
  });

  test('rejects wrong typ header', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse(makeJwt({ alg: 'ES256', typ: 'JWT' }, goodPayload))) as any;
    await expectCode(requestKeyAttestation(opts), 'invalid_attestation');
  });

  test('maps 500 / html body to provider_error with status in message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('not json');
      },
      text: async () => '<html>boom</html>',
    }) as any;
    const p = requestKeyAttestation(opts);
    await expectCode(p, 'provider_error');
    await expect(p).rejects.toThrow('500');
  });

  test('aborts after timeoutMs', async () => {
    global.fetch = jest.fn(
      (_url: string, init: any) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            rej(e);
          });
        })
    ) as any;
    await expectCode(requestKeyAttestation({ ...opts, timeoutMs: 10 }), 'provider_error');
  });
});
