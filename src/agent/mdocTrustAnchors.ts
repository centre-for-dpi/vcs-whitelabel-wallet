/**
 * Dynamic mdoc trust anchors — fetched from the issuing deployment instead of
 * compiled into the app.
 *
 * WHY THIS EXISTS
 * The mdoc IACA root is generated at deploy time (verifiably-go's
 * scripts/gen-caddy.sh -> cmd/mdl-pki-gen). Every deploy.sh run against a fresh
 * host produces a NEW root, so an anchor baked into this bundle stops matching
 * the issuer as soon as the deployment is rebuilt — and the failure surfaces as
 * "No trusted certificate was found while validating the X.509 chain", which
 * points at the certificate rather than at the stale constant that caused it.
 * Shipping a compiled-in anchor means recompiling the wallet after every deploy.
 *
 * This module fetches the CURRENT anchor from the issuer's own
 * GET /trust/mdoc-anchors (internal/handlers/mdoc_anchors.go) at credential
 * ACCEPTANCE time, when the wallet is already online talking to that issuer.
 *
 * ── PROOF OF CONCEPT ────────────────────────────────────────────────────────
 * The issuer serves its own trust anchor, so a caller that trusts this response
 * is trusting the issuer's claim about itself: a compromised issuer could mint a
 * root and self-certify. That is tolerable here only because this deployment has
 * a single mdoc issuer and the generated PKI says so in its own DN
 * (O=POC-DO-NOT-TRUST).
 *
 * Production replaces it with the Hub's VICAL — a list of legitimate issuers
 * signed by an authority DISTINCT from any single issuer, so no issuer can
 * vouch for itself. The Hub already has the shape for it (internal/trust/
 * registry.go's TrustedIssuer, and GET /trust-registry which is signed by the
 * Hub rather than by the issuer being vouched for). When that lands, this module
 * changes its SOURCE — fetch the VICAL, verify the authority's signature — and
 * the wiring in setup.ts stays the same.
 *
 * ── OFFLINE / PRESENTATION IS UNAFFECTED ────────────────────────────────────
 * A wallet presenting a credential to a reader over BLE proximity has no
 * network and must not need one. This module is only ever consulted while
 * VERIFYING an mdoc the wallet is being issued — Credo calls
 * getTrustedCertificatesForVerification from Mdoc.verify(), which the holder
 * runs inside requestCredentials() at acceptance time, when the wallet is
 * already online talking to that issuer.
 *
 * Presentation runs the opposite direction: the wallet SIGNS a DeviceResponse
 * with its own device key; it does not verify an issuer chain, so no anchor is
 * needed and this code is not reached. See src/agent/mdl/ and presentMdoc.
 * The fetch is additionally scoped to `verification.type === 'credential'` and
 * gated on a recorded issuer URL, which is only set during an issuance
 * exchange — so even an unexpected verification path fails closed to the static
 * anchor rather than blocking on a network call that cannot succeed offline.
 */

/** Response shape of verifiably-go's GET /trust/mdoc-anchors. */
type MdocAnchorsResponse = {
  anchors?: string[];
  updated_at?: string;
  poc?: boolean;
};

/**
 * How long a successfully fetched anchor set is reused before refetching.
 *
 * Minutes, not the process lifetime: a redeploy rotates the IACA, and the app
 * is long-lived on a phone, so caching until restart would reproduce the exact
 * staleness this module exists to remove. Five minutes bounds the window in
 * which a wallet keeps trying a rotated-away anchor, while still collapsing the
 * many verifications of a single issuance exchange into one request.
 */
const ANCHOR_TTL_MS = 5 * 60 * 1000;

/** Network timeout. Short: this sits in the interactive accept-credential path. */
const FETCH_TIMEOUT_MS = 10_000;

type CacheEntry = {
  pems: string[];
  fetchedAt: number;
};

/** Anchor cache, keyed by issuer origin. Module-scoped: lives as long as the agent. */
const anchorCache = new Map<string, CacheEntry>();

/**
 * In-flight requests, keyed by issuer origin, so the several verifications of a
 * single issuance exchange share ONE network round-trip instead of racing
 * (Credo invokes the callback per credential being verified).
 */
const inFlight = new Map<string, Promise<string[]>>();

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

/**
 * The issuer base URL of the offer currently being accepted.
 *
 * WHY A MODULE-SCOPED VALUE RATHER THAN A PARAMETER
 * Credo's X509VerificationContext carries only `certificateChain` and a
 * `verification` union — there is no issuer URL and no way to pass extra data
 * through to the callback (see node_modules/@credo-ts/core/build/modules/x509/
 * X509ModuleConfig.d.mts). The callback is registered once, at agent
 * construction in setup.ts, long before any offer exists. So the URL has to
 * reach it out of band.
 *
 * requestCredentials.ts records it immediately before calling
 * holder.requestCredentials(), which is the call that triggers Mdoc.verify()
 * and therefore this callback. That ordering is what makes a module-scoped
 * value safe here: the write and the read are in the same synchronous
 * acceptance flow, and a React Native wallet accepts one offer at a time
 * (the UI is a single modal flow — there is no concurrent second issuance).
 *
 * Deliberately NOT derived from the certificate chain itself: the chain is the
 * untrusted input being verified, so taking a URL from it would let a hostile
 * credential nominate the server that vouches for it.
 */
let currentIssuerBaseUrl: string | undefined;

/**
 * Records the issuer whose offer is being accepted, so the trust-anchor
 * callback knows which deployment to ask. Called by requestCredentials.ts from
 * the OID4VCI `credential_issuer` value the wallet already resolved.
 */
export function setCurrentIssuerBaseUrl(url: string | undefined): void {
  currentIssuerBaseUrl = normalizeBaseUrl(url);
}

/** Clears the recorded issuer once an acceptance flow ends. */
export function clearCurrentIssuerBaseUrl(): void {
  currentIssuerBaseUrl = undefined;
}

/** Test seam: drops all cached anchors and in-flight requests. */
export function __resetAnchorCacheForTests(): void {
  anchorCache.clear();
  inFlight.clear();
  currentIssuerBaseUrl = undefined;
}

/**
 * Reduces an issuer URL to its origin.
 *
 * The OID4VCI `credential_issuer` may carry a path (walt.id draft13 issuers
 * publish e.g. https://host/draft13), but /trust/mdoc-anchors is served at the
 * deployment root by verifiably-go. Returns undefined for anything that is not
 * a parseable http(s) URL, so a malformed offer degrades to the static anchor
 * instead of throwing inside a verification callback.
 */
function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches GET {origin}/trust/mdoc-anchors and returns the PEM certificates.
 * Throws on a non-2xx response or a body without usable anchors — callers
 * decide whether to fall back.
 */
async function fetchAnchors(origin: string): Promise<string[]> {
  const url = `${origin}/trust/mdoc-anchors`;
  const response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
  if (!response.ok) {
    throw new Error(`trust anchor fetch failed (${response.status})`);
  }
  const body = (await response.json()) as MdocAnchorsResponse;
  const anchors = (body.anchors ?? []).filter(
    (pem) => typeof pem === 'string' && pem.includes('BEGIN CERTIFICATE'),
  );
  if (anchors.length === 0) {
    throw new Error('trust anchor response contained no certificates');
  }
  return anchors;
}

/**
 * Returns the trust anchors for `issuerBaseUrl`, using the cache when fresh.
 *
 * FAILURE POLICY: on a fetch error, a STALE cached value is returned if one
 * exists. A network blip during an issuance would otherwise reject a credential
 * the wallet could have accepted a second earlier, which is both worse UX and
 * worse security-by-frustration (it trains users to retry until something
 * works). A stale anchor is still an anchor this issuer served over TLS; the
 * TTL just means it may have been rotated since. With no cached value at all,
 * this throws and the caller falls back to the static anchor.
 */
export async function getAnchorsForIssuer(issuerBaseUrl: string): Promise<string[]> {
  const origin = normalizeBaseUrl(issuerBaseUrl);
  if (!origin) throw new Error(`unusable issuer base URL: ${issuerBaseUrl}`);

  const cached = anchorCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ANCHOR_TTL_MS) {
    log('[mdoc-trust] cache hit for', origin);
    return cached.pems;
  }

  // Collapse concurrent misses onto a single request.
  const existing = inFlight.get(origin);
  if (existing) return existing;

  const request = (async () => {
    try {
      const pems = await fetchAnchors(origin);
      anchorCache.set(origin, { pems, fetchedAt: Date.now() });
      log('[mdoc-trust] fetched', pems.length, 'anchor(s) from', origin);
      return pems;
    } catch (error) {
      const stale = anchorCache.get(origin);
      if (stale) {
        log('[mdoc-trust] fetch failed, using stale cached anchors for', origin, error);
        return stale.pems;
      }
      throw error;
    } finally {
      inFlight.delete(origin);
    }
  })();

  inFlight.set(origin, request);
  return request;
}

/**
 * Builds the X509Module `getTrustedCertificatesForVerification` callback.
 *
 * Returning `undefined` makes Credo fall back to the statically registered
 * `trustedCertificates`, which is how every non-mdoc and every unknown-issuer
 * case stays exactly as it was before this module existed.
 *
 * @param staticFallback anchors compiled into the app, appended to the fetched
 *   set so a deployment that has not yet shipped the endpoint keeps working.
 */
export function createTrustedCertificatesResolver(staticFallback: string[]) {
  return async function getTrustedCertificatesForVerification(
    _agentContext: unknown,
    verificationContext: { verification?: { type?: string } },
  ): Promise<string[] | undefined> {
    // Only credential verification concerns mdoc issuance. Other verification
    // types (oauth2SecuredAuthorizationRequest, key attestation, issuer
    // metadata) must not trigger a network fetch — falling through to the
    // static list keeps their behaviour identical to before.
    if (verificationContext?.verification?.type !== 'credential') {
      return undefined;
    }

    // No recorded issuer means this is not an issuance exchange we initiated
    // (e.g. a presentation-side verification). Never fetch in that case — see
    // the offline note in this file's header.
    const issuer = currentIssuerBaseUrl;
    if (!issuer) return undefined;

    try {
      const fetched = await getAnchorsForIssuer(issuer);
      // Union, not replacement: the static anchor stays valid for credentials
      // already held and issued under it, and dropping it would reject a
      // credential the wallet accepted yesterday. Deduped so a matching
      // fetched/static pair is not offered twice.
      return Array.from(new Set([...fetched, ...staticFallback]));
    } catch (error) {
      log('[mdoc-trust] no dynamic anchors, falling back to static list:', error);
      // undefined = use the globally registered trustedCertificates.
      return undefined;
    }
  };
}
