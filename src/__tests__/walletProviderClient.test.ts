import { requestKeyAttestation } from '../agent/keyAttestation/walletProviderClient';
import { KeyAttestationError } from '../agent/keyAttestation/requirements';

const b64url = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const makeJwt = (header: object, payload: object) => `${b64url(header)}.${b64url(payload)}.sig`;

const jwk = { kty: 'OKP', crv: 'Ed25519', x: 'abc', kid: 'k1' };
const goodHeader = { alg: 'ES256', typ: 'key-attestation+jwt' };
const goodPayload = { nonce: 'n-1', attested_keys: [jwk], key_storage: ['iso_18045_basic'] };
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

  const { kid: _k, ...noKid } = jwk;
  const rejects = (payload: object, o: any = opts) => {
    global.fetch = jest.fn().mockResolvedValue(okResponse(makeJwt(goodHeader, payload))) as any;
    return expectCode(requestKeyAttestation(o), 'invalid_attestation');
  };
  const ec = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'yyy', kid: 'k1' };
  test('rejects provider that drops kid', () => rejects({ ...goodPayload, attested_keys: [noKid] }));
  test('rejects provider that changes kid', () => rejects({ ...goodPayload, attested_keys: [{ ...jwk, kid: 'other' }] }));
  test('rejects provider that changes crv', () => rejects({ ...goodPayload, attested_keys: [{ ...jwk, crv: 'Ed448' }] }));
  test('rejects provider that changes kty', () => rejects({ ...goodPayload, attested_keys: [{ ...jwk, kty: 'EC' }] }));
  test('rejects provider that changes y', () =>
    rejects({ ...goodPayload, attested_keys: [{ ...ec, y: 'zzz' }] }, { ...opts, attestedKey: ec }));
  test('rejects provider that drops y', () => {
    const { y: _y, ...noY } = ec;
    return rejects({ ...goodPayload, attested_keys: [noY] }, { ...opts, attestedKey: ec });
  });
  test('accepts a matching EC key', async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse(makeJwt(goodHeader, { ...goodPayload, attested_keys: [ec] }))) as any;
    await expect(requestKeyAttestation({ ...opts, attestedKey: ec })).resolves.toBeTruthy();
  });
  test('rejects when the sent key has no x (no silent pass)', () => {
    const { x: _x, ...noX } = jwk;
    return rejects({ ...goodPayload, attested_keys: [noX] }, { ...opts, attestedKey: noX });
  });
  test('rejects over-claiming key_storage', () => rejects({ ...goodPayload, key_storage: ['iso_18045_high'] }));
  test('rejects key_storage with extra entries', () =>
    rejects({ ...goodPayload, key_storage: ['iso_18045_basic', 'iso_18045_high'] }));
  test('rejects attestation without key_storage', () => {
    const { key_storage: _ks, ...p } = goodPayload;
    return rejects(p);
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

  test('rejects an empty nonce without calling fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    await expectCode(requestKeyAttestation({ ...opts, nonce: '' }), 'nonce_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects attestation whose payload nonce is empty', () =>
    rejects({ ...goodPayload, nonce: '' }, { ...opts, nonce: 'n-1' }));
});
