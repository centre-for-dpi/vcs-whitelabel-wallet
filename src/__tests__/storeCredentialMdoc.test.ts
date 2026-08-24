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
  W3cCredentialRecord: class {},
  W3cV2CredentialRecord: class {},
}));

import { MdocRecord } from '@credo-ts/core';
import { storeOid4VciCredential, formatConfigId } from '../agent/oid4vci/storeCredential';
import type { CredentialResult } from '../agent/oid4vci/requestCredentials';
import type { WalletAgent } from '../agent/setup';

type FakeMdocRecordInstance = InstanceType<typeof MdocRecord> & { tags: Record<string, unknown>; type?: string };
const FakeMdocRecord = MdocRecord as unknown as new () => FakeMdocRecordInstance;

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
