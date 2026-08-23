/**
 * Tests for the dynamic mdoc trust-anchor resolver.
 *
 * The two behaviours that matter most, per the task's testing bar:
 *   1. the callback returns the FETCHED certificate, not the old static one;
 *   2. a cache hit inside the TTL does not refetch.
 * The rest cover the failure policy (stale fallback, static fallback) and the
 * offline guarantee (no fetch on the presentation path).
 */

import {
  createTrustedCertificatesResolver,
  getAnchorsForIssuer,
  setCurrentIssuerBaseUrl,
  clearCurrentIssuerBaseUrl,
  __resetAnchorCacheForTests,
} from '../agent/mdocTrustAnchors';

const ISSUER = 'https://issuer.example.com';
const FETCHED_PEM = '-----BEGIN CERTIFICATE-----\nFETCHEDFROMISSUER\n-----END CERTIFICATE-----';
const STATIC_PEM = '-----BEGIN CERTIFICATE-----\nSTATICCOMPILEDIN\n-----END CERTIFICATE-----';

/** Minimal X509VerificationContext for the mdoc-credential case. */
const credentialContext = { verification: { type: 'credential' } };

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

describe('mdoc dynamic trust anchors', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    __resetAnchorCacheForTests();
    jest.useRealTimers();
  });

  afterEach(() => {
    global.fetch = realFetch;
    __resetAnchorCacheForTests();
  });

  it('returns the fetched certificate rather than only the static one', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM], poc: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    setCurrentIssuerBaseUrl(ISSUER);
    const resolve = createTrustedCertificatesResolver([STATIC_PEM]);
    const result = await resolve({}, credentialContext);

    expect(result).toContain(FETCHED_PEM);
    // The endpoint really was called, at the documented path.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ISSUER}/trust/mdoc-anchors`);
    // Static anchor retained so already-issued credentials keep verifying.
    expect(result).toContain(STATIC_PEM);
    // Fetched anchor takes precedence in ordering.
    expect(result?.[0]).toBe(FETCHED_PEM);
  });

  it('does not refetch on a cache hit inside the TTL', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM], poc: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await getAnchorsForIssuer(ISSUER);
    const second = await getAnchorsForIssuer(ISSUER);
    const third = await getAnchorsForIssuer(ISSUER);

    expect(first).toEqual([FETCHED_PEM]);
    expect(second).toEqual([FETCHED_PEM]);
    expect(third).toEqual([FETCHED_PEM]);
    // Three verifications, one network round-trip.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches once the TTL has elapsed, so a redeploy is picked up', async () => {
    const ROTATED_PEM = '-----BEGIN CERTIFICATE-----\nROTATEDAFTERREDEPLOY\n-----END CERTIFICATE-----';
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ anchors: [FETCHED_PEM] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ anchors: [ROTATED_PEM] }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    const before = await getAnchorsForIssuer(ISSUER);
    expect(before).toEqual([FETCHED_PEM]);

    // Advance past the 5-minute TTL.
    const realNow = Date.now;
    const t0 = realNow();
    Date.now = () => t0 + 6 * 60 * 1000;
    try {
      const after = await getAnchorsForIssuer(ISSUER);
      expect(after).toEqual([ROTATED_PEM]);
    } finally {
      Date.now = realNow;
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent misses into a single request', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM] });
    global.fetch = fetchMock as unknown as typeof fetch;

    const [a, b, c] = await Promise.all([
      getAnchorsForIssuer(ISSUER),
      getAnchorsForIssuer(ISSUER),
      getAnchorsForIssuer(ISSUER),
    ]);

    expect(a).toEqual([FETCHED_PEM]);
    expect(b).toEqual([FETCHED_PEM]);
    expect(c).toEqual([FETCHED_PEM]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to a stale cached value when a later fetch fails', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ anchors: [FETCHED_PEM] }) })
      .mockRejectedValueOnce(new Error('network down'));
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await getAnchorsForIssuer(ISSUER)).toEqual([FETCHED_PEM]);

    const realNow = Date.now;
    const t0 = realNow();
    Date.now = () => t0 + 6 * 60 * 1000; // force a refetch attempt
    try {
      // Stale, but still an anchor this issuer served — better than failing the offer.
      expect(await getAnchorsForIssuer(ISSUER)).toEqual([FETCHED_PEM]);
    } finally {
      Date.now = realNow;
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the static list (undefined) when the fetch fails with no cache', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    setCurrentIssuerBaseUrl(ISSUER);
    const resolve = createTrustedCertificatesResolver([STATIC_PEM]);

    // undefined tells Credo to use the globally registered trustedCertificates,
    // i.e. the previous hardcoded behaviour — not a hard failure of the offer.
    await expect(resolve({}, credentialContext)).resolves.toBeUndefined();
  });

  it('treats a non-2xx response as a failure rather than an empty anchor set', async () => {
    global.fetch = mockFetchOnce({}, false, 404) as unknown as typeof fetch;
    await expect(getAnchorsForIssuer(ISSUER)).rejects.toThrow();
  });

  it('rejects a 200 whose body carries no certificates', async () => {
    global.fetch = mockFetchOnce({ anchors: [] }) as unknown as typeof fetch;
    await expect(getAnchorsForIssuer(ISSUER)).rejects.toThrow();
  });

  it('never fetches when no issuer is recorded (offline presentation path)', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM] });
    global.fetch = fetchMock as unknown as typeof fetch;

    clearCurrentIssuerBaseUrl();
    const resolve = createTrustedCertificatesResolver([STATIC_PEM]);
    const result = await resolve({}, credentialContext);

    // Falls through to the static list without touching the network — this is
    // what keeps BLE proximity presentation working with no connectivity.
    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never fetches for non-credential verification types', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM] });
    global.fetch = fetchMock as unknown as typeof fetch;

    setCurrentIssuerBaseUrl(ISSUER);
    const resolve = createTrustedCertificatesResolver([STATIC_PEM]);
    const result = await resolve({}, { verification: { type: 'oauth2SecuredAuthorizationRequest' } });

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reduces an issuer URL with a path to its origin', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM] });
    global.fetch = fetchMock as unknown as typeof fetch;

    // walt.id draft13 issuers publish credential_issuer with a path segment;
    // the endpoint lives at the deployment root.
    setCurrentIssuerBaseUrl(`${ISSUER}/draft13`);
    const resolve = createTrustedCertificatesResolver([STATIC_PEM]);
    await resolve({}, credentialContext);

    expect(fetchMock.mock.calls[0][0]).toBe(`${ISSUER}/trust/mdoc-anchors`);
  });

  it('ignores an unparseable issuer URL instead of throwing inside verification', async () => {
    const fetchMock = mockFetchOnce({ anchors: [FETCHED_PEM] });
    global.fetch = fetchMock as unknown as typeof fetch;

    setCurrentIssuerBaseUrl('not a url');
    const resolve = createTrustedCertificatesResolver([STATIC_PEM]);

    await expect(resolve({}, credentialContext)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
