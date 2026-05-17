import { normalizeOffer } from '../agent/oid4vci/normalizeOffer';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// Helper to build a minimal conformant offer (all patches are no-ops)
function makeConformantOffer(overrides: Record<string, unknown> = {}) {
  return {
    offeredCredentialConfigurations: {
      PID: {
        format: 'dc+sd-jwt',
        vct: 'https://issuer.example.com/PID',
        proof_types_supported: { jwt: { proof_signing_alg_values_supported: ['ES256'] } },
      },
    },
    metadata: {
      originalDraftVersion: 'Draft13',
      credentialIssuer: {
        credential_issuer: 'https://issuer.example.com',
        credential_endpoint: 'https://issuer.example.com/credential',
      },
    },
    ...overrides,
  };
}

describe('normalizeOffer — Patch 1: inject missing offeredCredentialConfigurations', () => {
  test('injects config when offeredCredentialConfigurations is empty', () => {
    const raw = {
      offeredCredentialConfigurations: {},
      credentialOfferPayload: { credential_configuration_ids: ['PID'] },
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://issuer.example.com',
          credential_endpoint: 'https://issuer.example.com/credential',
          credential_configurations_supported: {
            PID: {
              format: 'dc+sd-jwt',
              vct: 'https://issuer.example.com/PID',
              credential_signing_alg_values_supported: ['ES256'],
            },
          },
        },
      },
    };

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, unknown>;
    expect(Object.keys(configs)).toContain('PID');
  });

  test('preserves the raw vct when present in credential_configurations_supported', () => {
    const raw = {
      offeredCredentialConfigurations: {},
      credentialOfferPayload: { credential_configuration_ids: ['PID'] },
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://issuer.example.com',
          credential_endpoint: 'https://issuer.example.com/credential',
          credential_configurations_supported: {
            PID: {
              format: 'dc+sd-jwt',
              vct: 'https://issuer.example.com/my-custom-vct',
            },
          },
        },
      },
    };

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, Record<string, unknown>>;
    expect(configs.PID.vct).toBe('https://issuer.example.com/my-custom-vct');
  });

  test('derives vct from credential_definition.type when raw.vct is absent and type is not an absolute URL', () => {
    const raw = {
      offeredCredentialConfigurations: {},
      credentialOfferPayload: { credential_configuration_ids: ['MyDegree'] },
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://issuer.example.com',
          credential_endpoint: 'https://issuer.example.com/credential',
          credential_configurations_supported: {
            MyDegree: {
              format: 'jwt_vc_json',
              credential_definition: { type: ['VerifiableCredential', 'UniversityDegree'] },
            },
          },
        },
      },
    };

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, Record<string, unknown>>;
    // specificType = 'UniversityDegree' (non-absolute), combined with credIssuerUrl
    expect(configs.MyDegree.vct).toBe('https://issuer.example.com/UniversityDegree');
  });

  test('skips unknown config IDs not present in credential_configurations_supported', () => {
    const raw = {
      offeredCredentialConfigurations: {},
      credentialOfferPayload: { credential_configuration_ids: ['UNKNOWN'] },
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://issuer.example.com',
          credential_endpoint: 'https://issuer.example.com/credential',
          credential_configurations_supported: {
            PID: { format: 'dc+sd-jwt', vct: 'https://issuer.example.com/PID' },
          },
        },
      },
    };

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, unknown>;
    // UNKNOWN not in supported configs → nothing injected → configs stay empty
    expect(Object.keys(configs)).toHaveLength(0);
  });
});

describe('normalizeOffer — Patch 2: inject proof_types_supported', () => {
  test('injects proof_types_supported when missing, using credential_signing_alg_values_supported', () => {
    const raw = makeConformantOffer({
      offeredCredentialConfigurations: {
        PID: {
          format: 'dc+sd-jwt',
          vct: 'https://issuer.example.com/PID',
          credential_signing_alg_values_supported: ['EdDSA'],
          // deliberately no proof_types_supported
        },
      },
    });

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, Record<string, unknown>>;
    const pts = configs.PID.proof_types_supported as Record<string, unknown>;
    expect(pts).toBeDefined();
    const jwt = pts.jwt as Record<string, unknown>;
    expect((jwt.proof_signing_alg_values_supported as string[])).toContain('EdDSA');
  });

  test('injects proof_types_supported with default algs when no signing algs provided', () => {
    const raw = makeConformantOffer({
      offeredCredentialConfigurations: {
        PID: {
          format: 'dc+sd-jwt',
          vct: 'https://issuer.example.com/PID',
          // no proof_types_supported, no signing algs
        },
      },
    });

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, Record<string, unknown>>;
    const pts = configs.PID.proof_types_supported as Record<string, unknown>;
    expect(pts).toBeDefined();
    const algs = (pts.jwt as Record<string, string[]>).proof_signing_alg_values_supported;
    expect(algs).toContain('ES256');
  });

  test('does not overwrite existing proof_types_supported', () => {
    const raw = makeConformantOffer(); // PID already has proof_types_supported: { jwt: { algs: ['ES256'] } }

    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, Record<string, unknown>>;
    const algs = (
      (configs.PID.proof_types_supported as Record<string, Record<string, string[]>>)
        .jwt.proof_signing_alg_values_supported
    );
    expect(algs).toEqual(['ES256']);
  });
});

describe('normalizeOffer — Patch 3: downgrade Draft15 → Draft14 for legacy endpoints', () => {
  test('downgrades originalDraftVersion when credential_endpoint contains /draft13', () => {
    const raw = makeConformantOffer({
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://walt.id/draft13',
          credential_endpoint: 'https://walt.id/draft13/credential',
        },
      },
    });

    const result = normalizeOffer(raw as never);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.originalDraftVersion).toBe('Draft14');
  });

  test('downgrades when issuer base URL contains /draft14', () => {
    const raw = makeConformantOffer({
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://issuer.example.com/draft14',
          credential_endpoint: 'https://issuer.example.com/draft14/credential',
        },
      },
    });

    const result = normalizeOffer(raw as never);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.originalDraftVersion).toBe('Draft14');
  });

  test('does not downgrade when endpoint is conformant (no /draft13 or /draft14)', () => {
    const raw = makeConformantOffer({
      metadata: {
        originalDraftVersion: 'Draft15',
        credentialIssuer: {
          credential_issuer: 'https://conformant-issuer.example.com',
          credential_endpoint: 'https://conformant-issuer.example.com/credential',
        },
      },
    });

    const result = normalizeOffer(raw as never);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.originalDraftVersion).toBe('Draft15');
  });

  test('does not downgrade a Draft13 offer even with legacy endpoint', () => {
    // Downgrade only applies when originalDraftVersion is already 'Draft15'
    const raw = makeConformantOffer({
      metadata: {
        originalDraftVersion: 'Draft13',
        credentialIssuer: {
          credential_issuer: 'https://walt.id/draft13',
          credential_endpoint: 'https://walt.id/draft13/credential',
        },
      },
    });

    const result = normalizeOffer(raw as never);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta.originalDraftVersion).toBe('Draft13');
  });
});

describe('normalizeOffer — conformant offer is passed through unchanged', () => {
  test('returns offer with all original configs intact when already conformant', () => {
    const raw = makeConformantOffer();
    const result = normalizeOffer(raw as never);
    const configs = result.offeredCredentialConfigurations as Record<string, unknown>;
    expect(Object.keys(configs)).toContain('PID');
  });
});
