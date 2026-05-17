// Mock @credo-ts/core before any imports so the real (native) package is never loaded.
jest.mock('@credo-ts/core', () => ({
  ClaimFormat: { SdJwtDc: 'dc+sd-jwt', JwtVp: 'jwt_vp', JwtVc: 'jwt_vc' },
  SdJwtVcRecord: class {},
}));

// Mock i18n — selectCredentials uses it only for error messages.
jest.mock('../i18n', () => ({
  default: {
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  },
}));

import { selectCredentialsForRequest } from '../agent/oid4vp/selectCredentials';

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSdJwtRecord(
  id: string,
  prettyClaims: Record<string, unknown>,
  tags: Record<string, unknown> = {},
) {
  return { id, firstCredential: { prettyClaims }, getTags: () => tags };
}

function makeAgent(sdJwtRecords: ReturnType<typeof makeSdJwtRecord>[], dcqlResult: unknown = {}) {
  return {
    sdJwtVc: { getAll: jest.fn().mockResolvedValue(sdJwtRecords) },
    modules: {
      openid4vc: {
        holder: { selectCredentialsForDcqlRequest: jest.fn().mockReturnValue(dcqlResult) },
      },
    },
  };
}

// Builds a minimal PEX resolved request with one descriptor
function makePexRequest(
  descriptorId: string,
  vctConstraintPath: '$.vct' | '$.vc.type' | null,
  vctPattern: string | null,
) {
  const fields =
    vctConstraintPath && vctPattern
      ? [{ path: [vctConstraintPath], filter: { pattern: vctPattern } }]
      : [];
  return {
    presentationExchange: {
      credentialsForRequest: {},
      definition: {
        id: 'pd-1',
        input_descriptors: [{ id: descriptorId, constraints: { fields } }],
      },
    },
  };
}

// Builds a minimal DCQL resolved request
function makeDcqlRequest(canBeSatisfied: boolean, vctValues: string[] = []) {
  return {
    dcql: {
      queryResult: {
        can_be_satisfied: canBeSatisfied,
        credentials: [
          { id: 'cred-1', meta: { vct_values: vctValues } },
        ],
      },
      dcqlQuery: { credentials: [] },
    },
  };
}

// ── PEX path ──────────────────────────────────────────────────────────────────

describe('selectCredentialsForRequest — PEX path', () => {
  test('matches a credential by prettyClaims.vct (conformant dc+sd-jwt)', async () => {
    const record = makeSdJwtRecord('rec-1', { vct: 'https://issuer.example.com/PID', sub: 'user-1' });
    const agent = makeAgent([record]);
    const request = makePexRequest('pid-desc', '$.vct', 'PID');

    const result = await selectCredentialsForRequest(agent as never, request as never);

    expect(result.presentationExchange).toBeDefined();
    const creds = result.presentationExchange!.credentials;
    expect(Object.keys(creds)).toContain('pid-desc');
    expect(creds['pid-desc'][0].credentialRecord).toBe(record);
  });

  test('matches a credential by credentialVct tag (legacy/W3C-wrapped issuer)', async () => {
    // prettyClaims has no vct → falls back to credentialVct tag
    const record = makeSdJwtRecord(
      'rec-2',
      { iat: 1234567890, iss: 'https://issuer.example.com' },
      { credentialVct: 'https://issuer.example.com/PID' },
    );
    const agent = makeAgent([record]);
    const request = makePexRequest('pid-desc', '$.vct', 'PID');

    const result = await selectCredentialsForRequest(agent as never, request as never);

    expect(result.presentationExchange!.credentials['pid-desc'][0].credentialRecord).toBe(record);
  });

  test('matches a credential by vc.type array (jwt_vc_json / W3C format)', async () => {
    const record = makeSdJwtRecord('rec-3', {
      vc: { type: ['VerifiableCredential', 'UniversityDegree'], credentialSubject: {} },
    });
    const agent = makeAgent([record]);
    const request = makePexRequest('degree-desc', '$.vc.type', 'UniversityDegree');

    const result = await selectCredentialsForRequest(agent as never, request as never);

    expect(result.presentationExchange!.credentials['degree-desc'][0].credentialRecord).toBe(record);
  });

  test('matches any credential when descriptor has no vct constraint', async () => {
    const record = makeSdJwtRecord('rec-4', { vct: 'https://any.example.com/Anything', sub: 'u' });
    const agent = makeAgent([record]);
    // No filter fields → vctPattern is undefined → matchesVct returns true for any record
    const request = makePexRequest('generic-desc', null, null);

    const result = await selectCredentialsForRequest(agent as never, request as never);

    expect(result.presentationExchange!.credentials['generic-desc']).toHaveLength(1);
  });

  test('throws when no wallet credential matches the descriptor vct', async () => {
    const record = makeSdJwtRecord('rec-5', { vct: 'https://issuer.example.com/DriversLicense' });
    const agent = makeAgent([record]);
    const request = makePexRequest('pid-desc', '$.vct', 'PID'); // wallet only has DriversLicense

    await expect(
      selectCredentialsForRequest(agent as never, request as never),
    ).rejects.toThrow();
  });

  test('throws when wallet is empty', async () => {
    const agent = makeAgent([]);
    const request = makePexRequest('pid-desc', '$.vct', 'PID');

    await expect(
      selectCredentialsForRequest(agent as never, request as never),
    ).rejects.toThrow();
  });

  test('disclosed payload contains all prettyClaims fields', async () => {
    const claims = { vct: 'https://issuer.example.com/PID', given_name: 'Ana', family_name: 'Lopez' };
    const record = makeSdJwtRecord('rec-6', claims);
    const agent = makeAgent([record]);
    const request = makePexRequest('pid-desc', '$.vct', 'PID');

    const result = await selectCredentialsForRequest(agent as never, request as never);

    expect(result.presentationExchange!.credentials['pid-desc'][0].disclosedPayload).toEqual(claims);
  });
});

// ── DCQL path ─────────────────────────────────────────────────────────────────

describe('selectCredentialsForRequest — DCQL path', () => {
  test('delegates to agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest when satisfied', async () => {
    const mockDcqlResult = { 'cred-1': [{ record: {} }] };
    const agent = makeAgent([], mockDcqlResult);
    const request = makeDcqlRequest(true, ['https://issuer.example.com/PID']);

    const result = await selectCredentialsForRequest(agent as never, request as never);

    expect(agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest).toHaveBeenCalledWith(
      request.dcql.queryResult,
    );
    expect(result.dcql).toBeDefined();
    expect(result.dcql!.credentials).toBe(mockDcqlResult);
  });

  test('throws a meaningful error when can_be_satisfied is false', async () => {
    const record = makeSdJwtRecord('rec-7', { vct: 'https://issuer.example.com/DriversLicense' });
    const agent = makeAgent([record]);
    const request = makeDcqlRequest(false, ['https://issuer.example.com/PID']);

    await expect(
      selectCredentialsForRequest(agent as never, request as never),
    ).rejects.toThrow();
  });

  test('does not call agent DCQL selector when can_be_satisfied is false', async () => {
    const agent = makeAgent([]);
    const request = makeDcqlRequest(false, ['https://issuer.example.com/PID']);

    await selectCredentialsForRequest(agent as never, request as never).catch(() => {});

    expect(agent.modules.openid4vc.holder.selectCredentialsForDcqlRequest).not.toHaveBeenCalled();
  });
});

// ── no-op when neither PEX nor DCQL ──────────────────────────────────────────

describe('selectCredentialsForRequest — neither PEX nor DCQL', () => {
  test('returns empty result when the request has neither presentationExchange nor dcql', async () => {
    const agent = makeAgent([]);
    const result = await selectCredentialsForRequest(agent as never, {} as never);
    expect(result.presentationExchange).toBeUndefined();
    expect(result.dcql).toBeUndefined();
  });
});
