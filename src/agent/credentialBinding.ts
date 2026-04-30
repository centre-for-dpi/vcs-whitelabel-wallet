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
    const result = await didsApi.create({ method: 'key' });
    const vm = result.didDocument?.verificationMethod?.[0];
    if (!vm?.id) throw new Error('No se pudo crear el did:key para la credencial.');
    return { method: 'did', didUrls: [vm.id] };
  }

  throw new Error(
    `El emisor no soporta ningún método de vinculación compatible. supportsJwk=${supportsJwk}, supportedDidMethods=${JSON.stringify(supportedDidMethods)}`,
  );
};
