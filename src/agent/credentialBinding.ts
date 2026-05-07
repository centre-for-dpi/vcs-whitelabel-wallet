import { DidsApi, Kms } from '@credo-ts/core';
import type { OpenId4VciCredentialBindingOptions, OpenId4VcCredentialHolderBinding } from '@credo-ts/openid4vc';

export const credentialBindingResolver = async ({
  agentContext,
  supportsJwk,
  supportsAllDidMethods,
  supportedDidMethods,
  proofTypes,
}: OpenId4VciCredentialBindingOptions): Promise<OpenId4VcCredentialHolderBinding> => {
  const kms = agentContext.dependencyManager.resolve(Kms.KeyManagementApi);
  const algorithms = proofTypes.jwt?.supportedSignatureAlgorithms ?? [];
  const algorithm = algorithms[0] ?? 'EdDSA';

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
