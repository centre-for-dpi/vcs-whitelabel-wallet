/**
 * Tests for the Universal Resolver-backed Credo DidResolver.
 *
 * Response bodies below mirror what dev.uniresolver.io actually returns: a
 * resolution result for success, and a resolution result with an object-shaped
 * `error` ({ type: 'INVALID_DID', ... }) plus HTTP 400 for an invalid DID.
 */

// Mock @credo-ts/core before any imports so the real package is never loaded
// (same convention as the other suites). JsonTransformer.fromJSON just wraps
// the JSON in the mocked DidDocument class.
jest.mock('@credo-ts/core', () => {
  class DidDocument {
    constructor(json: Record<string, unknown>) {
      Object.assign(this, json);
    }
  }
  return {
    DidDocument,
    JsonTransformer: {
      fromJSON: (json: Record<string, unknown>, Cls: new (j: Record<string, unknown>) => unknown) => new Cls(json),
    },
  };
});

import { DidDocument, type ParsedDid } from '@credo-ts/core';
import { UniversalDidResolver } from '../agent/universalResolver';

// Minimal stand-in for Credo's parseDid: enough for the resolver, which only reads `.did`.
function parseDid(didUrl: string): ParsedDid {
  const did = didUrl.split(/[/?#]/)[0];
  const [, method, id] = did.split(':');
  return { did, didUrl, method, id } as ParsedDid;
}

const ENDPOINT = 'https://resolver.example.org';
const DID = 'did:ebsi:zZeKyEJfUTGwajhNyNX928z';

const didDocumentJson = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: DID,
  verificationMethod: [
    {
      id: `${DID}#key-1`,
      type: 'JsonWebKey2020',
      controller: DID,
      publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'Lm_M42cB3HkUiODQsXRcweM6TByfzEHGO9ND274JcOY' },
    },
  ],
  assertionMethod: [`${DID}#key-1`],
};

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// The resolver ignores its AgentContext and options arguments.
const resolve = (resolver: UniversalDidResolver, did: string) =>
  resolver.resolve({} as never, did, parseDid(did), {});

describe('UniversalDidResolver', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  describe('supportedMethods', () => {
    it('starts with the fallback list minus the on-device methods', () => {
      const r = new UniversalDidResolver(ENDPOINT, {
        fallbackMethods: ['ebsi', 'key', 'cheqd', 'web', 'ebsi'],
        localMethods: ['key', 'jwk', 'peer', 'web'],
      });
      expect(r.supportedMethods).toEqual(['ebsi', 'cheqd']);
    });

    it('replaces the list with GET /1.0/methods, still excluding on-device methods', async () => {
      fetchMock.mockResolvedValueOnce(response(['indy', 'key', 'ion', 'jwk', 'webvh']));
      const r = new UniversalDidResolver(`${ENDPOINT}/`, {
        fallbackMethods: ['ebsi'],
        localMethods: ['key', 'jwk', 'peer', 'web'],
      });

      await expect(r.refreshMethods()).resolves.toEqual(['indy', 'ion', 'webvh']);
      expect(r.supportedMethods).toEqual(['indy', 'ion', 'webvh']);
      expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/1.0/methods`);
    });

    it('keeps the fallback list when the instance is unreachable', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      const r = new UniversalDidResolver(ENDPOINT, { fallbackMethods: ['ebsi', 'cheqd'] });

      await expect(r.refreshMethods()).resolves.toEqual(['ebsi', 'cheqd']);
    });

    it('keeps the fallback list when /1.0/methods returns something other than a string array', async () => {
      fetchMock.mockResolvedValueOnce(response({ methods: ['indy'] }));
      const r = new UniversalDidResolver(ENDPOINT, { fallbackMethods: ['ebsi'] });

      await expect(r.refreshMethods()).resolves.toEqual(['ebsi']);
    });
  });

  describe('resolve', () => {
    it('returns the document from a full resolution result', async () => {
      fetchMock.mockResolvedValueOnce(
        response({
          didDocument: didDocumentJson,
          didResolutionMetadata: { contentType: 'application/did' },
          didDocumentMetadata: { versionId: '3' },
        }),
      );
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didDocument).toBeInstanceOf(DidDocument);
      expect(result.didDocument?.id).toBe(DID);
      expect(result.didDocument?.verificationMethod?.[0].id).toBe(`${DID}#key-1`);
      expect(result.didDocumentMetadata).toEqual({ versionId: '3' });
      expect(result.didResolutionMetadata.error).toBeUndefined();
    });

    it('accepts a bare DID document', async () => {
      fetchMock.mockResolvedValueOnce(response(didDocumentJson));
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didDocument?.id).toBe(DID);
    });

    it('requests the bare DID even when given a DID URL, with the resolution-result Accept header', async () => {
      fetchMock.mockResolvedValueOnce(response({ didDocument: didDocumentJson }));
      await resolve(new UniversalDidResolver(ENDPOINT), `${DID}#key-1`);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${ENDPOINT}/1.0/identifiers/${DID}`);
      expect(init.headers.Accept).toBe('application/ld+json;profile="https://w3id.org/did-resolution"');
    });

    it('maps an object-shaped Universal Resolver error to a DID Core error code', async () => {
      fetchMock.mockResolvedValueOnce(
        response(
          {
            didDocument: null,
            didResolutionMetadata: {
              error: { type: 'INVALID_DID', title: 'Invalid DID.', detail: 'Not a valid did:ebsi' },
            },
            didDocumentMetadata: {},
          },
          400,
        ),
      );
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didDocument).toBeNull();
      expect(result.didResolutionMetadata.error).toBe('invalidDid');
      expect(result.didResolutionMetadata.message).toBe('Not a valid did:ebsi');
    });

    it('passes a string error code through unchanged', async () => {
      fetchMock.mockResolvedValueOnce(
        response({ didDocument: null, didResolutionMetadata: { error: 'notFound' }, didDocumentMetadata: {} }, 404),
      );
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didResolutionMetadata.error).toBe('notFound');
    });

    it("surfaces a gateway's top-level message, e.g. the public instance's rate limit", async () => {
      fetchMock.mockResolvedValueOnce(
        response(
          {
            status: 403,
            error: 'Forbidden',
            message: 'Too many Universal Resolver requests. Only 10 requests are allowed per 1800 seconds.',
          },
          403,
        ),
      );
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didDocument).toBeNull();
      expect(result.didResolutionMetadata.message).toBe(
        'HTTP 403: Too many Universal Resolver requests. Only 10 requests are allowed per 1800 seconds.',
      );
    });

    it('derives the error from the HTTP status when the body is not JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      });
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didDocument).toBeNull();
      expect(result.didResolutionMetadata.error).toBe('notFound');
    });

    it('returns internalError instead of throwing when the request fails', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      const result = await resolve(new UniversalDidResolver(ENDPOINT), DID);

      expect(result.didDocument).toBeNull();
      expect(result.didResolutionMetadata.error).toBe('internalError');
      expect(result.didResolutionMetadata.message).toContain('Network request failed');
    });
  });
});
