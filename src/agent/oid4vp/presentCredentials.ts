import { ClaimFormat, Kms, SdJwtVcRecord, TypedArrayEncoder } from '@credo-ts/core';
import * as ExpoCrypto from 'expo-crypto';
import type { WalletAgent } from '../setup';
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';
import { selectCredentialsForRequest } from './selectCredentials';
import i18n from '../../i18n';

type MatchedItem = {
  descriptorId: string;
  pdFormat: string;       // format key from the PD descriptor (e.g. 'vc+sd-jwt')
  record: SdJwtVcRecord;
  compact: string;
  isConformant: boolean;  // prettyClaims.vct is defined → Credo can handle
  hasDisclosures: boolean;
  holderKeyId?: string;
  holderDid?: string;
};

/**
 * Presents credentials to an OID4VP verifier.
 *
 * Credential routing (based on structure, not PD format):
 *  - Conformant SD-JWT (prettyClaims.vct defined): Credo handles natively.
 *  - W3C-wrapped SD-JWT with disclosures: POST compact SD-JWT directly as vp_token.
 *    Credo's createPresentation fails for these because PEX evaluates $.vct against
 *    prettyClaims, which is undefined for W3C-wrapped credentials from walt.id.
 *  - W3C-wrapped regular JWT (no disclosures): POST as jwt_vp_json wrapping the JWT.
 */
export async function presentCredentials(
  agent: WalletAgent,
  resolved: OpenId4VpResolvedAuthorizationRequest,
): Promise<void> {
  const r = resolved as Record<string, unknown>;
  const pex = r.presentationExchange as Record<string, unknown> | undefined;
  const definition = pex?.definition as Record<string, unknown> | undefined;
  const descriptors = (definition?.input_descriptors as Array<Record<string, unknown>>) ?? [];
  const reqPayload = r.authorizationRequestPayload as Record<string, unknown>;

  const responseUri = (reqPayload.response_uri ?? reqPayload.redirect_uri) as string | undefined;
  const nonce = reqPayload.nonce as string | undefined;
  const state = reqPayload.state as string | undefined;
  const aud = (reqPayload.client_id ?? responseUri) as string;

  if (pex && descriptors.length > 0 && responseUri && nonce) {
    const allSdJwt = await agent.sdJwtVc.getAll();
    const matched: MatchedItem[] = [];

    for (const descriptor of descriptors) {
      const descriptorId = descriptor.id as string;
      const pattern = extractTypePattern(descriptor);
      const record = allSdJwt.find((rec) => matchesType(rec, pattern));
      if (!record) throw new Error(i18n.t('present.no_credential_for', { id: descriptorId }));

      const compact = record.firstCredential.compact;
      const pc = record.firstCredential.prettyClaims as Record<string, unknown>;
      const tags = record.getTags() as Record<string, unknown>;
      // Prefer tag (set on newly issued records); fall back to credentialInstances for older records
      const holderKeyId = (tags.holderKeyId as string | undefined)
        ?? ((record as unknown as { credentialInstances?: Array<{ kmsKeyId?: string }> })
          .credentialInstances?.[0]?.kmsKeyId);

      let holderDid: string | undefined;
      try {
        const b64 = compact.split('~')[0].split('.')[1];
        const payload = JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
        holderDid = payload.sub as string | undefined;
      } catch { /* best-effort */ }

      matched.push({
        descriptorId,
        pdFormat: extractDescriptorFormat(descriptor),
        record,
        compact,
        isConformant: pc.vct !== undefined,
        hasDisclosures: compact.includes('~'),
        holderKeyId,
        holderDid,
      });
      console.log(
        `[oid4vp] matched ${descriptorId} → record ${record.id}`,
        `conformant:${pc.vct !== undefined} disclosures:${compact.includes('~')}`,
      );
    }

    if (matched.every((m) => m.isConformant)) {
      // All conformant → Credo handles natively
      const built: Record<string, Array<{ claimFormat: ClaimFormat; credentialRecord: SdJwtVcRecord; disclosedPayload: Record<string, unknown> }>> = {};
      for (const m of matched) {
        built[m.descriptorId] = [{
          claimFormat: ClaimFormat.SdJwtDc,
          credentialRecord: m.record,
          disclosedPayload: m.record.firstCredential.prettyClaims as Record<string, unknown>,
        }];
      }
      try {
        await agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest({
          authorizationRequestPayload: resolved.authorizationRequestPayload,
          presentationExchange: { credentials: built },
        });
        return;
      } catch (e) {
        // Holder key was issued in a previous wallet session and is no longer in Askar.
        // Fall back to manual posting; KB-JWT will be skipped gracefully if key is absent.
        const isKeyMissing = e instanceof Error && (
          e.name === 'KeyManagementKeyNotFoundError' ||
          e.message.includes('not found in backend')
        );
        if (!isKeyMissing) throw e;
        console.warn('[oid4vp] holder key missing from Askar, falling back to manual SD-JWT posting');
        await postSdJwtPresentation(
          matched.filter((m) => m.hasDisclosures),
          descriptors,
          definition!,
          responseUri,
          nonce,
          state,
          aud,
          agent,
        );
        return;
      }
    }

    // Non-conformant credentials: manual posting
    const sdJwtItems = matched.filter((m) => !m.isConformant && m.hasDisclosures);
    const jwtVcItems = matched.filter((m) => !m.isConformant && !m.hasDisclosures);

    if (sdJwtItems.length > 0 && jwtVcItems.length === 0) {
      await postSdJwtPresentation(sdJwtItems, descriptors, definition!, responseUri, nonce, state, aud, agent);
      return;
    }
    if (jwtVcItems.length > 0 && sdJwtItems.length === 0) {
      await postJwtVpPresentation(agent, jwtVcItems, definition!, responseUri, nonce, state, aud);
      return;
    }
    throw new Error(i18n.t('present.mixed_format_error'));
  }

  // DCQL or no PEX descriptors
  const selected = await selectCredentialsForRequest(agent, resolved);
  await agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest({
    authorizationRequestPayload: resolved.authorizationRequestPayload,
    ...(selected.presentationExchange ? { presentationExchange: selected.presentationExchange } : {}),
    ...(selected.dcql ? { dcql: selected.dcql } : {}),
  });
}

// ── SD-JWT direct presentation ────────────────────────────────────────────────

async function postSdJwtPresentation(
  items: MatchedItem[],
  allDescriptors: Array<Record<string, unknown>>,
  definition: Record<string, unknown>,
  responseUri: string,
  nonce: string,
  state: string | undefined,
  aud: string,
  agent: WalletAgent,
): Promise<void> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);

  const buildPresentation = async (item: MatchedItem): Promise<string> => {
    const parts = item.compact.split('~');
    const jwtPart = parts[0];
    const allDisclosures = parts.slice(1).filter((d) => d.length > 0);

    // Log full JWT payload for debugging
    try {
      const payloadB64 = jwtPart.split('.')[1];
      const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
      console.log('[oid4vp] full JWT payload keys:', Object.keys(payload).join(','));
      console.log('[oid4vp] full JWT payload:', JSON.stringify(payload).slice(0, 1500));
    } catch { /* best-effort */ }

    // Decode disclosures: [salt, claim_name, claim_value]
    type Disclosure = { raw: string; name: string };
    const decoded: Disclosure[] = [];
    for (const raw of allDisclosures) {
      try {
        const arr = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
        if (Array.isArray(arr) && arr.length >= 2) {
          decoded.push({ raw, name: arr[1] as string });
          console.log('[oid4vp] disclosure:', arr[1], '=', String(arr[2]).slice(0, 50));
        }
      } catch { /* best-effort */ }
    }

    // Selective disclosure: only include disclosures for fields the PD requests
    const descriptor = allDescriptors.find((d) => d.id === item.descriptorId);
    const requestedNames = extractRequestedClaimNames(descriptor);
    console.log('[oid4vp] PD requested claim names:', requestedNames.join(',') || '(all)');

    const selectedDisclosures = requestedNames.length > 0
      ? decoded.filter((d) => requestedNames.includes(d.name)).map((d) => d.raw)
      : decoded.map((d) => d.raw);

    console.log('[oid4vp] selected disclosures:', selectedDisclosures.length, 'of', decoded.length);

    // Build the SD-JWT presentation string
    const sdJwtBase = [jwtPart, ...selectedDisclosures, ''].join('~');

    if (item.holderKeyId && item.holderDid) {
      try {
        const kid = `${item.holderDid}#${item.holderDid.split(':').pop()}`;
        const sdHashB64 = await ExpoCrypto.digestStringAsync(
          ExpoCrypto.CryptoDigestAlgorithm.SHA256,
          sdJwtBase,
          { encoding: ExpoCrypto.CryptoEncoding.BASE64 },
        );
        const sdHash = sdHashB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const kbHeader = { typ: 'kb+jwt', alg: 'EdDSA', kid };
        const kbPayload = { iat: Math.floor(Date.now() / 1000), aud, nonce, sd_hash: sdHash };
        const h64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(kbHeader)));
        const p64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(kbPayload)));
        const { signature } = await kms.sign({
          keyId: item.holderKeyId,
          algorithm: 'EdDSA',
          data: TypedArrayEncoder.fromString(`${h64}.${p64}`),
        });
        const kbJwt = `${h64}.${p64}.${TypedArrayEncoder.toBase64URL(signature)}`;
        console.log('[oid4vp] KB-JWT built for:', item.descriptorId);
        return `${sdJwtBase}${kbJwt}`;
      } catch (e) {
        console.warn('[oid4vp] KB-JWT build failed, sending without KB-JWT:', e);
      }
    } else {
      console.log('[oid4vp] no holderKeyId for', item.descriptorId, '— sending without KB-JWT');
    }
    return sdJwtBase;
  };

  const presentations = await Promise.all(items.map(buildPresentation));
  const singleItem = items.length === 1;
  const vpToken = singleItem ? presentations[0] : JSON.stringify(presentations);

  const submission = {
    id: genId(),
    definition_id: definition.id as string,
    descriptor_map: items.map((item, idx) => ({
      id: item.descriptorId,
      format: item.pdFormat || 'vc+sd-jwt',
      path: singleItem ? '$' : `$[${idx}]`,
    })),
  };

  console.log('[oid4vp] POSTing SD-JWT VP to:', responseUri.slice(0, 80),
    'format:', items[0].pdFormat);
  await postToResponseUri(responseUri, vpToken, submission, state);
}

/** Extracts the leaf claim names from all field paths in a PD descriptor. */
function extractRequestedClaimNames(descriptor: Record<string, unknown> | undefined): string[] {
  const fields = (descriptor?.constraints as Record<string, unknown> | undefined)
    ?.fields as Array<Record<string, unknown>> | undefined;
  if (!fields) return [];
  const names: string[] = [];
  for (const field of fields) {
    const paths = field.path as string[] | undefined;
    for (const path of paths ?? []) {
      // Extract last segment: $.holder → holder, $.vc.holder → holder
      const name = path.split('.').pop()?.replace(/[[\]]/g, '');
      if (name && name !== '$') names.push(name);
    }
  }
  return [...new Set(names)];
}

// ── JWT VP presentation ───────────────────────────────────────────────────────

async function postJwtVpPresentation(
  agent: WalletAgent,
  items: MatchedItem[],
  definition: Record<string, unknown>,
  responseUri: string,
  nonce: string,
  state: string | undefined,
  aud: string,
): Promise<void> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);

  const first = items[0];
  let signingKeyId: string;
  let vpIss: string;
  let kid: string | undefined;

  if (first?.holderKeyId && first.holderDid) {
    signingKeyId = first.holderKeyId;
    vpIss = first.holderDid;
    kid = `${first.holderDid}#${first.holderDid.split(':').pop()}`;
  } else {
    const { keyId } = await kms.createKeyForSignatureAlgorithm({ algorithm: 'EdDSA' });
    signingKeyId = keyId;
    vpIss = first?.holderDid ?? 'did:key:anonymous';
    console.log('[oid4vp] no holderKeyId — using ephemeral key for VP signing');
  }

  const vpPayload: Record<string, unknown> = {
    iss: vpIss,
    aud,
    iat: Math.floor(Date.now() / 1000),
    nonce,
    vp: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: items.map((i) => i.compact),
    },
  };

  const header: Record<string, unknown> = { alg: 'EdDSA', typ: 'JWT' };
  if (kid) header.kid = kid;

  const h64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(header)));
  const p64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(vpPayload)));
  const { signature } = await kms.sign({
    keyId: signingKeyId,
    algorithm: 'EdDSA',
    data: TypedArrayEncoder.fromString(`${h64}.${p64}`),
  });
  const vpToken = `${h64}.${p64}.${TypedArrayEncoder.toBase64URL(signature)}`;

  const submission = {
    id: genId(),
    definition_id: definition.id as string,
    descriptor_map: items.map((item, i) => ({
      id: item.descriptorId,
      format: 'jwt_vp_json',
      path: '$',
      path_nested: {
        id: item.descriptorId,
        format: 'jwt_vc_json',
        path: `$.vp.verifiableCredential[${i}]`,
      },
    })),
  };

  console.log('[oid4vp] POSTing JWT VP to:', responseUri.slice(0, 80));
  await postToResponseUri(responseUri, vpToken, submission, state);
}

async function postToResponseUri(
  responseUri: string,
  vpToken: string,
  submission: object,
  state: string | undefined,
): Promise<void> {
  const body = new URLSearchParams({
    vp_token: vpToken,
    presentation_submission: JSON.stringify(submission),
  });
  if (state) body.set('state', state);

  const resp = await fetch(responseUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Error al presentar credencial (${resp.status}): ${text.slice(0, 300)}`);
  }
  console.log('[oid4vp] presentation accepted:', resp.status);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDescriptorFormat(descriptor: Record<string, unknown>): string {
  const fmt = descriptor.format as Record<string, unknown> | undefined;
  if (!fmt) return 'vc+sd-jwt';
  const keys = Object.keys(fmt);
  return keys[0] ?? 'vc+sd-jwt';
}

function extractTypePattern(descriptor: Record<string, unknown>): string | undefined {
  const fields = (descriptor.constraints as Record<string, unknown> | undefined)
    ?.fields as Array<Record<string, unknown>> | undefined;
  for (const field of fields ?? []) {
    const paths = field.path as string[] | undefined;
    const pattern = (field.filter as Record<string, unknown> | undefined)?.pattern as string | undefined;
    if (pattern && paths?.some((p) => p === '$.vct' || p === '$.vc.type')) return pattern;
  }
  return undefined;
}

function matchesType(
  record: { firstCredential: { prettyClaims: unknown }; getTags: () => unknown },
  pattern: string | undefined,
): boolean {
  if (!pattern) return false;
  const test = (v: string) => { try { return new RegExp(pattern).test(v); } catch { return v === pattern; } };
  const pc = record.firstCredential.prettyClaims as Record<string, unknown>;
  if ((pc.vct as string | undefined) && test(pc.vct as string)) return true;
  const vcTypes = (pc.vc as Record<string, unknown> | undefined)?.type as string[] | undefined;
  if (Array.isArray(vcTypes) && vcTypes.some(test)) return true;
  const tagVct = (record.getTags() as Record<string, unknown>).credentialVct as string | undefined;
  if (tagVct) return test(tagVct);
  return false;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
