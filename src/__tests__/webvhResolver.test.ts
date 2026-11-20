/**
 * StrictWebVhDidResolver: Credo's did:webvh resolver must not return a
 * document for a different DID than the one requested (see webvhResolver.ts).
 * The base resolver is mocked; the real one was checked against live DIDs.
 */

const mockBaseResolve = jest.fn();

jest.mock('@credo-ts/webvh', () => ({
  WebVhDidResolver: class {
    readonly supportedMethods = ['webvh'];
    resolve(...args: unknown[]) {
      return mockBaseResolve(...args);
    }
  },
}));

import type { ParsedDid } from '@credo-ts/core';
import { StrictWebVhDidResolver } from '../agent/webvhResolver';

const DOMAIN = 'gist.githubusercontent.com:brianorwhatever:9c4633d18eb644f7a47f93a802691626:raw';
const DID = `did:webvh:QmPEQVM1JPTyrvEgBcDXwjK4TeyLGSX1PxjgyeAisdWM1p:${DOMAIN}`;
const OTHER_SCID_DID = `did:webvh:QmaJp6pmb6RUk4oaDyWQcjeqYbvxsc3kvmktWFwRtMyfBi:${DOMAIN}`;

const parsed = (did: string, didUrl = did) => ({ did, didUrl, method: 'webvh', id: did.slice(10) }) as ParsedDid;
const ok = (id: string) => ({
  didDocument: { id },
  didDocumentMetadata: {},
  didResolutionMetadata: {},
});

describe('StrictWebVhDidResolver', () => {
  beforeEach(() => mockBaseResolve.mockReset());

  it('still handles did:webvh', () => {
    expect(new StrictWebVhDidResolver().supportedMethods).toEqual(['webvh']);
  });

  it('returns the document when its id is the DID requested', async () => {
    mockBaseResolve.mockResolvedValueOnce(ok(DID));
    const result = await new StrictWebVhDidResolver().resolve({} as never, DID, parsed(DID), {});

    expect(result.didDocument?.id).toBe(DID);
    expect(mockBaseResolve).toHaveBeenCalledWith({}, DID);
  });

  it('rejects a document for a different SCID at the same location', async () => {
    mockBaseResolve.mockResolvedValueOnce(ok(DID));
    const result = await new StrictWebVhDidResolver().resolve({} as never, OTHER_SCID_DID, parsed(OTHER_SCID_DID), {});

    expect(result.didDocument).toBeNull();
    expect(result.didResolutionMetadata.error).toBe('notFound');
    expect(result.didResolutionMetadata.message).toContain(DID);
  });

  it('resolves the bare DID when given a DID URL', async () => {
    mockBaseResolve.mockResolvedValueOnce(ok(DID));
    const result = await new StrictWebVhDidResolver().resolve({} as never, `${DID}#key-1`, parsed(DID, `${DID}#key-1`), {});

    expect(mockBaseResolve).toHaveBeenCalledWith({}, DID);
    expect(result.didDocument?.id).toBe(DID);
  });

  it('passes resolution failures through unchanged', async () => {
    const failure = { didDocument: null, didDocumentMetadata: {}, didResolutionMetadata: { error: 'notFound', message: 'x' } };
    mockBaseResolve.mockResolvedValueOnce(failure);

    await expect(new StrictWebVhDidResolver().resolve({} as never, DID, parsed(DID), {})).resolves.toBe(failure);
  });
});
