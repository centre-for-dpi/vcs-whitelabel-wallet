import { DidsApi, Kms, TypedArrayEncoder } from '@credo-ts/core';
import type { WalletAgent } from '../setup';
import type { OpenId4VciResolvedCredentialOffer } from '@credo-ts/openid4vc';
import { credentialBindingResolver } from '../credentialBinding';

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

async function fetchWithTimeout(url: string, opts: RequestInit, ms = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

/**
 * Credential obtained via manual POST for mso_mdoc on legacy endpoints.
 * Unlike ManualJwtResult, the credential endpoint returns raw base64url-encoded
 * IssuerSigned CBOR (ISO/IEC 18013-5), not a compact JWT — it must not be parsed
 * as one (storeCredential.ts builds an Mdoc/MdocRecord from this instead).
 */
export type ManualMdocResult = {
  path: 'manual-mdoc';
  configId: string;
  displayName?: string;
  credential: string; // base64url IssuerSigned CBOR
  keyId: string;
  docType: string;
};

/** Credential obtained via Credo's standard requestCredentials path. */
export type CredoResult = {
  path: 'credo';
  configId: string;
  record: unknown;
};

export type CredentialResult = DcSdJwtResult | ManualJwtResult | ManualMdocResult | CredoResult;

/**
 * Returns true when the issuer is known to produce non-conformant credential responses
 * or requires a custom proof JWT format that Credo's standard path doesn't handle.
 * Detection is based on the credential endpoint URL path.
 */
function isLegacyEndpoint(offer: Record<string, unknown>): boolean {
  const meta = offer.metadata as Record<string, unknown> | undefined;
  const issuerMeta = meta?.credentialIssuer as Record<string, unknown> | undefined;
  const urls = [
    issuerMeta?.credential_endpoint as string | undefined,
    issuerMeta?.credential_issuer as string | undefined,
  ];
  // HTTP issuers: Credo's internal proof JWT validator rejects http:// in the `aud` claim.
  // /draft13, /draft14: legacy walt.id / CREDEBL style endpoints.
  // /v1/certify/: INJI Certify — Credo's proof JWT (no `iss` claim) fails INJI's parser.
  return urls.some(
    (u) =>
      u?.includes('/draft13') ||
      u?.includes('/draft14') ||
      u?.startsWith('http://') ||
      u?.includes('/v1/certify/'),
  );
}

type ProofOptions = { algorithm: string; useJwk: boolean };

// Algorithms supported by the Askar KMS backend in React Native (no RSA).
const KMS_SUPPORTED_ALGS = ['EdDSA', 'ES256', 'ES256K', 'ES384', 'ES512'];

function proofOptionsFromConfig(config: Record<string, unknown>): ProofOptions {
  const proofJwt = (config.proof_types_supported as Record<string, unknown> | undefined)
    ?.jwt as Record<string, unknown> | undefined;
  const issuerAlgs = (proofJwt?.proof_signing_alg_values_supported as string[] | undefined) ?? [];
  const bindingMethods = config.cryptographic_binding_methods_supported as string[] | undefined;
  // Pick the first issuer algorithm that our KMS can handle; fall back to EdDSA.
  const algorithm = issuerAlgs.find((a) => KMS_SUPPORTED_ALGS.includes(a)) ?? 'EdDSA';
  return {
    algorithm,
    // 'cose_key' (mdoc/mDL's binding method, e.g. org.iso.18013.5.1.mDL) is a
    // JWK-shaped key the same way 'jwk' is — Credo's own OpenId4VciHolderService
    // treats them identically (supportsJwk includes cose_key). This legacy path
    // didn't, so an mdoc offer through a /draft13 issuer (isLegacyEndpoint above)
    // fell through to did:key binding, which walt.id's mdoc issuer can't extract
    // a holder key from (its proof parser only reads an embedded jwk from the JWT
    // header for non-cwt proofs) — 400 invalid_or_missing_proof, "No holder key
    // could be extracted from proof". Confirmed live: captured the real proof
    // JWT sent to walt-issuer and its header carried kid: did:key:... with no
    // jwk field at all.
    useJwk: (bindingMethods?.includes('jwk') || bindingMethods?.includes('cose_key')) ?? false,
  };
}

/**
 * Builds the OID4VCI proof JWT for a given key and nonce.
 * Uses JWK binding (jwk header) when requested, DID binding otherwise.
 */
async function buildProofJwt(
  agent: WalletAgent,
  issuerUrl: string,
  cNonce: string,
  opts: ProofOptions = { algorithm: 'EdDSA', useJwk: false },
): Promise<{ proofJwt: string; keyId: string }> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const { algorithm, useJwk } = opts;

  if (useJwk) {
    const { publicJwk, keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm });
    // Strip Credo-internal fields (kid, key_ops, use, ext) — INJI's Nimbus parser rejects
    // a jwk header parameter that contains non-cryptographic metadata fields.
    const { kid: _kid, key_ops: _ko, use: _use, ext: _ext, ...cleanJwk } =
      publicJwk as Record<string, unknown>;
    const h64 = TypedArrayEncoder.toBase64URL(
      TypedArrayEncoder.fromString(JSON.stringify({ alg: algorithm, jwk: cleanJwk, typ: 'openid4vci-proof+jwt' })),
    );
    const p64 = TypedArrayEncoder.toBase64URL(
      TypedArrayEncoder.fromString(
        JSON.stringify({ nonce: cNonce, aud: issuerUrl, iat: Math.floor(Date.now() / 1000) }),
      ),
    );
    const { signature } = await kms.sign({ keyId, algorithm, data: TypedArrayEncoder.fromString(`${h64}.${p64}`) });
    return { proofJwt: `${h64}.${p64}.${TypedArrayEncoder.toBase64URL(signature)}`, keyId };
  }

  const didsApi = agent.dependencyManager.resolve(DidsApi);
  const { keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm });
  const didResult = await didsApi.create({ method: 'key', options: { keyId } });
  const vmEntry = didResult.didState.didDocument?.verificationMethod?.[0];
  const vmId = typeof vmEntry === 'string' ? vmEntry : vmEntry?.id;
  if (!vmId) throw new Error('No se pudo crear el did:key para la credencial.');

  const h64 = TypedArrayEncoder.toBase64URL(
    TypedArrayEncoder.fromString(JSON.stringify({ alg: algorithm, kid: vmId, typ: 'openid4vci-proof+jwt' })),
  );
  const p64 = TypedArrayEncoder.toBase64URL(
    TypedArrayEncoder.fromString(
      JSON.stringify({ nonce: cNonce, aud: issuerUrl, iat: Math.floor(Date.now() / 1000) }),
    ),
  );
  const { signature } = await kms.sign({ keyId, algorithm, data: TypedArrayEncoder.fromString(`${h64}.${p64}`) });
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

    const displayName =
      (config.display as Array<Record<string, string>> | undefined)?.[0]?.name ??
      ((config.credential_metadata as Record<string, unknown> | undefined)
        ?.display as Array<Record<string, string>> | undefined)?.[0]?.name;

    if (format === 'dc+sd-jwt' && legacy) {
      // ── dc+sd-jwt on legacy endpoints: manual POST ────────────────────────────
      // Some issuers (e.g. CREDEBL) advertise dc+sd-jwt in metadata but only accept
      // vc+sd-jwt on the credential endpoint. Try dc+sd-jwt first, fall back to vc+sd-jwt.
      const vct = config.vct as string;
      const { proofJwt, keyId } = await buildProofJwt(agent, issuerUrl, cNonce, proofOptionsFromConfig(config));

      const tryFormat = async (fmt: string) =>
        fetchWithTimeout(credentialEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ format: fmt, vct, proof: { proof_type: 'jwt', jwt: proofJwt } }),
        });

      log('[oid4vci] POST dc+sd-jwt (legacy) — configId:', configId, 'vct:', vct);
      let response = await tryFormat('dc+sd-jwt');
      if (!response.ok) {
        const bodyText = await response.text();
        let isUnsupported = false;
        try { isUnsupported = (JSON.parse(bodyText) as Record<string, string>).error === 'unsupported_credential_format'; } catch { /* ignore */ }
        if (response.status === 400 && isUnsupported) {
          log('[oid4vci] dc+sd-jwt not supported, retrying with vc+sd-jwt');
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

    } else if (format === 'mso_mdoc' && legacy) {
      // ── mso_mdoc (mdoc/mDL) on legacy endpoints: manual POST ───────────────────
      // The credential endpoint returns raw base64url IssuerSigned CBOR, not a
      // compact JWT — must not be routed through the manual-jwt/SdJwtVcRecord path
      // below (SdJwtVc.decode threw 'Invalid JWT as input' when it was; confirmed
      // live). See ManualMdocResult and storeCredential.ts's handling of it.
      const docType = config.doctype as string;
      const requestBody: Record<string, unknown> = { format, doctype: docType, proof: {} };

      const { proofJwt, keyId } = await buildProofJwt(agent, issuerUrl, cNonce, proofOptionsFromConfig(config));
      requestBody.proof = { proof_type: 'jwt', jwt: proofJwt };

      log('[oid4vci] POST', format, '(legacy) — configId:', configId);
      const response = await fetchWithTimeout(credentialEndpoint, {
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
      const credential = (data.credential ?? (data.credentials as string[] | undefined)?.[0]) as string | undefined;
      if (!credential) throw new Error('El emisor no retornó una credencial en la respuesta.');
      log('[oid4vci] mso_mdoc credential bytes (base64url):', credential.length);
      results.push({ path: 'manual-mdoc', configId, displayName, credential, keyId, docType });

    } else if (legacy) {
      // ── Other formats on legacy endpoints: manual POST ─────────────────────────
      // Credo's requestCredentials throws "JWT does not contain valid 'nbf' and 'iss'
      // claims" for these issuers because their credential response is non-conformant.
      const credDef = config.credential_definition as Record<string, unknown> | undefined;
      const types = (credDef?.type as string[] | undefined) ?? [];
      const configVct = (format === 'vc+sd-jwt' || format === 'dc+sd-jwt')
        ? (config.vct as string | undefined)?.split('/').pop()
        : undefined;
      const credentialType = types.filter((t) => t !== 'VerifiableCredential').pop() ?? configVct ?? configId;

      const requestBody: Record<string, unknown> = { format, proof: {} };
      if (format === 'vc+sd-jwt' && config.vct) {
        requestBody.vct = config.vct;
      } else if (credDef) {
        requestBody.credential_definition = credDef;
      }

      const { proofJwt, keyId } = await buildProofJwt(agent, issuerUrl, cNonce, proofOptionsFromConfig(config));
      requestBody.proof = { proof_type: 'jwt', jwt: proofJwt };

      log('[oid4vci] POST', format, '(legacy) — configId:', configId);
      const response = await fetchWithTimeout(credentialEndpoint, {
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
    log('[oid4vci] requestCredentials returned:', credentials.length,
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
  log(prefix, 'disclosures:', compactJwt.split('~').length - 1);
  try {
    const decode = (b64: string) =>
      atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    log(prefix, 'JWT header:', decode(parts[0] ?? '').slice(0, 200));
    log(prefix, 'JWT payload:', decode(parts[1] ?? '').slice(0, 2000));
  } catch { /* best-effort */ }
}
