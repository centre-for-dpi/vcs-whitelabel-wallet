/**
 * Normalizes an OID4VP authorization request URL before passing it to Credo's resolver.
 *
 * For HTTP issuers (dev environments), Credo's resolver rejects the request at multiple
 * validation layers (HTTPS-only URLs, signed-JAR requirements, version inference conflicts).
 * In that case we bypass Credo entirely: fetch and decode the JWT ourselves, build a
 * synthetic resolved-request object, and let presentCredentials post manually.
 *
 * For HTTPS issuers the original patching path applies:
 *  1. client_id patch  — when client_id_scheme=redirect_uri, client_id must equal response_uri.
 *  2. PD URI fetch     — Credo doesn't support presentation_definition_uri; we inline it.
 *  3. Format alg       — PEX v2 requires { alg: [...] } in JWT format constraints only.
 */

import type { OpenId4VpResolvedAuthorizationRequest } from '@credo-ts/openid4vc';

// ── HTTP bypass ───────────────────────────────────────────────────────────────

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.trim().split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Returns true when the URL uses an HTTP request_uri (non-HTTPS issuer).
 * Credo cannot resolve these — use resolveHttpOid4VpRequest instead.
 */
export function isHttpOid4VpRequest(rawUrl: string): boolean {
  const qs = rawUrl.indexOf('?');
  if (qs === -1) return false;
  const params = new URLSearchParams(rawUrl.slice(qs + 1));
  const requestUri = params.get('request_uri');
  return !!requestUri?.startsWith('http://');
}

/**
 * Manually resolves an OID4VP authorization request from an HTTP issuer,
 * bypassing Credo's resolver which enforces HTTPS, signed-JAR, and version checks.
 * Returns a synthetic object compatible with presentCredentials.ts.
 */
export async function resolveHttpOid4VpRequest(
  rawUrl: string,
): Promise<OpenId4VpResolvedAuthorizationRequest> {
  const qs = rawUrl.indexOf('?');
  const params = new URLSearchParams(qs >= 0 ? rawUrl.slice(qs + 1) : '');
  const requestUri = params.get('request_uri')!;

  console.log('[oid4vp] HTTP bypass — fetching request_uri:', requestUri.slice(0, 80));
  const resp = await fetch(requestUri);
  if (!resp.ok) throw new Error(`Failed to fetch authorization request (${resp.status})`);
  const jwt = await resp.text();
  const payload = decodeJwtPayload(jwt.trim());
  console.log('[oid4vp] HTTP bypass — decoded JAR payload keys:', Object.keys(payload).join(','));

  const responseUri = (payload.response_uri ?? payload.redirect_uri) as string;
  const nonce = payload.nonce as string;
  const state = payload.state as string | undefined;
  const clientId = params.get('client_id') ?? payload.client_id as string;

  // Build the synthetic authorizationRequestPayload Credo consumers expect
  const authorizationRequestPayload = {
    ...payload,
    client_id: clientId,
    response_uri: responseUri,
    nonce,
    state,
  } as Record<string, unknown>;

  // Build presentationExchange if PD is present
  let presentationExchange: Record<string, unknown> | undefined;
  if (payload.presentation_definition) {
    presentationExchange = {
      definition: payload.presentation_definition,
      credentialsForRequest: {},
    };
  }

  // Build dcql if present. Pass the actual credential queries so present.tsx
  // can display requestedTypes and requestedFields on the confirm screen.
  let dcql: Record<string, unknown> | undefined;
  if (payload.dcql_query) {
    const dcqlQuery = payload.dcql_query as Record<string, unknown>;
    const credQueries = (dcqlQuery.credentials as Array<Record<string, unknown>>) ?? [];
    dcql = { queryResult: { credentials: credQueries }, dcqlQuery: payload.dcql_query };
  }

  console.log('[oid4vp] HTTP bypass — response_uri:', responseUri?.slice(0, 80));
  console.log('[oid4vp] HTTP bypass — pex:', !!presentationExchange, '| dcql:', !!dcql);

  return {
    authorizationRequestPayload,
    presentationExchange,
    dcql,
    verifier: { effectiveClientId: clientId } as unknown,
  } as unknown as OpenId4VpResolvedAuthorizationRequest;
}

// ── HTTPS issuer path ─────────────────────────────────────────────────────────

/**
 * Normalizes an OID4VP authorization request URL for HTTPS issuers before passing
 * it to Credo's resolveOpenId4VpAuthorizationRequest.
 */
export async function normalizeAuthorizationRequestUrl(rawUrl: string): Promise<string> {
  const qsStart = rawUrl.indexOf('?');
  if (qsStart === -1) return rawUrl;

  const params = new URLSearchParams(rawUrl.slice(qsStart + 1));

  // Patch 1: client_id must equal response_uri for redirect_uri scheme
  if (params.get('client_id_scheme') === 'redirect_uri') {
    const responseUri = params.get('response_uri');
    if (responseUri) {
      params.set('client_id', responseUri);
      console.log('[oid4vp] patched client_id → response_uri:', responseUri.slice(0, 80));
    }
  }

  // Patches 2 & 3: fetch PD URI and inject alg into format constraints.
  // Credo's PEX validator requires format entries to have { alg: [...] } — an empty
  // format object {} is rejected. This applies to both JWT and SD-JWT format identifiers.
  const pdUri = params.get('presentation_definition_uri');
  if (pdUri) {
    console.log('[oid4vp] fetching presentation_definition_uri:', pdUri);
    const pdResp = await fetch(pdUri);
    if (!pdResp.ok) {
      throw new Error(`No se pudo obtener la definición de presentación (${pdResp.status})`);
    }
    const pd = await pdResp.json() as Record<string, unknown>;
    console.log('[oid4vp] fetched PD:', JSON.stringify(pd).slice(0, 1000));

    const inputDescriptors = pd.input_descriptors as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(inputDescriptors)) {
      for (const descriptor of inputDescriptors) {
        const fmt = descriptor.format as Record<string, unknown> | undefined;
        if (!fmt) continue;

        const ALG = ['ES256', 'EdDSA'];
        // JWT formats require { alg: [...] } — inject when missing.
        // SD-JWT formats (vc+sd-jwt, dc+sd-jwt) use sd-jwt_alg_values / kb-jwt_alg_values
        // and reject 'alg' as an additional property; leave them as-is.
        for (const fmtKey of ['jwt_vc_json', 'jwt_vp_json', 'jwt_vc', 'jwt_vp', 'jwt']) {
          const fmtObj = fmt[fmtKey] as Record<string, unknown> | undefined;
          if (fmtObj !== undefined && !Array.isArray(fmtObj['alg'])) {
            fmtObj['alg'] = ALG;
            console.log(`[oid4vp] injected alg for ${fmtKey} in descriptor:`, descriptor.id);
          }
        }
      }
    }

    params.delete('presentation_definition_uri');
    params.set('presentation_definition', JSON.stringify(pd));
  }

  return `${rawUrl.slice(0, qsStart)}?${params.toString()}`;
}
