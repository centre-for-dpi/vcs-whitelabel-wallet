import { DidsApi, Kms } from '@credo-ts/core';
import type { OpenId4VciCredentialBindingOptions, OpenId4VcCredentialHolderBinding } from '@credo-ts/openid4vc';
import { keyAttestationConfig } from '../../branding.config';
import {
  assertCanSatisfy,
  getKeyAttestationRequirement,
  shouldAttachKeyAttestation,
} from './keyAttestation/requirements';
import { requestKeyAttestation } from './keyAttestation/walletProviderClient';

export const credentialBindingResolver = async ({
  agentContext,
  supportsJwk,
  supportsAllDidMethods,
  supportedDidMethods,
  proofTypes,
  cNonce,
}: OpenId4VciCredentialBindingOptions): Promise<OpenId4VcCredentialHolderBinding> => {
  const kms = agentContext.dependencyManager.resolve(Kms.KeyManagementApi);
  const algorithms = proofTypes.jwt?.supportedSignatureAlgorithms ?? [];
  const algorithm = algorithms[0] ?? 'EdDSA';

  // Fail early with a clear message when the issuer demands a key attestation
  // this wallet cannot provide (even with the toggle off).
  const attestationReq = getKeyAttestationRequirement(proofTypes);
  assertCanSatisfy(attestationReq, keyAttestationConfig);

  if (shouldAttachKeyAttestation(attestationReq, keyAttestationConfig) && (supportsJwk || attestationReq)) {
    const attestationAlgorithm =
      (proofTypes.attestation ?? proofTypes.jwt)?.supportedSignatureAlgorithms?.[0] ?? 'EdDSA';
    const { publicJwk, keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm: attestationAlgorithm });
    // Credo maps attested keys back to KMS keys by `kid`.
    const attestedKey = { ...publicJwk, kid: keyId };
    const keyAttestationJwt = await requestKeyAttestation({
      walletProviderUrl: keyAttestationConfig.walletProviderUrl,
      attestedKey,
      nonce: cNonce,
      keyStorage: keyAttestationConfig.keyStorage,
    });
    return { method: 'attestation', keyAttestationJwt };
  }

  if (supportsJwk) {
    const { publicJwk } = await kms.createKeyForSignatureAlgorithm({ algorithm });
    return { method: 'jwk', keys: [Kms.PublicJwk.fromUnknown(publicJwk)] };
  }

  const canUseDid = supportsAllDidMethods || supportedDidMethods?.includes('did:key');
  if (canUseDid) {
    const didsApi = agentContext.dependencyManager.resolve(DidsApi);
    const { keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm });
    const result = await didsApi.create({ method: 'key', options: { keyId } });
    const vmEntry = result.didState.didDocument?.verificationMethod?.[0];
    const vmId = typeof vmEntry === 'string' ? vmEntry : vmEntry?.id;
    if (!vmId) throw new Error(`No se pudo crear el did:key (state=${result.didState.state}).`);
    return { method: 'did', didUrls: [vmId] };
  }

  throw new Error(
    `El emisor no soporta ningún método de vinculación compatible. supportsJwk=${supportsJwk}, supportedDidMethods=${JSON.stringify(supportedDidMethods)}`,
  );
};
