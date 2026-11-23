jest.mock('@credo-ts/core', () => ({
  DidsApi: class {},
  Kms: { KeyManagementApi: class {}, PublicJwk: { fromUnknown: (j: unknown) => j } },
}));

jest.mock('../agent/keyAttestation/walletProviderClient', () => ({
  requestKeyAttestation: jest.fn(),
}));

const mockConfig = {
  enabled: true,
  walletProviderUrl: 'https://wp.example',
  keyStorage: 'iso_18045_basic',
  attachWhen: 'required',
};
jest.mock('../../branding.config', () => ({
  get keyAttestationConfig() {
    return mockConfig;
  },
}));

import { Kms } from '@credo-ts/core';
import { credentialBindingResolver } from '../agent/credentialBinding';
import { requestKeyAttestation } from '../agent/keyAttestation/walletProviderClient';
import { KeyAttestationError } from '../agent/keyAttestation/requirements';

const mockRequest = requestKeyAttestation as jest.Mock;

function setup(overrides: Record<string, unknown> = {}) {
  const kms = {
    createKeyForSignatureAlgorithm: jest.fn().mockResolvedValue({
      publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'abc' },
      keyId: 'kms-key-1',
    }),
  };
  const agentContext = {
    dependencyManager: {
      resolve: (token: unknown) => (token === Kms.KeyManagementApi ? kms : {}),
    },
  };
  const options: any = {
    agentContext,
    supportsJwk: true,
    supportsAllDidMethods: false,
    supportedDidMethods: [],
    cNonce: 'c-nonce-1',
    proofTypes: { jwt: { supportedSignatureAlgorithms: ['EdDSA'] } },
    ...overrides,
  };
  return { kms, options };
}

const requiring = (keyStorage?: string[]) => ({
  jwt: { supportedSignatureAlgorithms: ['EdDSA'], keyAttestationsRequired: { keyStorage } },
});

beforeEach(() => {
  mockRequest.mockReset().mockResolvedValue('att.jwt.sig');
  Object.assign(mockConfig, {
    enabled: true,
    walletProviderUrl: 'https://wp.example',
    keyStorage: 'iso_18045_basic',
    attachWhen: 'required',
  });
});

test('issuer requires basic + toggle on → returns attestation binding with kid = KMS keyId', async () => {
  const { options } = setup({ proofTypes: requiring(['iso_18045_basic']) });
  const result = await credentialBindingResolver(options);
  expect(mockRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      walletProviderUrl: 'https://wp.example',
      attestedKey: expect.objectContaining({ kid: 'kms-key-1', kty: 'OKP' }),
      nonce: 'c-nonce-1',
      keyStorage: 'iso_18045_basic',
    }),
  );
  expect(result).toEqual({ method: 'attestation', keyAttestationJwt: 'att.jwt.sig' });
});

test('issuer requires + toggle off → KeyAttestationError disabled, no key created', async () => {
  mockConfig.enabled = false;
  const { kms, options } = setup({ proofTypes: requiring(['iso_18045_basic']) });
  const err = await credentialBindingResolver(options).catch((e) => e);
  expect(err).toBeInstanceOf(KeyAttestationError);
  expect(err.code).toBe('disabled');
  expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled();
});

test('issuer requires only iso_18045_high → key_storage_level, provider not called', async () => {
  const { kms, options } = setup({ proofTypes: requiring(['iso_18045_high']) });
  const err = await credentialBindingResolver(options).catch((e) => e);
  expect(err).toBeInstanceOf(KeyAttestationError);
  expect(err.code).toBe('key_storage_level');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(kms.createKeyForSignatureAlgorithm).not.toHaveBeenCalled();
});

test('toggle on, attachWhen required, issuer requires nothing → jwk binding unchanged', async () => {
  const { options } = setup();
  const result: any = await credentialBindingResolver(options);
  expect(result.method).toBe('jwk');
  expect(mockRequest).not.toHaveBeenCalled();
});

test('attachWhen always, issuer supports jwk → attestation binding', async () => {
  mockConfig.attachWhen = 'always';
  const { options } = setup();
  const result = await credentialBindingResolver(options);
  expect(result).toEqual({ method: 'attestation', keyAttestationJwt: 'att.jwt.sig' });
  expect(mockRequest).toHaveBeenCalledTimes(1);
});

test('attachWhen always, did-only issuer → no attestation, falls through', async () => {
  mockConfig.attachWhen = 'always';
  const { options } = setup({ supportsJwk: false, supportsAllDidMethods: false, supportedDidMethods: [] });
  // No jwk and no did:key support → existing generic error, attestation never attempted
  await expect(credentialBindingResolver(options)).rejects.toThrow(/no soporta/);
  expect(mockRequest).not.toHaveBeenCalled();
});

test('uses algorithm from attestation proof type when only attestation is offered', async () => {
  mockConfig.attachWhen = 'always';
  const { kms, options } = setup({
    proofTypes: { jwt: undefined, attestation: { supportedSignatureAlgorithms: ['ES256'] } },
  });
  await credentialBindingResolver(options);
  expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledWith({ algorithm: 'ES256' });
});

test('attestation proof type requires, jwt does not, toggle off → jwk binding, no throw, no provider call', async () => {
  mockConfig.enabled = false;
  const { kms, options } = setup({
    proofTypes: {
      jwt: { supportedSignatureAlgorithms: ['EdDSA'] },
      attestation: { supportedSignatureAlgorithms: ['EdDSA'], keyAttestationsRequired: { keyStorage: ['iso_18045_high'] } },
    },
  });
  const result: any = await credentialBindingResolver(options);
  expect(result.method).toBe('jwk');
  expect(mockRequest).not.toHaveBeenCalled();
  expect(kms.createKeyForSignatureAlgorithm).toHaveBeenCalledTimes(1);
});
