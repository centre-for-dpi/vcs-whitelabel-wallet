import pako from 'pako';

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

export type RevocationStatus = 'valid' | 'revoked' | 'unknown';

/**
 * Checks the revocation status of a credential from its compact SD-JWT string.
 *
 * Supports two status mechanisms:
 *   - TokenStatusList (IETF draft-ietf-oauth-status-list): status.status_list.idx + .uri
 *   - StatusList2021 (W3C): credentialStatus.statusListCredential + .statusListIndex
 *
 * Returns 'unknown' when the credential carries no status claim, or when the
 * status list cannot be fetched (network error, unrecognised format, etc.) so
 * that transient failures never block a legitimate presentation.
 */
export async function checkRevocationStatus(compactSdJwt: string): Promise<RevocationStatus> {
  const payload = decodeJwtPayload(compactSdJwt.split('~')[0]);
  if (!payload) return 'unknown';

  // ── TokenStatusList (IETF) ────────────────────────────────────────────────
  const statusClaim = payload.status as Record<string, unknown> | undefined;
  const tsl = statusClaim?.status_list as { idx?: number; uri?: string } | undefined;
  if (tsl?.idx !== undefined && tsl.uri) {
    log('[revocation] TokenStatusList idx:', tsl.idx, 'uri:', tsl.uri.slice(0, 80));
    return checkTokenStatusList(tsl.idx, tsl.uri);
  }

  // ── StatusList2021 (W3C) ─────────────────────────────────────────────────
  // May appear at top level or nested inside .vc for W3C-wrapped JWTs
  const cs =
    (payload.credentialStatus as StatusListEntry | undefined) ??
    ((payload.vc as Record<string, unknown> | undefined)
      ?.credentialStatus as StatusListEntry | undefined);

  if (cs?.type === 'StatusList2021Entry' && cs.statusListCredential) {
    const idx = parseInt(cs.statusListIndex, 10);
    log('[revocation] StatusList2021 idx:', idx, 'url:', cs.statusListCredential.slice(0, 80));
    return checkStatusList2021(idx, cs.statusListCredential);
  }

  return 'unknown';
}

// ── TokenStatusList ───────────────────────────────────────────────────────────

async function checkTokenStatusList(idx: number, uri: string): Promise<RevocationStatus> {
  try {
    const resp = await fetch(uri, {
      headers: { Accept: 'application/statuslist+jwt, application/jwt, */*' },
    });
    if (!resp.ok) {
      console.warn('[revocation] TokenStatusList fetch failed:', resp.status);
      return 'unknown';
    }
    const jwt = await resp.text();
    const jwtPayload = decodeJwtPayload(jwt.split('~')[0]);
    if (!jwtPayload) return 'unknown';

    const list = jwtPayload.status_list as Record<string, unknown> | undefined;
    if (!list) return 'unknown';

    const bits = (list.bits as number | undefined) ?? 1;
    const lst = list.lst as string | undefined;
    if (!lst) return 'unknown';

    const bytes = pako.inflate(base64UrlToUint8Array(lst));
    // Each entry occupies `bits` consecutive bits, MSB-first within each byte.
    const bitIndex = idx * bits;
    const isSet = getBit(bytes, bitIndex);
    log('[revocation] TokenStatusList result — idx:', idx, 'bits:', bits, 'set:', isSet);
    return isSet ? 'revoked' : 'valid';
  } catch (e) {
    console.warn('[revocation] TokenStatusList error:', e);
    return 'unknown';
  }
}

// ── StatusList2021 ────────────────────────────────────────────────────────────

async function checkStatusList2021(idx: number, listCredentialUrl: string): Promise<RevocationStatus> {
  try {
    const resp = await fetch(listCredentialUrl, {
      headers: { Accept: 'application/jwt, application/json, */*' },
    });
    if (!resp.ok) {
      console.warn('[revocation] StatusList2021 fetch failed:', resp.status);
      return 'unknown';
    }
    const body = await resp.text();
    const encodedList = extractStatusList2021EncodedList(body);
    if (!encodedList) {
      console.warn('[revocation] StatusList2021 encodedList not found');
      return 'unknown';
    }

    const bytes = pako.inflate(base64ToUint8Array(encodedList));
    const isSet = getBit(bytes, idx);
    log('[revocation] StatusList2021 result — idx:', idx, 'set:', isSet);
    return isSet ? 'revoked' : 'valid';
  } catch (e) {
    console.warn('[revocation] StatusList2021 error:', e);
    return 'unknown';
  }
}

/** Extracts encodedList from a status list credential (JWT or plain JSON). */
function extractStatusList2021EncodedList(body: string): string | undefined {
  // Try as JWT first (compact: header.payload.sig)
  const jwtPayload = decodeJwtPayload(body);
  if (jwtPayload) {
    const vc = jwtPayload.vc as Record<string, unknown> | undefined;
    return (
      (vc?.credentialSubject as Record<string, unknown> | undefined)?.encodedList as string | undefined ??
      (jwtPayload.credentialSubject as Record<string, unknown> | undefined)?.encodedList as string | undefined
    );
  }
  // Try as JSON-LD VC
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    return (json.credentialSubject as Record<string, unknown> | undefined)?.encodedList as string | undefined;
  } catch {
    return undefined;
  }
}

// ── Bit helpers ───────────────────────────────────────────────────────────────

/**
 * Returns true if the bit at position bitIndex is set.
 * Both StatusList2021 and TokenStatusList use MSB-first ordering within each byte:
 * bit 0 of the bitstring is the MSB (bit 7) of byte 0.
 */
export function getBit(bytes: Uint8Array, bitIndex: number): boolean {
  const byteIndex = Math.floor(bitIndex / 8);
  const bitOffset = 7 - (bitIndex % 8);
  if (byteIndex >= bytes.length) return false;
  return ((bytes[byteIndex] >> bitOffset) & 1) === 1;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '='));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StatusListEntry {
  type: string;
  statusListCredential: string;
  statusListIndex: string;
  statusPurpose?: string;
}
