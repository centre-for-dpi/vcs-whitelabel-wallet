// @credo-ts/core's ESM build isn't set up to be imported unmocked under Jest
// (see selectCredentials.test.ts's jest.mock for the established pattern).
// storeCredential.ts uses Mdoc/MdocRecord/SdJwtVcRecord/W3cCredentialRecord/
// W3cV2CredentialRecord as real VALUES (instanceof checks, `new`), so all
// five need a mock shape here, not just types. jest.mock's factory is
// hoisted above the rest of this file, so the fake classes must be declared
// INSIDE the factory (as selectCredentials.test.ts's `SdJwtVcRecord: class
// {}` does inline) — a top-level `class FakeMdocRecord {}` referenced from
// inside the factory throws "ReferenceError: Cannot access ... before
// initialization" because the class declaration hasn't run yet when the
// hoisted factory executes.
jest.mock('@credo-ts/core', () => ({
  Mdoc: { fromBase64Url: jest.fn() },
  MdocRecord: class {
    tags: Record<string, unknown> = {};
    id = 'mdoc-record-id';
    setTag(key: string, value: unknown) {
      this.tags[key] = value;
    }
  },
  SdJwtVcRecord: class {},
  W3cCredentialRecord: class {
    id = 'w3c-record-id';
    credentialInstances: unknown;
    constructor(opts: { credentialInstances: unknown }) {
      this.credentialInstances = opts.credentialInstances;
    }
  },
  W3cV2CredentialRecord: class {},
}));

import { MdocRecord, W3cCredentialRecord } from '@credo-ts/core';
import { storeOid4VciCredential, formatConfigId } from '../agent/oid4vci/storeCredential';
import type { CredentialResult } from '../agent/oid4vci/requestCredentials';
import type { WalletAgent } from '../agent/setup';

type FakeMdocRecordInstance = InstanceType<typeof MdocRecord> & { tags: Record<string, unknown>; type?: string };
const FakeMdocRecord = MdocRecord as unknown as new () => FakeMdocRecordInstance;

type FakeW3cCredentialRecordInstance = InstanceType<typeof W3cCredentialRecord> & {
  credentialInstances: Array<{ credential: unknown }>;
};

/**
 * The bug this file guards: the 'credo' path (mso_mdoc's only path through
 * this function — see requestCredentials.ts's CredoResult type) called
 * agent.mdoc.store({ record }) with NO setTag calls at all, unlike every
 * other branch in this same function. The offer/accept screen shows the
 * correct issuer and display name (reading straight from the OID4VCI offer
 * metadata, a completely separate code path), but nothing carried that
 * into storage — so re-opening the saved credential fell back to
 * "Unknown Issuer" and formatConfigId(docType)-derived names like "M Dl"
 * instead of the operator's real display name (e.g. "mDL v22").
 */
describe('storeOid4VciCredential — credo/MdocRecord path tags', () => {
  function makeAgent() {
    const stored = new FakeMdocRecord();
    const store = jest.fn().mockResolvedValue(stored);
    const update = jest.fn().mockResolvedValue(undefined);
    const agent = { mdoc: { store, update } } as unknown as WalletAgent;
    return { agent, stored, store, update };
  }

  test('sets issuerName and credentialName (from displayName) on a stored MdocRecord', async () => {
    const { agent, stored, update } = makeAgent();
    const record = new FakeMdocRecord();
    (record as unknown as { type: string }).type = 'MdocRecord';

    const result: CredentialResult = {
      path: 'credo',
      configId: 'org.iso.18013.5.1.mDL',
      displayName: 'mDL v22',
      record,
    };

    await storeOid4VciCredential(agent, result, { issuerName: 'INTRANT' });

    expect(stored.tags.issuerName).toBe('INTRANT');
    expect(stored.tags.credentialName).toBe('mDL v22');
    expect(update).toHaveBeenCalledWith(stored);
  });

  test('falls back to formatConfigId(configId) when displayName is absent — but still tags issuerName', async () => {
    const { agent, stored } = makeAgent();
    const record = new FakeMdocRecord();
    (record as unknown as { type: string }).type = 'MdocRecord';

    const result: CredentialResult = {
      path: 'credo',
      configId: 'org.iso.18013.5.1.mDL',
      record,
      // displayName omitted entirely — the pre-fix fallback path
    };

    await storeOid4VciCredential(agent, result, { issuerName: 'INTRANT' });

    // formatConfigId's mangling of the full mDL docType, reproduced honestly
    // as the fallback's real behavior — not silently "fixed" by guessing a
    // nicer name. displayName being present (tested above) is what avoids
    // it — this branch exists purely as documentation of the exact fallback
    // shape, matching the "M Dl"-style mangling the user reported.
    expect(stored.tags.credentialName).toBe(formatConfigId('org.iso.18013.5.1.mDL'));
    expect(stored.tags.credentialName).toBe('Org.iso.18013.5.1.m Dl');
    expect(stored.tags.issuerName).toBe('INTRANT');
  });

  test('never leaves an mdoc record with zero tags (the actual pre-fix bug)', async () => {
    const { agent, stored } = makeAgent();
    const record = new FakeMdocRecord();
    (record as unknown as { type: string }).type = 'MdocRecord';

    const result: CredentialResult = {
      path: 'credo',
      configId: 'org.iso.18013.5.1.mDL',
      record,
    };

    await storeOid4VciCredential(agent, result, { issuerName: 'INTRANT' });

    expect(Object.keys(stored.tags).length).toBeGreaterThan(0);
  });
});

/**
 * The bug this file guards: requestCredentials.ts's legacy-endpoint branch
 * (isLegacyEndpoint) routed EVERY non-mdoc/non-dc+sd-jwt format — including
 * ldp_vc/jwt_vc_json-ld, real JSON-LD with an embedded `proof`, never a
 * compact JWT — through the same path as jwt_vc_json, which storeCredential.ts
 * always persisted as an SdJwtVcRecord. That made supportsSelectiveDisclosure
 * (credential.ts) key off `format === 'sdjwt'` for a credential that is
 * genuinely W3C JSON-LD with no selective-disclosure mechanism at all — the
 * "Selective disclosure" badge showed for a format that can only ever be a
 * full presentation. Fixed with a dedicated ManualW3cLdResult path
 * (requestCredentials.ts) that stores it as a real W3cCredentialRecord
 * instead.
 */
describe('storeOid4VciCredential — manual-w3c-ld path (ldp_vc/jwt_vc_json-ld)', () => {
  function makeAgent() {
    const store = jest.fn(async (opts: { record: FakeW3cCredentialRecordInstance }) => opts.record);
    const agent = { w3cCredentials: { store } } as unknown as WalletAgent;
    return { agent, store };
  }

  test('stores a real W3cCredentialRecord, not an SdJwtVcRecord, for ldp_vc', async () => {
    const { agent, store } = makeAgent();
    const jsonLdCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiableCredential', 'AlumniCard'],
      issuer: { id: 'did:web:issuer.example.com' },
      issuanceDate: '2026-01-01T00:00:00Z',
      credentialSubject: { claims: { name: 'Ana' } },
      proof: { type: 'Ed25519Signature2020', proofValue: 'z...' },
    };

    const result: CredentialResult = {
      path: 'manual-w3c-ld',
      configId: 'AlumniCard',
      displayName: 'Alumni Card',
      credential: jsonLdCredential,
    };

    await storeOid4VciCredential(agent, result, { issuerName: 'Example University' });

    expect(store).toHaveBeenCalledTimes(1);
    const storedRecord = store.mock.calls[0][0].record;
    expect(storedRecord).toBeInstanceOf(W3cCredentialRecord);
    // The full JSON-LD document (including `proof`) must reach the record
    // as-is — not stringified, not routed through a JWT decoder.
    expect(storedRecord.credentialInstances).toEqual([{ credential: jsonLdCredential }]);
  });

  test('never calls agent.sdJwtVc for a manual-w3c-ld result (the actual pre-fix bug)', async () => {
    const sdJwtStore = jest.fn();
    const w3cStore = jest.fn(async (opts: { record: unknown }) => opts.record);
    const agent = {
      sdJwtVc: { store: sdJwtStore, update: jest.fn() },
      w3cCredentials: { store: w3cStore },
    } as unknown as WalletAgent;

    const result: CredentialResult = {
      path: 'manual-w3c-ld',
      configId: 'AlumniCard',
      credential: { '@context': [], type: ['VerifiableCredential'], proof: {} },
    };

    await storeOid4VciCredential(agent, result, { issuerName: 'Example University' });

    expect(sdJwtStore).not.toHaveBeenCalled();
    expect(w3cStore).toHaveBeenCalledTimes(1);
  });
});
