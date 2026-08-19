import { Mdoc, MdocRecord, SdJwtVcRecord, W3cCredentialRecord, W3cV2CredentialRecord } from '@credo-ts/core';
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
    stored.setTag('credentialName', displayName ?? formatConfigId(credentialType));
    stored.setTag('credentialVct', credentialType);
    stored.setTag('holderKeyId', keyId);
    await agent.sdJwtVc.update(stored);
    console.log('[oid4vci] stored manual-jwt id:', stored.id, 'type:', credentialType);
    return;
  }

  if (result.path === 'manual-mdoc') {
    // mso_mdoc (ISO/IEC 18013-5, e.g. mDL) from a legacy endpoint's manual POST path:
    // the credential is raw base64url IssuerSigned CBOR, not a JWT — build an Mdoc
    // from it directly (mirrors MdocRecord.fromMdoc, but deviceKeyId must be set
    // explicitly since this credential never went through Credo's own requestCredentials/
    // credentialBindingResolver, which is what populates it in the 'credo' path below).
    const { credential, keyId, docType, configId, displayName } = result;
    const mdoc = Mdoc.fromBase64Url(credential, docType);
    mdoc.deviceKeyId = keyId;
    const stored = await agent.mdoc.store({ record: MdocRecord.fromMdoc(mdoc) });
    stored.setTag('issuerName', meta.issuerName);
    stored.setTag('credentialName', displayName ?? formatConfigId(configId));
    await agent.mdoc.update(stored);
    console.log('[oid4vci] stored manual-mdoc id:', stored.id, 'docType:', docType);
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
    const prettyClaims = stored.prettyClaims as Record<string, unknown> | undefined;
    const vct = prettyClaims?.vct as string | undefined;
    if (vct) stored.setTag('credentialVct', vct);
    const holderKeyId = (stored as unknown as { credentialInstances?: Array<{ kmsKeyId?: string }> })
      .credentialInstances?.[0]?.kmsKeyId;
    if (holderKeyId) stored.setTag('holderKeyId', holderKeyId);
    await agent.sdJwtVc.update(stored);
    console.log('[oid4vci] stored SdJwtVcRecord id:', stored.id, 'vct:', vct);
  } else if (recordType === 'W3cV2CredentialRecord' || record instanceof W3cV2CredentialRecord) {
    await agent.w3cV2Credentials.store({ record: record as W3cV2CredentialRecord });
    console.log('[oid4vci] stored W3cV2CredentialRecord');
  } else if (recordType === 'W3cCredentialRecord' || record instanceof W3cCredentialRecord) {
    await agent.w3cCredentials.store({ record: record as W3cCredentialRecord });
    console.log('[oid4vci] stored W3cCredentialRecord');
  } else if (recordType === 'MdocRecord' || record instanceof MdocRecord) {
    // mso_mdoc (ISO/IEC 18013-5, e.g. mDL): Credo's own holder.requestCredentials
    // already parsed the response and resolved credentialInstances[0].kmsKeyId
    // from the jwk binding credentialBindingResolver returned — cose_key-only
    // issuers (like walt.id's mDL catalog entry) are treated as jwk-capable by
    // Credo itself (OpenId4VciHolderService: supportsJwk includes cose_key), so
    // no separate binding path was needed here. This record is ready to
    // persist as-is; unlike the SD-JWT/W3C branches above, mdoc has no
    // sensible 'issuerName'/'credentialName' tag scheme of its own yet — add
    // tags here if/when the mDL presentation UI needs to filter by them.
    const stored = await agent.mdoc.store({ record: record as MdocRecord });
    console.log('[oid4vci] stored MdocRecord id:', stored.id);
  } else {
    console.warn('[oid4vci] unknown record type, not stored:', recordType);
  }
}
