import { DidsApi, Kms, TypedArrayEncoder } from '@credo-ts/core';
import type { WalletAgent } from '../setup';
import type { OpenId4VciResolvedCredentialOffer } from '@credo-ts/openid4vc';
import { credentialBindingResolver } from '../credentialBinding';

export type TokenResponse = {
  accessToken: string;
  cNonce?: string;
  dpop?: unknown;
};

/** Credential obtained via the dc+sd-jwt manual POST path. */
export type DcSdJwtResult = {
  path: 'dc+sd-jwt';
  configId: string;
  displayName?: string;
  compactJwt: string;
  keyId: string;
  vct: string;
};

/**
 * Credential obtained via manual POST for non-dc+sd-jwt formats on legacy endpoints.
 * Credo's requestCredentials path is bypassed because those issuers return JWTs that
 * fail Credo's strict W3C JWT validation (e.g. missing nbf/iss claims).
 */
export type ManualJwtResult = {
  path: 'manual-jwt';
  format: string;         // e.g. 'jwt_vc_json', 'vc+sd-jwt'
  configId: string;
  displayName?: string;
  compactJwt: string;
  keyId: string;
  credentialType: string; // specific type, e.g. 'AlumniCard'
};

/** Credential obtained via Credo's standard requestCredentials path. */
export type CredoResult = {
  path: 'credo';
  configId: string;
  record: unknown;
};

export type CredentialResult = DcSdJwtResult | ManualJwtResult | CredoResult;

/**
 * Returns true when the issuer is known to produce non-conformant credential responses
 * that bypass Credo's strict JWT/W3C validation. Detection is based on the credential
 * endpoint URL path (e.g. /draft13, /draft14).
 */
function isLegacyEndpoint(offer: Record<string, unknown>): boolean {
  const meta = offer.metadata as Record<string, unknown> | undefined;
  const issuerMeta = meta?.credentialIssuer as Record<string, unknown> | undefined;
  const urls = [
    issuerMeta?.credential_endpoint as string | undefined,
    issuerMeta?.credential_issuer as string | undefined,
  ];
  // HTTP issuers also use the manual path: Credo's internal proof JWT validator
  // rejects http:// in the `aud` claim regardless of the requireHttps app setting.
  return urls.some((u) => u?.includes('/draft13') || u?.includes('/draft14') || u?.startsWith('http://'));
}

/**
 * Builds the OID4VCI proof JWT for a given key and nonce.
 */
async function buildProofJwt(
  agent: WalletAgent,
  issuerUrl: string,
  cNonce: string,
): Promise<{ proofJwt: string; keyId: string }> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const didsApi = agent.dependencyManager.resolve(DidsApi);
  const { keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm: 'EdDSA' });
  const didResult = await didsApi.create({ method: 'key', options: { keyId } });
  const vmEntry = didResult.didState.didDocument?.verificationMethod?.[0];
  const vmId = typeof vmEntry === 'string' ? vmEntry : vmEntry?.id;
  if (!vmId) throw new Error('No se pudo crear el did:key para la credencial.');

  const h64 = TypedArrayEncoder.toBase64URL(
    TypedArrayEncoder.fromString(JSON.stringify({ alg: 'EdDSA', kid: vmId, typ: 'openid4vci-proof+jwt' })),
  );
  const p64 = TypedArrayEncoder.toBase64URL(
    TypedArrayEncoder.fromString(
      JSON.stringify({ nonce: cNonce, aud: issuerUrl, iat: Math.floor(Date.now() / 1000) }),
    ),
  );
  const { signature } = await kms.sign({
    keyId,
    algorithm: 'EdDSA',
    data: TypedArrayEncoder.fromString(`${h64}.${p64}`),
  });
  return { proofJwt: `${h64}.${p64}.${TypedArrayEncoder.toBase64URL(signature)}`, keyId };
}

/**
 * Requests credentials from the issuer after a successful token exchange.
 *
 * dc+sd-jwt and, for legacy endpoints, all other formats use a manual fetch() POST
 * to bypass Credo's internal JWT validators that reject non-conformant issuer responses.
 *
 * Conformant issuers for non-dc+sd-jwt formats go through Credo's standard path.
 */
export async function requestOid4VciCredentials(
  agent: WalletAgent,
  offer: Record<string, unknown>,
  tokenResp: TokenResponse,
): Promise<CredentialResult[]> {
  const offerObj = offer as unknown as OpenId4VciResolvedCredentialOffer;
  const { accessToken, cNonce = '', dpop } = tokenResp;
  const holder = agent.modules.openid4vc.holder;
  const configs = Object.entries(offerObj.offeredCredentialConfigurations ?? {}) as [string, Record<string, unknown>][];
  const legacy = isLegacyEndpoint(offer);

  const meta = offerObj.metadata as unknown as Record<string, unknown>;
  const issuerMeta = meta.credentialIssuer as Record<string, unknown>;
  const issuerUrl = issuerMeta.credential_issuer as string;
  const credentialEndpoint = issuerMeta.credential_endpoint as string;

  const results: CredentialResult[] = [];

  for (const [configId, config] of configs) {
    const format = config.format as string;

    const displayName = (config.display as Array<Record<string, string>> | undefined)?.[0]?.name;

    if (format === 'dc+sd-jwt' && legacy) {
      // ── dc+sd-jwt on legacy endpoints: manual POST ────────────────────────────
      // Some issuers (e.g. CREDEBL) advertise dc+sd-jwt in metadata but only accept
      // vc+sd-jwt on the credential endpoint. Try dc+sd-jwt first, fall back to vc+sd-jwt.
      const vct = config.vct as string;
      const { proofJwt, keyId } = await buildProofJwt(agent, issuerUrl, cNonce);

      const tryFormat = async (fmt: string) =>
        fetch(credentialEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ format: fmt, vct, proof: { proof_type: 'jwt', jwt: proofJwt } }),
        });

      console.log('[oid4vci] POST dc+sd-jwt (legacy) — configId:', configId, 'vct:', vct);
      let response = await tryFormat('dc+sd-jwt');
      if (!response.ok) {
        const bodyText = await response.text();
        let isUnsupported = false;
        try { isUnsupported = (JSON.parse(bodyText) as Record<string, string>).error === 'unsupported_credential_format'; } catch { /* ignore */ }
        if (response.status === 400 && isUnsupported) {
          console.log('[oid4vci] dc+sd-jwt not supported, retrying with vc+sd-jwt');
          response = await tryFormat('vc+sd-jwt');
        }
        if (!response.ok) {
          throw new Error(`Error al solicitar credencial dc+sd-jwt (${response.status}): ${bodyText}`);
        }
      }
      const data = await response.json() as Record<string, unknown>;
      if (data.transaction_id) {
        throw new Error('El emisor respondió con una credencial diferida. Inténtalo de nuevo en unos segundos.');
      }
      const compactJwt = (data.credential ?? (data.credentials as string[] | undefined)?.[0]) as string | undefined;
      if (!compactJwt) throw new Error('El emisor no retornó una credencial en la respuesta.');
      logJwtStructure('[oid4vci]', compactJwt);
      results.push({ path: 'dc+sd-jwt', configId, displayName, compactJwt, keyId, vct });

    } else if (legacy) {
      // ── Other formats on legacy endpoints: manual POST ─────────────────────────
      // Credo's requestCredentials throws "JWT does not contain valid 'nbf' and 'iss'
      // claims" for these issuers because their credential response is non-conformant.
      const credDef = config.credential_definition as Record<string, unknown> | undefined;
      const types = (credDef?.type as string[] | undefined) ?? [];
      const credentialType = types.filter((t) => t !== 'VerifiableCredential').pop() ?? configId;

      const requestBody: Record<string, unknown> = { format, proof: {} };
      if (format === 'vc+sd-jwt' && config.vct) {
        requestBody.vct = config.vct;
      } else if (credDef) {
        requestBody.credential_definition = credDef;
      }

      const { proofJwt, keyId } = await buildProofJwt(agent, issuerUrl, cNonce);
      requestBody.proof = { proof_type: 'jwt', jwt: proofJwt };

      console.log('[oid4vci] POST', format, '(legacy) — configId:', configId);
      const response = await fetch(credentialEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        throw new Error(`Error al solicitar credencial ${format} (${response.status}): ${await response.text()}`);
      }
      const data = await response.json() as Record<string, unknown>;
      if (data.transaction_id) {
        throw new Error('El emisor respondió con una credencial diferida. Inténtalo de nuevo en unos segundos.');
      }
      const compactJwt = (data.credential ?? (data.credentials as string[] | undefined)?.[0]) as string | undefined;
      if (!compactJwt) throw new Error('El emisor no retornó una credencial en la respuesta.');
      logJwtStructure('[oid4vci]', compactJwt);
      results.push({ path: 'manual-jwt', format, configId, displayName, compactJwt, keyId, credentialType });
    }
  }

  // ── Conformant issuers: Credo standard path for all non-legacy formats ──────────
  // Includes dc+sd-jwt on non-legacy endpoints; Credo handles DPoP binding and
  // proof format (credential_configuration_id + proofs) automatically.
  const credoConfigs = configs.filter(([]) => !legacy);
  if (credoConfigs.length > 0) {
    const { credentials, deferredCredentials } = await holder.requestCredentials({
      resolvedCredentialOffer: offer as unknown as OpenId4VciResolvedCredentialOffer,
      accessToken,
      cNonce,
      dpop,
      credentialBindingResolver,
    });
    console.log('[oid4vci] requestCredentials returned:', credentials.length,
      'immediate,', deferredCredentials.length, 'deferred');

    let allCredentials = [...credentials];
    for (const deferred of deferredCredentials) {
      const waitMs = Math.min((deferred.interval ?? 5) * 1000, 10_000);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      const result = await holder.requestDeferredCredentials({
        issuerMetadata: offerObj.metadata,
        transactionId: deferred.transactionId,
        credentialConfigurationId: deferred.credentialConfigurationId,
        credentialConfiguration: deferred.credentialConfiguration,
        accessToken,
        dpop,
      });
      allCredentials = [...allCredentials, ...result.credentials];
    }
    for (const item of allCredentials) {
      results.push({ path: 'credo', configId: item.credentialConfigurationId, record: item.record });
    }
  }

  return results;
}

function logJwtStructure(prefix: string, compactJwt: string): void {
  const parts = compactJwt.split('~')[0].split('.');
  console.log(prefix, 'disclosures:', compactJwt.split('~').length - 1);
  try {
    const decode = (b64: string) =>
      atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    console.log(prefix, 'JWT header:', decode(parts[0] ?? '').slice(0, 200));
    console.log(prefix, 'JWT payload:', decode(parts[1] ?? '').slice(0, 2000));
  } catch { /* best-effort */ }
}
