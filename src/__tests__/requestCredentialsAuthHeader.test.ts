// Reproduces a live bug found during Task 6 end-to-end verification against a
// real Inji Certify v0.14.0 preauth instance: the wallet's own proxy
// (inji-preauth-proxy) logged authHdrLen=0 on every credential request, and
// Inji Certify correctly rejected it with 401 invalid_token — the wallet
// never sent the Authorization: Bearer header at all on the mso_mdoc manual
// POST path (requestCredentials.ts's `format === 'mso_mdoc' && legacy`
// branch), despite the source visibly interpolating `Bearer ${accessToken}`
// into the headers object. walt.id issuance was and is unaffected — its
// credential_endpoint never contains "/v1/certify/", so isLegacyEndpoint
// returns false and this manual-POST branch is never taken; walt.id goes
// through Credo's own requestCredentials() path instead, which this branch
// exists specifically to bypass.
//
// Mocking approach matches requestCredentialsMdocWrapper.test.ts's existing
// pattern (same file, same hoisting constraints — see that file's header
// comment): @credo-ts/core and credentialBinding are stubbed so importing
// requestCredentials.ts doesn't pull in the real ESM build Jest can't parse.
jest.mock('@credo-ts/core', () => ({
  DidsApi: class {},
  Kms: { KeyManagementApi: class {} },
  TypedArrayEncoder: {
    toBase64URL: (buffer: Uint8Array) => Buffer.from(buffer).toString('base64url'),
    fromBase64: (base64: string) => Buffer.from(base64, 'base64'),
    fromString: (str: string) => Buffer.from(str, 'utf8'),
  },
}));

jest.mock('../agent/credentialBinding', () => ({
  credentialBindingResolver: jest.fn(),
}));

jest.mock('../agent/mdocTrustAnchors', () => ({
  setCurrentIssuerBaseUrl: jest.fn(),
  clearCurrentIssuerBaseUrl: jest.fn(),
}));

// @animo-id/mdoc's cborEncode is called on the raw response bytes by
// detectAndUnwrapMdocEnvelope even when nothing needs unwrapping (it decodes
// first, and a non-wrapped response short-circuits before cborEncode) — but
// cborDecode DOES run unconditionally, so it must return something that
// looks like neither the wrapped nor a Map shape, letting the function fall
// through its catch/return-unmodified paths without needing a real CBOR
// fixture for this test (only the HTTP layer is under test here).
jest.mock('@animo-id/mdoc', () => ({
  cborDecode: jest.fn(() => { throw new Error('not real CBOR — fine, caught and passed through'); }),
  cborEncode: jest.fn(),
}));

import { requestOid4VciCredentials } from '../agent/oid4vci/requestCredentials';
import type { WalletAgent } from '../agent/setup';

describe('requestOid4VciCredentials — mso_mdoc legacy manual POST', () => {
  test('sends Authorization: Bearer <accessToken> on the credential request', async () => {
    const capturedRequests: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = jest.fn(async (url: string, init: RequestInit) => {
      capturedRequests.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ credential: 'ZmFrZS1jcmVkZW50aWFs' }), // arbitrary base64url, not real CBOR
        text: async () => '',
      } as Response;
    });
    global.fetch = fakeFetch as unknown as typeof fetch;

    const fakeAgent = {
      dependencyManager: {
        // buildProofJwt's useJwk branch (taken because cryptographic_binding_methods_supported
        // below includes 'jwk') calls kms.createKeyForSignatureAlgorithm then kms.sign —
        // stubbed with the minimum shape buildProofJwt actually reads.
        resolve: jest.fn(() => ({
          createKeyForSignatureAlgorithm: jest.fn(async () => ({
            publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
            keyId: 'test-key-id',
          })),
          sign: jest.fn(async () => ({ signature: new Uint8Array([1, 2, 3]) })),
        })),
      },
      modules: { openid4vc: { holder: {} } },
    } as unknown as WalletAgent;

    const offer = {
      metadata: {
        credentialIssuer: {
          credential_issuer: 'https://inji-certify-preauth.mtc.credenciales.ysalabs.work',
          // The exact substring (/v1/certify/) isLegacyEndpoint keys off of —
          // this is what makes the manual-POST branch activate for Inji, and
          // never for walt.id (whose endpoint has no such path segment).
          credential_endpoint: 'https://inji-certify-preauth.mtc.credenciales.ysalabs.work/v1/certify/issuance/credential',
        },
      },
      offeredCredentialConfigurations: {
        'custom-dkzy5558eher': {
          format: 'mso_mdoc',
          doctype: 'org.iso.18013.5.1.mDL',
          cryptographic_binding_methods_supported: ['jwk'],
          proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
        },
      },
    };

    const tokenResp = { accessToken: 'THE-REAL-ACCESS-TOKEN', cNonce: 'test-nonce' };

    await requestOid4VciCredentials(fakeAgent, offer, tokenResp);

    expect(capturedRequests).toHaveLength(1);
    const [{ url, init }] = capturedRequests;
    expect(url).toBe('https://inji-certify-preauth.mtc.credenciales.ysalabs.work/v1/certify/issuance/credential');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer THE-REAL-ACCESS-TOKEN');
  });
});
