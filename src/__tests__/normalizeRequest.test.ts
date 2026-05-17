import {
  isHttpOid4VpRequest,
  resolveHttpOid4VpRequest,
  normalizeAuthorizationRequestUrl,
} from '../agent/oid4vp/normalizeRequest';

beforeEach(() => {
  global.fetch = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// Builds a minimal unsigned JWT string with the given payload
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=/g, '');
  const body = btoa(JSON.stringify(payload)).replace(/=/g, '');
  return `${header}.${body}.`;
}

function mockFetchText(text: string) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    text: async () => text,
  });
}

function mockFetchJson(json: unknown) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => json,
  });
}

function mockFetchError(status: number) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status });
}

// ── isHttpOid4VpRequest ───────────────────────────────────────────────────────

describe('isHttpOid4VpRequest', () => {
  test('returns true when request_uri uses http://', () => {
    const url = 'openid4vp://?request_uri=http%3A%2F%2Fverifier.example.com%2Frequest%2F123';
    expect(isHttpOid4VpRequest(url)).toBe(true);
  });

  test('returns false when request_uri uses https://', () => {
    const url = 'openid4vp://?request_uri=https%3A%2F%2Fverifier.example.com%2Frequest%2F123';
    expect(isHttpOid4VpRequest(url)).toBe(false);
  });

  test('returns false when no request_uri param is present', () => {
    const url = 'openid4vp://?client_id=did%3Aexample%3A123';
    expect(isHttpOid4VpRequest(url)).toBe(false);
  });

  test('returns false when URL has no query string', () => {
    expect(isHttpOid4VpRequest('openid4vp://')).toBe(false);
  });

  test('returns false for an HTTPS base URL with an HTTP request_uri embedded but HTTPS', () => {
    const url = 'https://verifier.example.com?request_uri=https%3A%2F%2Fverifier.example.com%2Freq';
    expect(isHttpOid4VpRequest(url)).toBe(false);
  });
});

// ── resolveHttpOid4VpRequest ──────────────────────────────────────────────────

describe('resolveHttpOid4VpRequest', () => {
  const baseUrl = 'openid4vp://?client_id=https%3A%2F%2Fverifier.example.com&request_uri=http%3A%2F%2Fverifier.example.com%2Freq%2F1';

  test('returns a resolved request with presentationExchange when PD is in the JAR payload', async () => {
    const payload = {
      client_id: 'https://verifier.example.com',
      response_uri: 'https://verifier.example.com/response',
      nonce: 'nonce-abc',
      state: 'state-xyz',
      presentation_definition: {
        id: 'pd-1',
        input_descriptors: [{ id: 'desc-1', constraints: { fields: [] } }],
      },
    };
    mockFetchText(makeJwt(payload));

    const result = await resolveHttpOid4VpRequest(baseUrl) as unknown as Record<string, unknown>;

    expect(result.presentationExchange).toBeDefined();
    const pex = result.presentationExchange as Record<string, unknown>;
    expect((pex.definition as Record<string, unknown>).id).toBe('pd-1');
    expect(result.dcql).toBeUndefined();
  });

  test('returns a resolved request with dcql when dcql_query is in the JAR payload', async () => {
    const payload = {
      client_id: 'https://verifier.example.com',
      response_uri: 'https://verifier.example.com/response',
      nonce: 'nonce-abc',
      dcql_query: {
        credentials: [
          { id: 'cred-1', format: 'dc+sd-jwt', meta: { vct_values: ['https://example.com/PID'] } },
        ],
      },
    };
    mockFetchText(makeJwt(payload));

    const result = await resolveHttpOid4VpRequest(baseUrl) as unknown as Record<string, unknown>;

    expect(result.dcql).toBeDefined();
    expect(result.presentationExchange).toBeUndefined();
  });

  test('falls back to redirect_uri for response_uri when response_uri is absent', async () => {
    const payload = {
      client_id: 'https://verifier.example.com',
      redirect_uri: 'https://verifier.example.com/cb',
      nonce: 'nonce-abc',
    };
    mockFetchText(makeJwt(payload));

    const result = await resolveHttpOid4VpRequest(baseUrl) as unknown as Record<string, unknown>;
    const reqPayload = result.authorizationRequestPayload as Record<string, unknown>;
    expect(reqPayload.response_uri).toBe('https://verifier.example.com/cb');
  });

  test('throws when the request_uri fetch fails', async () => {
    mockFetchError(404);
    await expect(resolveHttpOid4VpRequest(baseUrl)).rejects.toThrow('404');
  });

  test('prefers client_id from query params over JAR payload', async () => {
    const payload = {
      client_id: 'did:example:from-payload',
      response_uri: 'https://verifier.example.com/response',
      nonce: 'nonce-abc',
    };
    mockFetchText(makeJwt(payload));

    // URL has client_id=https://verifier.example.com in query params
    const result = await resolveHttpOid4VpRequest(baseUrl) as unknown as Record<string, unknown>;
    const reqPayload = result.authorizationRequestPayload as Record<string, unknown>;
    expect(reqPayload.client_id).toBe('https://verifier.example.com');
  });
});

// ── normalizeAuthorizationRequestUrl ─────────────────────────────────────────

describe('normalizeAuthorizationRequestUrl', () => {
  test('returns the URL unchanged when there is no query string', async () => {
    const url = 'openid4vp://';
    const result = await normalizeAuthorizationRequestUrl(url);
    expect(result).toBe(url);
  });

  test('patches client_id to equal response_uri when client_id_scheme=redirect_uri', async () => {
    const url =
      'openid4vp://?client_id=old_value&client_id_scheme=redirect_uri&response_uri=https%3A%2F%2Fverifier.example.com%2Fcb';
    const result = await normalizeAuthorizationRequestUrl(url);
    const params = new URLSearchParams(result.split('?')[1]);
    expect(params.get('client_id')).toBe('https://verifier.example.com/cb');
  });

  test('does not change client_id when client_id_scheme is absent', async () => {
    const url = 'openid4vp://?client_id=did%3Aexample%3A123&response_uri=https%3A%2F%2Fverifier.example.com%2Fcb';
    const result = await normalizeAuthorizationRequestUrl(url);
    const params = new URLSearchParams(result.split('?')[1]);
    expect(params.get('client_id')).toBe('did:example:123');
  });

  test('fetches and inlines presentation_definition_uri, removing the URI param', async () => {
    const pd = { id: 'fetched-pd', input_descriptors: [] };
    mockFetchJson(pd);

    const url = 'openid4vp://?client_id=x&presentation_definition_uri=https%3A%2F%2Fverifier.example.com%2Fpd.json';
    const result = await normalizeAuthorizationRequestUrl(url);
    const params = new URLSearchParams(result.split('?')[1]);

    expect(params.has('presentation_definition_uri')).toBe(false);
    const inlined = JSON.parse(params.get('presentation_definition')!);
    expect(inlined.id).toBe('fetched-pd');
  });

  test('injects alg array into format constraints when fetching PD URI', async () => {
    const pd = {
      id: 'pd-with-format',
      input_descriptors: [
        {
          id: 'desc-1',
          format: { jwt_vc_json: { proof_type: ['JsonWebSignature2020'] } },
          constraints: { fields: [] },
        },
      ],
    };
    mockFetchJson(pd);

    const url = 'openid4vp://?client_id=x&presentation_definition_uri=https%3A%2F%2Fverifier.example.com%2Fpd.json';
    const result = await normalizeAuthorizationRequestUrl(url);
    const params = new URLSearchParams(result.split('?')[1]);
    const inlined = JSON.parse(params.get('presentation_definition')!);
    const descriptor = inlined.input_descriptors[0] as Record<string, Record<string, unknown>>;

    expect(Array.isArray(descriptor.format.jwt_vc_json.alg)).toBe(true);
    expect(descriptor.format.jwt_vc_json.alg).toContain('ES256');
  });

  test('does not overwrite an existing alg array in format constraints', async () => {
    const pd = {
      id: 'pd-with-existing-alg',
      input_descriptors: [
        {
          id: 'desc-1',
          format: { jwt_vc_json: { alg: ['EdDSA'] } },
          constraints: { fields: [] },
        },
      ],
    };
    mockFetchJson(pd);

    const url = 'openid4vp://?client_id=x&presentation_definition_uri=https%3A%2F%2Fverifier.example.com%2Fpd.json';
    const result = await normalizeAuthorizationRequestUrl(url);
    const params = new URLSearchParams(result.split('?')[1]);
    const inlined = JSON.parse(params.get('presentation_definition')!);
    const descriptor = inlined.input_descriptors[0] as Record<string, Record<string, unknown>>;

    // Existing alg=['EdDSA'] must not be replaced
    expect(descriptor.format.jwt_vc_json.alg).toEqual(['EdDSA']);
  });

  test('throws when presentation_definition_uri fetch fails', async () => {
    mockFetchError(503);
    const url = 'openid4vp://?client_id=x&presentation_definition_uri=https%3A%2F%2Fverifier.example.com%2Fpd.json';
    await expect(normalizeAuthorizationRequestUrl(url)).rejects.toThrow('503');
  });
});
