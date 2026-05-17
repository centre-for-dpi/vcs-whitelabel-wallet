import { ClaimFormat, Kms, SdJwtVcRecord, TypedArrayEncoder } from '@credo-ts/core';
import * as ExpoCrypto from 'expo-crypto';
import type { WalletAgent } from '../setup';
import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';
import { selectCredentialsForRequest } from './selectCredentials';
import { checkRevocationStatus } from '../revocation';
import i18n from '../../i18n';

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

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
 * HTTP response_uri endpoints (dev environments) are routed to presentCredentialsHttp,
 * which bypasses Credo entirely. All HTTPS requests use Credo natively.
 *
 * HTTPS credential routing (based on structure, not PD format):
 *  - Conformant SD-JWT (prettyClaims.vct defined): Credo handles natively.
 *  - W3C-wrapped SD-JWT with disclosures: POST compact SD-JWT directly as vp_token.
 *    Credo's createPresentation fails for these because PEX evaluates $.vct against
 *    prettyClaims, which is undefined for W3C-wrapped credentials from walt.id.
 *  - W3C-wrapped regular JWT (no disclosures): POST as jwt_vp_json wrapping the JWT.
 */
export async function presentCredentials(
  agent: WalletAgent,
  resolved: OpenId4VpResolvedAuthorizationRequest,
  excludedFields?: Set<string>,
): Promise<void> {
  const r = resolved as unknown as Record<string, unknown>;
  const reqPayload = r.authorizationRequestPayload as Record<string, unknown>;
  const responseUri = (reqPayload.response_uri ?? reqPayload.redirect_uri) as string | undefined;

  // Credo enforces HTTPS at multiple layers — route HTTP issuers to the manual bypass.
  if (responseUri?.startsWith('http://')) {
    await presentCredentialsHttp(agent, resolved, excludedFields);
    return;
  }

  // ── HTTPS path — Credo handles natively ──────────────────────────────────────

  const pex = r.presentationExchange as Record<string, unknown> | undefined;
  const definition = pex?.definition as Record<string, unknown> | undefined;
  const descriptors = (definition?.input_descriptors as Array<Record<string, unknown>>) ?? [];
  const nonce = reqPayload.nonce as string | undefined;
  const state = reqPayload.state as string | undefined;
  const aud = ((reqPayload.client_id ?? responseUri) as string).replace(/^decentralized_identifier:/, '');

  if (pex && descriptors.length > 0 && responseUri && nonce) {
    const matched = await buildMatchedItems(agent, descriptors);
    await assertNotRevoked(matched);

    if (matched.every((m) => m.isConformant)) {
      const built: Record<string, Array<{ claimFormat: ClaimFormat; credentialRecord: SdJwtVcRecord; disclosedPayload: Record<string, unknown> }>> = {};
      for (const m of matched) {
        const rawPayload = m.record.firstCredential.prettyClaims as Record<string, unknown>;
        const disclosedPayload = excludedFields
          ? Object.fromEntries(Object.entries(rawPayload).filter(([k]) => !excludedFields.has(k)))
          : rawPayload;
        built[m.descriptorId] = [{
          claimFormat: ClaimFormat.SdJwtDc,
          credentialRecord: m.record,
          disclosedPayload,
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
          excludedFields,
        );
        return;
      }
    }

    // Non-conformant credentials: manual posting
    const sdJwtItems = matched.filter((m) => !m.isConformant && m.hasDisclosures);
    const jwtVcItems = matched.filter((m) => !m.isConformant && !m.hasDisclosures);

    if (sdJwtItems.length > 0 && jwtVcItems.length === 0) {
      await postSdJwtPresentation(sdJwtItems, descriptors, definition!, responseUri, nonce, state, aud, agent, excludedFields);
      return;
    }
    if (jwtVcItems.length > 0 && sdJwtItems.length === 0) {
      await postJwtVpPresentation(agent, jwtVcItems, definition!, responseUri, nonce, state, aud);
      return;
    }
    throw new Error(i18n.t('present.mixed_format_error'));
  }

  // DCQL or no PEX descriptors — Credo handles
  const selected = await selectCredentialsForRequest(agent, resolved);
  try {
    await agent.modules.openid4vc.holder.acceptOpenId4VpAuthorizationRequest({
      authorizationRequestPayload: resolved.authorizationRequestPayload,
      ...(selected.presentationExchange ? { presentationExchange: selected.presentationExchange } : {}),
      ...(selected.dcql ? { dcql: selected.dcql } : {}),
    });
  } catch (e) {
    const isKeyMissing = e instanceof Error && (
      e.name === 'KeyManagementKeyNotFoundError' ||
      e.message.includes('not found in backend')
    );
    if (!isKeyMissing) throw e;
    console.warn('[oid4vp] holder key missing from Askar on DCQL path, falling back to manual posting');
    await postDcqlPresentation(agent, resolved);
  }
}

// ── HTTP bypass (dev environments only) ───────────────────────────────────────
//
// Called when response_uri is HTTP. Credo rejects HTTP URLs at multiple validation
// layers, so we post the presentation directly without going through Credo.

async function presentCredentialsHttp(
  agent: WalletAgent,
  resolved: OpenId4VpResolvedAuthorizationRequest,
  excludedFields?: Set<string>,
): Promise<void> {
  const r = resolved as unknown as Record<string, unknown>;
  const reqPayload = r.authorizationRequestPayload as Record<string, unknown>;
  const responseUri = (reqPayload.response_uri ?? reqPayload.redirect_uri) as string;
  const nonce = reqPayload.nonce as string;
  const state = reqPayload.state as string | undefined;
  const aud = ((reqPayload.client_id ?? responseUri) as string).replace(/^decentralized_identifier:/, '');

  const pex = r.presentationExchange as Record<string, unknown> | undefined;
  const definition = pex?.definition as Record<string, unknown> | undefined;
  const descriptors = (definition?.input_descriptors as Array<Record<string, unknown>>) ?? [];

  if (pex && descriptors.length > 0) {
    const matched = await buildMatchedItems(agent, descriptors);
    await assertNotRevoked(matched);
    const sdJwtItems = matched.filter((m) => m.hasDisclosures);
    const jwtVcItems = matched.filter((m) => !m.hasDisclosures);

    if (sdJwtItems.length > 0 && jwtVcItems.length === 0) {
      await postSdJwtPresentation(sdJwtItems, descriptors, definition!, responseUri, nonce, state, aud, agent, excludedFields);
    } else if (jwtVcItems.length > 0 && sdJwtItems.length === 0) {
      await postJwtVpPresentation(agent, jwtVcItems, definition!, responseUri, nonce, state, aud);
    } else {
      throw new Error(i18n.t('present.mixed_format_error'));
    }
    return;
  }

  // DCQL
  await postDcqlPresentation(agent, resolved);
}

// ── Revocation guard ──────────────────────────────────────────────────────────

async function assertNotRevoked(items: MatchedItem[]): Promise<void> {
  for (const item of items) {
    const status = await checkRevocationStatus(item.compact);
    log('[oid4vp] revocation status for', item.descriptorId, '→', status);
    if (status === 'revoked') {
      throw new Error(i18n.t('present.credential_revoked', { id: item.descriptorId }));
    }
  }
}

// ── Credential matching ───────────────────────────────────────────────────────

async function buildMatchedItems(
  agent: WalletAgent,
  descriptors: Array<Record<string, unknown>>,
): Promise<MatchedItem[]> {
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
    const holderKeyId = (tags.holderKeyId as string | undefined)
      ?? ((record as unknown as { credentialInstances?: Array<{ kmsKeyId?: string }> })
        .credentialInstances?.[0]?.kmsKeyId);

    let holderDid: string | undefined;
    const jwtPayload = decodeJwtPayload(compact.split('~')[0]);
    if (jwtPayload) holderDid = jwtPayload.sub as string | undefined;

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
    log(
      `[oid4vp] matched ${descriptorId} → record ${record.id}`,
      `conformant:${pc.vct !== undefined} disclosures:${compact.includes('~')}`,
    );
  }
  return matched;
}

// ── DCQL manual presentation (HTTP issuers) ───────────────────────────────────

async function postDcqlPresentation(
  agent: WalletAgent,
  resolved: OpenId4VpResolvedAuthorizationRequest,
): Promise<void> {
  const r = resolved as unknown as Record<string, unknown>;
  const reqPayload = r.authorizationRequestPayload as Record<string, unknown>;
  const responseUri = (reqPayload.response_uri ?? reqPayload.redirect_uri) as string;
  const nonce = reqPayload.nonce as string;
  const state = reqPayload.state as string | undefined;
  // Use the raw client_id from the JAR as aud — Credo does the same via effectiveClientId.
  // CREDEBL's verifier expects the full value including any scheme prefix (e.g. "decentralized_identifier:did:key:...").
  const aud = (reqPayload.client_id ?? responseUri) as string;
  const dcqlQuery = (reqPayload.dcql_query ?? (r.dcql as Record<string, unknown> | undefined)?.dcqlQuery) as Record<string, unknown> | undefined;
  const credQueries = (dcqlQuery?.credentials as Array<Record<string, unknown>>) ?? [];

  log('[oid4vp] DCQL request — response_mode:', reqPayload.response_mode, '| nonce present:', !!reqPayload.nonce, '| nonce:', String(reqPayload.nonce).slice(0, 20));
  log('[oid4vp] DCQL raw client_id:', reqPayload.client_id, '| client_id_scheme:', reqPayload.client_id_scheme);

  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const allSdJwt = await agent.sdJwtVc.getAll();

  const presentations: Record<string, string> = {};

  for (const cq of credQueries) {
    const credId = cq.id as string;
    const vctValues = ((cq.meta as Record<string, unknown> | undefined)?.vct_values as string[]) ?? [];

    const record = vctValues.length > 0
      ? allSdJwt.find((rec) => {
          const vct = (rec.firstCredential.prettyClaims as Record<string, unknown>).vct as string | undefined;
          return vct && vctValues.some((v) => vct === v || vct.endsWith(v) || v.endsWith(vct));
        })
      : allSdJwt[0];

    if (!record) {
      console.warn('[oid4vp] DCQL no match — vct_values:', vctValues, '| wallet has', allSdJwt.length, 'credential(s)');
      throw new Error(i18n.t('present.no_credential_for', { id: credId }));
    }

    const credVct = (record.firstCredential.prettyClaims as Record<string, unknown>).vct as string | undefined;
    log('[oid4vp] DCQL', credId, '— vct_values:', vctValues, '| credential vct:', credVct);

    // Log the issuer JWT header so we can confirm typ (vc+sd-jwt vs dc+sd-jwt) and alg.
    try {
      const issuerHdrB64 = compact.split('~')[0].split('.')[0] ?? '';
      const issuerHdr = JSON.parse(atob(issuerHdrB64.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
      log('[oid4vp] DCQL', credId, '— issuer JWT hdr typ:', issuerHdr.typ, '| alg:', issuerHdr.alg, '| kid prefix:', String(issuerHdr.kid).slice(0, 20));
    } catch { /* ignore */ }

    const compact = record.firstCredential.compact;
    const tags = record.getTags() as Record<string, unknown>;
    const tagHolderKeyId = tags.holderKeyId as string | undefined;
    let holderDid: string | undefined;
    let hasCnf = false;
    let cnfJwk: Record<string, unknown> | undefined;
    const dcqlPayload = decodeJwtPayload(compact.split('~')[0]);
    if (dcqlPayload) {
      const cnf = dcqlPayload.cnf as Record<string, unknown> | undefined;
      cnfJwk = cnf?.jwk as Record<string, unknown> | undefined;
      holderDid = (dcqlPayload.sub as string | undefined)
        ?? ((cnf as Record<string, string> | undefined)?.kid?.split('#')[0]);
      hasCnf = !!cnf;
    }

    // Prefer the Askar UUID stored in the tag (the key that CAN sign).
    // Fall back to the JWK thumbprint only when no tag exists, since Credo's Askar
    // backend stores keys by UUID, not by JWK thumbprint.
    let holderKeyId = tagHolderKeyId;
    if (!holderKeyId && cnfJwk) {
      try { holderKeyId = await jwkThumbprint(cnfJwk); } catch { /* ignore */ }
    }
    const thumbprint = cnfJwk ? await jwkThumbprint(cnfJwk).catch(() => '?') : '?';
    const holderAlg = jwkAlgorithm(cnfJwk);
    const cnfKid = (dcqlPayload?.cnf as Record<string, unknown> | undefined)?.kid as string | undefined;
    const cnfX = (cnfJwk?.x as string | undefined) ?? (cnfJwk?.y as string | undefined) ?? '?';
    log('[oid4vp] DCQL', credId, '— hasCnf:', hasCnf, '| tagKeyId:', tagHolderKeyId?.slice(0, 20), '| thumbprint:', thumbprint.slice(0, 20), '| cnf kty:', cnfJwk?.kty, 'crv:', cnfJwk?.crv, '→ alg:', holderAlg, '| cnf.x[0..20]:', cnfX.slice(0, 20));

    // Key match test: sign test data with the UUID key, then verify with cnf.jwk.
    // If valid=true the UUID key IS the holder key → KB-JWT signatures will verify.
    // If false/error the credential's holder binding is broken and must be re-issued.
    if (tagHolderKeyId && cnfJwk) {
      try {
        const testBytes = TypedArrayEncoder.fromString('key-match-test');
        const { signature: testSig } = await kms.sign({
          keyId: tagHolderKeyId, algorithm: holderAlg, data: testBytes,
        });
        let matchResult: unknown;
        try {
          // kms.verify: { key: { publicJwk: <plain JWK> }, algorithm, data, signature }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          matchResult = await kms.verify({ key: { publicJwk: cnfJwk }, algorithm: holderAlg, data: testBytes, signature: testSig } as any);
        } catch (ve) { matchResult = `verify-err: ${String(ve).slice(0, 80)}`; }
        log('[oid4vp] KEY MATCH (sign UUID, verify cnfJwk):', JSON.stringify(matchResult));
      } catch (e) {
        log('[oid4vp] KEY MATCH sign error:', String(e).slice(0, 100));
      }
    }

    // Check credential expiry — an expired credential is rejected by the verifier
    // with "presentations failed verification", which looks identical to a KB-JWT failure.
    const issuerPayload = decodeJwtPayload(compact.split('~')[0]);
    const exp = issuerPayload?.exp as number | undefined;
    const iat = issuerPayload?.iat as number | undefined;
    const nbf = issuerPayload?.nbf as number | undefined;
    const nowSecs = Math.floor(Date.now() / 1000);
    const isExpired = exp !== undefined && exp < nowSecs;
    const notYetValid = nbf !== undefined && nbf > nowSecs;
    log('[oid4vp] DCQL', credId, '— iat:', iat, '| exp:', exp, '| now:', nowSecs, '| expired:', isExpired, '| notYetValid:', notYetValid);
    if (isExpired) {
      throw new Error(`Credential '${credId}' has expired (exp=${exp}, now=${nowSecs}). Please re-issue the credential.`);
    }

    // Selective disclosure for requested claims
    const claimPaths = ((cq.claims as Array<Record<string, unknown>>) ?? [])
      .map((c) => {
        const path = c.path as Array<string | number> | undefined;
        return String(path?.[path.length - 1] ?? '');
      })
      .filter(Boolean);

    const parts = compact.split('~');
    const allDisclosures = parts.slice(1).filter((d) => d.length > 0);
    type D = { raw: string; name: string };
    const decoded: D[] = [];
    for (const raw of allDisclosures) {
      try {
        const arr = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
        if (Array.isArray(arr) && arr.length >= 2) decoded.push({ raw, name: arr[1] as string });
      } catch { /* best-effort */ }
    }
    const selected = claimPaths.length > 0
      ? decoded.filter((d) => claimPaths.includes(d.name)).map((d) => d.raw)
      : decoded.map((d) => d.raw);

    log('[oid4vp] DCQL', credId, '— claimPaths:', claimPaths, '| selected disclosures:', selected.length, '/ total:', decoded.length);

    const sdJwtBase = [parts[0], ...selected, ''].join('~');
    let presentation = sdJwtBase;

    // Only attach KB-JWT if the credential declares key binding via cnf.
    // Sending KB-JWT for a credential without cnf causes CREDEBL to reject the presentation.
    if (holderKeyId && hasCnf) {
      try {
        presentation = await buildKbJwt(kms, holderKeyId, holderDid, sdJwtBase, aud, nonce, holderAlg);
        log('[oid4vp] DCQL KB-JWT built for:', credId, '| alg:', holderAlg, '| aud:', aud.slice(0, 60));
        // Decode and log the KB-JWT payload so we can verify aud/nonce/sd_hash are correct.
        try {
          const kbStr = presentation.split('~').pop() ?? '';
          const kbParts = kbStr.split('.');
          if (kbParts.length >= 2) {
            const kbHdr = JSON.parse(atob((kbParts[0] ?? '').replace(/-/g, '+').replace(/_/g, '/')));
            const kbPld = JSON.parse(atob((kbParts[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')));
            log('[oid4vp] KB-JWT hdr:', JSON.stringify(kbHdr));
            log('[oid4vp] KB-JWT pld — aud:', kbPld.aud, '| nonce:', kbPld.nonce, '| sd_hash[0..20]:', String(kbPld.sd_hash).slice(0, 20));
          }
        } catch { /* ignore */ }
      } catch (e) {
        console.warn('[oid4vp] DCQL KB-JWT failed, sending without:', e);
      }
    }
    presentations[credId] = presentation;
  }

  // vp_token is a JSON object keyed by credential query id — values are plain strings (not arrays).
  const vpToken = JSON.stringify(presentations);

  log('[oid4vp] DCQL vpToken (first 120):', vpToken.slice(0, 120));

  const body = new URLSearchParams({ vp_token: vpToken });
  if (state) body.set('state', state);

  log('[oid4vp] DCQL POST →', responseUri.slice(0, 80));
  const resp = await fetchWithTimeout(responseUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const respText = await resp.text().catch(() => '');
  if (!resp.ok) {
    throw new Error(`Error al presentar credencial DCQL (${resp.status}): ${respText.slice(0, 300)}`);
  }
  log('[oid4vp] DCQL presentation accepted:', resp.status);
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
  excludedFields?: Set<string>,
): Promise<void> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);

  const buildPresentation = async (item: MatchedItem): Promise<string> => {
    const parts = item.compact.split('~');
    const jwtPart = parts[0];
    const allDisclosures = parts.slice(1).filter((d) => d.length > 0);

    type Disclosure = { raw: string; name: string };
    const decoded: Disclosure[] = [];
    for (const raw of allDisclosures) {
      try {
        const arr = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
        if (Array.isArray(arr) && arr.length >= 2) {
          decoded.push({ raw, name: arr[1] as string });
        }
      } catch { /* best-effort */ }
    }

    const descriptor = allDescriptors.find((d) => d.id === item.descriptorId);
    const requestedNames = extractRequestedClaimNames(descriptor);
    const filteredNames = excludedFields && requestedNames.length > 0
      ? requestedNames.filter((n) => !excludedFields.has(n))
      : requestedNames;
    const selectedDisclosures = filteredNames.length > 0
      ? decoded.filter((d) => filteredNames.includes(d.name)).map((d) => d.raw)
      : decoded.map((d) => d.raw);

    const sdJwtBase = [jwtPart, ...selectedDisclosures, ''].join('~');

    if (item.holderKeyId && item.holderDid) {
      try {
        const presentation = await buildKbJwt(kms, item.holderKeyId, item.holderDid, sdJwtBase, aud, nonce);
        log('[oid4vp] KB-JWT built for:', item.descriptorId);
        return presentation;
      } catch (e) {
        console.warn('[oid4vp] KB-JWT build failed, sending without KB-JWT:', e);
      }
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

  log('[oid4vp] SD-JWT POST →', responseUri.slice(0, 80), 'format:', items[0].pdFormat);
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
    log('[oid4vp] no holderKeyId — using ephemeral key for VP signing');
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

  log('[oid4vp] JWT VP POST →', responseUri.slice(0, 80));
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

  const resp = await fetchWithTimeout(responseUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Error al presentar credencial (${resp.status}): ${text.slice(0, 300)}`);
  }
  log('[oid4vp] presentation accepted:', resp.status);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Decodes the payload of a compact JWT/SD-JWT without signature verification. */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Builds a KB-JWT and appends it to sdJwtBase, returning the full presentation token.
 * Throws if signing fails — callers should catch and send without KB-JWT if desired.
 */
async function buildKbJwt(
  kms: Kms.KeyManagementApi,
  holderKeyId: string,
  holderDid: string | undefined,
  sdJwtBase: string,
  aud: string,
  nonce: string,
  algorithm = 'EdDSA',
): Promise<string> {
  const sdHashB64 = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    sdJwtBase,
    { encoding: ExpoCrypto.CryptoEncoding.BASE64 },
  );
  const sdHash = sdHashB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const kbHeader: Record<string, string> = { typ: 'kb+jwt', alg: algorithm };
  if (holderDid) kbHeader.kid = `${holderDid}#${holderDid.split(':').pop()}`;
  const h64 = TypedArrayEncoder.toBase64URL(TypedArrayEncoder.fromString(JSON.stringify(kbHeader)));
  const p64 = TypedArrayEncoder.toBase64URL(
    TypedArrayEncoder.fromString(JSON.stringify({ iat: Math.floor(Date.now() / 1000), aud, nonce, sd_hash: sdHash })),
  );
  const { signature } = await kms.sign({
    keyId: holderKeyId,
    algorithm,
    data: TypedArrayEncoder.fromString(`${h64}.${p64}`),
  });
  return `${sdJwtBase}${h64}.${p64}.${TypedArrayEncoder.toBase64URL(signature)}`;
}

/** fetch() con timeout fijo. Lanza AbortError si el servidor no responde a tiempo. */
async function fetchWithTimeout(url: string, opts: RequestInit, ms = 30_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return TypedArrayEncoder.toBase64URL(bytes);
}

/** Maps a public JWK to the JWT signature algorithm it requires for key binding. */
function jwkAlgorithm(jwk: Record<string, unknown> | undefined): string {
  if (!jwk) return 'EdDSA';
  const kty = jwk.kty as string;
  if (kty === 'EC') {
    const crv = jwk.crv as string;
    if (crv === 'P-384') return 'ES384';
    if (crv === 'P-521') return 'ES512';
    return 'ES256'; // P-256 default
  }
  return 'EdDSA'; // OKP / Ed25519
}

/**
 * Computes the RFC 7638 JWK Thumbprint for a public JWK.
 * In Credo's Askar backend this value IS the stored key ID, so using it
 * for lookup guarantees we sign with the key that matches cnf.jwk.
 */
async function jwkThumbprint(jwk: Record<string, unknown>): Promise<string> {
  let canonical: string;
  const kty = jwk.kty as string;
  if (kty === 'OKP') {
    canonical = JSON.stringify({ crv: jwk.crv, kty, x: jwk.x });
  } else if (kty === 'EC') {
    canonical = JSON.stringify({ crv: jwk.crv, kty, x: jwk.x, y: jwk.y });
  } else {
    canonical = JSON.stringify({ e: jwk.e, kty, n: jwk.n });
  }
  const b64 = await ExpoCrypto.digestStringAsync(
    ExpoCrypto.CryptoDigestAlgorithm.SHA256,
    canonical,
    { encoding: ExpoCrypto.CryptoEncoding.BASE64 },
  );
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
