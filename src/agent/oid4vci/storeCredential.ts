import { SdJwtVcRecord, W3cCredentialRecord, W3cV2CredentialRecord } from '@credo-ts/core';
import type { WalletAgent } from '../setup';
import type { CredentialResult } from './requestCredentials';

export type StorageMeta = {
  issuerName: string;
};

/** Formats a credential configuration ID into a human-readable label. */
export const formatConfigId = (id: string): string => {
  const clean = id
    .replace(/#[^#]*$/i, '')
    .replace(/[-_]?(dc\+[a-z-]+|sd[-_]?jwt|jwt[-_]vc[-_]json|jwt[-_]vc|sdjwt|jwt|vc|mdoc)$/i, '');
  return clean
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/**
 * Stores a credential result in the wallet with the appropriate tags.
 *
 * dc+sd-jwt and manual-jwt credentials use a custom 'credentialVct' tag (not 'vct')
 * to avoid collision with SdJwtVcRecord's built-in 'vct' tag, which is derived from
 * prettyClaims.vct and returns undefined for W3C-wrapped walt.id credentials.
 *
 * manual-jwt (e.g. jwt_vc_json from legacy endpoints) is stored as SdJwtVcRecord.
 * The SD-JWT module treats a regular JWT as an SD-JWT with 0 disclosures; prettyClaims
 * returns the full payload, and fromSdJwtRecord's WRAPPER_KEYS flattening handles the
 * W3C vc wrapper. No kmsKeyId is set since jwt_vc_json has no holder binding.
 */
export async function storeOid4VciCredential(
  agent: WalletAgent,
  result: CredentialResult,
  meta: StorageMeta,
): Promise<void> {
  if (result.path === 'dc+sd-jwt') {
    const { compactJwt, keyId, vct, configId, displayName } = result;
    const record = new SdJwtVcRecord({
      credentialInstances: [{ compactSdJwtVc: compactJwt, kmsKeyId: keyId }],
    });
    const stored = await agent.sdJwtVc.store({ record });
    stored.setTag('issuerName', meta.issuerName);
    stored.setTag('credentialName', displayName ?? formatConfigId(configId));
    stored.setTag('credentialVct', vct);
    stored.setTag('holderKeyId', keyId);
    await agent.sdJwtVc.update(stored);
    console.log('[oid4vci] stored dc+sd-jwt id:', stored.id, 'vct:', vct);
    return;
  }

  if (result.path === 'manual-jwt') {
    const { compactJwt, configId, displayName, credentialType, keyId } = result;
    const record = new SdJwtVcRecord({
      credentialInstances: [{ compactSdJwtVc: compactJwt }],
    });
    const stored = await agent.sdJwtVc.store({ record });
    stored.setTag('issuerName', meta.issuerName);
    stored.setTag('credentialName', displayName ?? formatConfigId(configId));
    stored.setTag('credentialVct', credentialType);
    stored.setTag('holderKeyId', keyId);
    await agent.sdJwtVc.update(stored);
    console.log('[oid4vci] stored manual-jwt id:', stored.id, 'type:', credentialType);
    return;
  }

  // Credo-managed path: dispatch by record type
  const { record, configId } = result;
  if (!record) return;

  const recordType = (record as { type?: string }).type;

  if (recordType === 'SdJwtVcRecord' || record instanceof SdJwtVcRecord) {
    const stored = await agent.sdJwtVc.store({ record: record as SdJwtVcRecord });
    stored.setTag('issuerName', meta.issuerName);
    stored.setTag('credentialName', formatConfigId(configId));
    await agent.sdJwtVc.update(stored);
    console.log('[oid4vci] stored SdJwtVcRecord id:', stored.id);
  } else if (recordType === 'W3cV2CredentialRecord' || record instanceof W3cV2CredentialRecord) {
    await agent.w3cV2Credentials.store({ record: record as W3cV2CredentialRecord });
    console.log('[oid4vci] stored W3cV2CredentialRecord');
  } else if (recordType === 'W3cCredentialRecord' || record instanceof W3cCredentialRecord) {
    await agent.w3cCredentials.store({ record: record as W3cCredentialRecord });
    console.log('[oid4vci] stored W3cCredentialRecord');
  } else {
    console.warn('[oid4vci] unknown record type, not stored:', recordType);
  }
}
