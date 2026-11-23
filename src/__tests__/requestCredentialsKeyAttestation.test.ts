jest.mock('@credo-ts/core', () => ({
  DidsApi: class {},
  Kms: { KeyManagementApi: class {} },
  TypedArrayEncoder: {
    toBase64URL: (buffer: Uint8Array) => Buffer.from(buffer).toString('base64url'),
    fromBase64: (base64: string) => Buffer.from(base64, 'base64'),
    fromString: (str: string) => Buffer.from(str, 'utf8'),
  },
}));
jest.mock('../agent/credentialBinding', () => ({ credentialBindingResolver: jest.fn() }));
jest.mock('../agent/mdocTrustAnchors', () => ({
  setCurrentIssuerBaseUrl: jest.fn(),
  clearCurrentIssuerBaseUrl: jest.fn(),
}));
jest.mock('@animo-id/mdoc', () => ({
  cborDecode: jest.fn(() => { throw new Error('not real CBOR'); }),
  cborEncode: jest.fn(),
}));
jest.mock('../../branding.config', () => ({
  keyAttestationConfig: {
    enabled: true,
    walletProviderUrl: 'https://wp.example',
    keyStorage: 'iso_18045_basic',
    attachWhen: 'required',
  },
}));
jest.mock('../agent/keyAttestation/walletProviderClient', () => ({
  requestKeyAttestation: jest.fn(async () => 'att.jwt.sig'),
}));

import { keyAttestationConfig } from '../../branding.config';
import { requestKeyAttestation } from '../agent/keyAttestation/walletProviderClient';
import { requestOid4VciCredentials } from '../agent/oid4vci/requestCredentials';
import type { WalletAgent } from '../agent/setup';

const mockedRequest = requestKeyAttestation as jest.Mock;
const cfg = keyAttestationConfig as { enabled: boolean; attachWhen: string };

const makeAgent = () =>
  ({
    dependencyManager: {
      resolve: jest.fn(() => ({
        createKeyForSignatureAlgorithm: jest.fn(async () => ({
          publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'kms-id' },
          keyId: 'kms-id',
        })),
        sign: jest.fn(async () => ({ signature: new Uint8Array([1, 2, 3]) })),
      })),
    },
    modules: { openid4vc: { holder: {} } },
  }) as unknown as WalletAgent;

const makeOffer = (binding: string[], proofJwt: Record<string, unknown>) => ({
  metadata: {
    credentialIssuer: {
      credential_issuer: 'https://issuer.example',
      credential_endpoint: 'https://issuer.example/v1/certify/issuance/credential',
    },
  },
  offeredCredentialConfigurations: {
    cfg: {
      format: 'mso_mdoc',
      doctype: 'org.iso.18013.5.1.mDL',
      cryptographic_binding_methods_supported: binding,
      proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'], ...proofJwt } },
    },
  },
});

let bodies: string[];
beforeEach(() => {
  bodies = [];
  mockedRequest.mockClear();
  cfg.enabled = true;
  cfg.attachWhen = 'required';
  global.fetch = jest.fn(async (_url: string, init: RequestInit) => {
    bodies.push(init.body as string);
    return { ok: true, status: 200, json: async () => ({ credential: 'ZmFrZQ' }), text: async () => '' } as Response;
  }) as unknown as typeof fetch;
});

const proofHeader = () => {
  const jwt = JSON.parse(bodies[0]).proof.jwt as string;
  return JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString('utf8'));
};
const run = (offer: unknown) =>
  requestOid4VciCredentials(makeAgent(), offer as Record<string, unknown>, { accessToken: 't', cNonce: 'n1' });

test('legacy jwk path adds key_attestation to proof header when issuer requires it', async () => {
  await run(makeOffer(['jwk'], { key_attestations_required: { key_storage: ['iso_18045_basic'] } }));
  expect(proofHeader().key_attestation).toBe('att.jwt.sig');
  const args = mockedRequest.mock.calls[0][0];
  expect(args.nonce).toBe('n1');
  expect(args.attestedKey).toMatchObject({ kid: 'kms-id', x: 'x' });
  expect(args.keyStorage).toBe('iso_18045_basic');
  // header jwk stays clean of Credo-internal fields
  expect(proofHeader().jwk.kid).toBeUndefined();
});

test('legacy path without requirement leaves header unchanged', async () => {
  await run(makeOffer(['jwk'], {}));
  expect(Object.keys(proofHeader())).toEqual(['alg', 'jwk', 'typ']);
  expect(mockedRequest).not.toHaveBeenCalled();
});

test('toggle off: header unchanged even if issuer requires attestation', async () => {
  cfg.enabled = false;
  await run(makeOffer(['jwk'], { key_attestations_required: { key_storage: ['iso_18045_basic'] } }));
  expect(Object.keys(proofHeader())).toEqual(['alg', 'jwk', 'typ']);
  expect(mockedRequest).not.toHaveBeenCalled();
});

test('attachWhen always attaches without issuer requirement', async () => {
  cfg.attachWhen = 'always';
  await run(makeOffer(['jwk'], {}));
  expect(proofHeader().key_attestation).toBe('att.jwt.sig');
});

test('requires attestation but DID-only binding throws', async () => {
  await expect(
    run(makeOffer(['did:key'], { key_attestations_required: {} })),
  ).rejects.toMatchObject({ name: 'KeyAttestationError', code: 'disabled' });
  expect(mockedRequest).not.toHaveBeenCalled();
});
