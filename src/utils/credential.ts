import type { MdocRecord, SdJwtVcRecord, W3cCredentialRecord, W3cV2CredentialRecord } from '@credo-ts/core';
import { DateOnly } from '@animo-id/mdoc';
import i18n from '../i18n';
import { branding } from '../../branding.config';

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  h /= 360; s /= 100; l /= 100;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toHex = (x: number) => Math.round(hue2rgb(p, q, x) * 255).toString(16).padStart(2, '0');
  return `#${toHex(h + 1 / 3)}${toHex(h)}${toHex(h - 1 / 3)}`;
}

/** Returns a dark card color derived from branding.primaryColor, shifted by issuer name hash. */
export function issuerCardColor(issuer: string): string {
  const [h, s] = hexToHsl(branding.primaryColor);
  let hash = 0;
  for (let i = 0; i < issuer.length; i++) hash = (issuer.charCodeAt(i) + ((hash << 5) - hash)) | 0;
  const hueShift = (Math.abs(hash) % 120) - 60;
  return hslToHex((h + hueShift + 360) % 360, Math.min(s, 70), 22);
}

export type CredentialEntry = {
  id: string;
  format: 'sdjwt' | 'w3c' | 'mdoc';
  type: string;
  issuer: string;
  issuanceDate: string;
  expiryDate?: string; // ISO string; undefined = no expiry declared
  claims: Record<string, unknown>;
  selectiveFields: string[];
  /** Subset of selectiveFields that are selectively disclosable (SD-JWT _sd claims). Empty for W3C/mdoc. */
  sdFields: string[];
  rawRecord: SdJwtVcRecord | W3cCredentialRecord | MdocRecord;
};

export type ExpiryStatus = 'expired' | 'expiring' | 'valid' | 'none';

/** Returns the credential's expiry status relative to now. */
export function getExpiryStatus(expiryDate: string | undefined): ExpiryStatus {
  if (!expiryDate) return 'none';
  const expMs = new Date(expiryDate).getTime();
  const now = Date.now();
  if (expMs <= now) return 'expired';
  const daysLeft = (expMs - now) / (1000 * 60 * 60 * 24);
  if (daysLeft <= 30) return 'expiring';
  return 'valid';
}

/** Days remaining until expiry (negative if already expired). */
export function daysUntilExpiry(expiryDate: string): number {
  return Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

/**
 * Whether this credential's FORMAT supports selective disclosure — the
 * "Selective disclosure" vs. "Full presentation" badge shown for a stored
 * credential, not a record of what a specific past presentation actually
 * disclosed.
 *
 * `entry.sdFields.length > 0` alone only measures the SD-JWT-specific
 * mechanism (claims marked with an `_sd` disclosure hash) — it is
 * correctly always `[]` for mdoc and w3c, per CredentialEntry.sdFields'
 * own doc comment, because neither format uses SD-JWT disclosures. Using
 * only that signal made every mdoc credential show "Full presentation"
 * unconditionally, which is wrong: ISO 18013-5 mdoc selective disclosure is
 * a STRUCTURAL property of the format, not an opt-in mechanism — the
 * reader's DeviceRequest names exactly the elements it wants, and
 * DeviceResponse.usingDeviceRequest (see signDeviceResponse.ts /
 * presentMdoc.ts's filterByRequest) discloses only those, never the whole
 * stored record. So "does this format support selective disclosure" is
 * asked per-format: mdoc is always selective; sdjwt uses the sdFields
 * signal (0 disclosures for a plain JWT masquerading as SD-JWT is a real
 * "full presentation" case — see manual-jwt in storeCredential.ts); w3c has
 * no selective mechanism here (no BBS+ support) so it stays "full".
 */
export function supportsSelectiveDisclosure(entry: Pick<CredentialEntry, 'format' | 'sdFields'>): boolean {
  return entry.format === 'mdoc' || entry.sdFields.length > 0;
}

/**
 * Decodes a compact SD-JWT string (header~disc1~disc2~...) into payload + prettyClaims
 * without going through Credo's holder-binding validation. Used as a fallback for
 * issuers (e.g. INJI Certify) that put a non-DID cnf.kid in the credential, which
 * Credo rejects when decoding via firstCredential.
 */
function decodeSdJwtManually(compact: string): {
  payload: Record<string, unknown>;
  prettyClaims: Record<string, unknown>;
} {
  const b64decode = (s: string) => {
    try { return JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; }
  };
  const parts = compact.split('~');
  const payload = b64decode(parts[0].split('.')[1] ?? '') as Record<string, unknown>;
  const prettyClaims: Record<string, unknown> = { ...payload };
  // Apply SD-JWT disclosures: each is base64url([salt, key, value])
  for (let i = 1; i < parts.length; i++) {
    if (!parts[i]) continue;
    const disc = b64decode(parts[i]);
    if (Array.isArray(disc) && disc.length === 3) prettyClaims[disc[1] as string] = disc[2];
  }
  return { payload, prettyClaims };
}

/** Gets the compact SD-JWT string directly from storage without calling firstCredential. */
export function getSdJwtCompact(record: SdJwtVcRecord): string {
  return (record as unknown as { credentialInstances?: Array<{ compactSdJwtVc?: string }> })
    .credentialInstances?.[0]?.compactSdJwtVc ?? '';
}

/**
 * Safely gets prettyClaims from a record without throwing for non-DID cnf.kid issuers (e.g. INJI).
 * Falls back to manual SD-JWT decode when Credo's firstCredential throws.
 */
export function getSdJwtPrettyClaims(record: SdJwtVcRecord): Record<string, unknown> {
  try {
    return record.firstCredential.prettyClaims as Record<string, unknown>;
  } catch {
    return decodeSdJwtManually(getSdJwtCompact(record)).prettyClaims;
  }
}

export const fromSdJwtRecord = (record: SdJwtVcRecord): CredentialEntry => {
  let payload: Record<string, unknown>;
  let prettyClaims: Record<string, unknown>;
  try {
    const sdJwtVc = record.firstCredential;
    payload = sdJwtVc.payload as Record<string, unknown>;
    prettyClaims = sdJwtVc.prettyClaims as Record<string, unknown>;
  } catch {
    // Fallback for issuers with non-DID cnf.kid (e.g. INJI) — decode manually
    const compact = (record as unknown as { credentialInstances?: Array<{ compactSdJwtVc?: string }> })
      .credentialInstances?.[0]?.compactSdJwtVc ?? '';
    ({ payload, prettyClaims } = decodeSdJwtManually(compact));
  }

  const vct = (payload.vct as string) ?? 'Credential';
  const rawIssuer = typeof payload.iss === 'string' ? payload.iss : '';
  const issuanceDate =
    typeof payload.iat === 'number'
      ? new Date(payload.iat * 1000).toISOString()
      : new Date().toISOString();

  const tags = record.getTags() as Record<string, unknown>;

  // type must be resolved before issuer so formatIssuerUrl can match by credential name
  const rawType =
    typeof tags.credentialName === 'string' ? tags.credentialName : vct.split('/').pop() ?? vct;
  const type = cleanCredentialType(rawType);

  // tags.issuerName may hold the raw issuer URL set by Credo — still pass it through
  // formatIssuerUrl so branding labels and DID handling apply
  const rawIssuerResolved = typeof tags.issuerName === 'string' ? tags.issuerName : rawIssuer;
  const issuer = formatIssuerUrl(rawIssuerResolved);

  const expiryDate =
    typeof payload.exp === 'number'
      ? new Date(payload.exp * 1000).toISOString()
      : undefined;

  const reserved = new Set(['iss', 'iat', 'exp', 'nbf', 'sub', 'jti', 'vct', 'cnf', '_sd', '_sd_alg', 'status']);

  // Flatten known wrapper keys iteratively: prettyClaims → vc → credentialSubject.
  // Each pass reads from the current claimsSource so we descend multiple levels.
  // Stops when no wrapper key is found at the current level (max 3 passes).
  const WRAPPER_KEYS = ['credentialSubject', 'vc'];
  let claimsSource = prettyClaims;
  for (let depth = 0; depth < 3; depth++) {
    let advanced = false;
    for (const wk of WRAPPER_KEYS) {
      const val = claimsSource[wk];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        claimsSource = val as Record<string, unknown>;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }

  // Also filter W3C VC meta-keys that appear after descending into credentialSubject
  const w3cMeta = new Set(['@context', 'type', 'id']);
  const selectiveFields = sortClaimKeys(
    Object.keys(claimsSource).filter((k) => !reserved.has(k) && !w3cMeta.has(k)),
  );

  // Claims that are NOT direct keys of the JWT payload are selectively disclosable
  // (they were hashed in the _sd array and disclosed via the SD-JWT disclosure mechanism).
  const directPayloadKeys = new Set(
    Object.keys(payload).filter((k) => k !== '_sd' && k !== '_sd_alg' && !reserved.has(k)),
  );
  const sdFields = selectiveFields.filter((k) => !directPayloadKeys.has(k));

  return {
    id: record.id,
    format: 'sdjwt',
    type,
    issuer,
    issuanceDate,
    expiryDate,
    claims: claimsSource,
    selectiveFields,
    sdFields,
    rawRecord: record,
  };
};

const humanizeSegment = (segment: string): string =>
  segment.split(/[-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const formatIssuerUrl = (raw: string): string => {
  if (!raw) return i18n.t('receive.unknown_issuer');

  // 3. DID:WEB — extract the domain and humanize it
  if (raw.startsWith('did:web:')) {
    const domain = decodeURIComponent(raw.replace('did:web:', '').split('#')[0]);
    return humanizeSegment(domain.split(':')[0].split('.')[0]);
  }

  // 4. Other DIDs (did:key, did:jwk, etc.) — not human readable
  if (raw.startsWith('did:')) return i18n.t('receive.unknown_issuer');

  // 5. URL — take the first meaningful subdomain segment
  try {
    const { hostname } = new URL(raw);
    const generic = new Set(['www', 'api', 'auth', 'id', 'accounts', 'login', 'sso']);
    const parts = hostname.split('.');
    const segment = parts.find((p) => !generic.has(p)) ?? parts[0];
    return humanizeSegment(segment);
  } catch {
    return raw;
  }
};

// Strips format suffixes appended by some issuers/config IDs, then humanizes the result.
// Examples:
//   "UniversityDegree_dc+sd-jwt" → "University Degree"
//   "employment_credential+sd-jwt" → "Employment Credential"
//   "EmploymentCredential#SD-JWT"  → "Employment Credential"
const cleanCredentialType = (raw: string): string => {
  return raw
    .replace(/_?(dc\+[a-z-]+|sd-?jwt|jwt[_-]?vc[_-]?json|jwt_vc|vc)$/i, '') // strip _dc+sd-jwt, _sd-jwt, etc.
    .replace(/#[^#]*$/i, '')     // strip #anything at end
    .replace(/\+[a-z-]+$/i, '') // strip +format-suffix at end
    .replace(/([a-z])([A-Z])/g, '$1 $2') // split camelCase: UniversityDegree → University Degree
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

export const fromW3cRecord = (record: W3cCredentialRecord): CredentialEntry => {
  const vc = record.firstCredential;
  const types = Array.isArray(vc.type)
    ? vc.type.filter((t: string) => t !== 'VerifiableCredential')
    : [];
  const type = types[0] ?? 'VerifiableCredential';

  const rawIssuer =
    typeof vc.issuer === 'string'
      ? vc.issuer
      : (vc.issuer as { id?: string })?.id ?? '';
  const issuer = formatIssuerUrl(rawIssuer);

  const issuanceDate = typeof vc.issuanceDate === 'string'
    ? vc.issuanceDate
    : new Date().toISOString();

  const expiryDate = typeof (vc as Record<string, unknown>).expirationDate === 'string'
    ? (vc as Record<string, unknown>).expirationDate as string
    : undefined;

  const rawSubject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  // W3cCredentialSubject stores custom attributes under .claims
  const claims: Record<string, unknown> = { ...(rawSubject?.claims ?? {}) };

  const selectiveFields = sortClaimKeys(Object.keys(claims));

  return {
    id: record.id,
    format: 'w3c',
    type,
    issuer,
    issuanceDate,
    expiryDate,
    claims,
    selectiveFields,
    sdFields: [],
    rawRecord: record,
  };
};


export const fromW3cV2Record = (record: W3cV2CredentialRecord): CredentialEntry => {
  const vc = record.firstCredential.resolvedCredential;
  const types = Array.isArray(vc.type)
    ? vc.type.filter((t: string) => t !== 'VerifiableCredential')
    : [];
  const type = types[0] ?? 'VerifiableCredential';

  const rawIssuer =
    typeof vc.issuer === 'string'
      ? vc.issuer
      : (vc.issuer as { id?: string })?.id ?? '';
  const issuer = formatIssuerUrl(rawIssuer);

  // W3C VC 2.0 uses validFrom instead of issuanceDate
  const issuanceDate = vc.validFrom ?? new Date().toISOString();

  const expiryDate = typeof vc.validUntil === 'string' ? vc.validUntil : undefined;

  const subject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  const claims: Record<string, unknown> = { ...(subject as object) };

  const W3C_RESERVED = new Set(['id', 'type']);
  const selectiveFields = sortClaimKeys(Object.keys(claims).filter((k) => !W3C_RESERVED.has(k)));

  return {
    id: record.id,
    format: 'w3c',
    type,
    issuer,
    issuanceDate,
    expiryDate,
    claims,
    selectiveFields,
    sdFields: [],
    rawRecord: record as unknown as W3cCredentialRecord,
  };
};

/**
 * Flattens an mdoc's issuerSignedNamespaces into a single claim map.
 *
 * @animo-id/mdoc's CBOR decoder is configured with `mapsAsObjects: false`
 * (its own `encoderDefaults`), so `issuerSignedNamespaces` is a REAL
 * `Map<string, Map<string, unknown>>`, never a plain object — and every
 * nested CBOR map inside a claim value (e.g. each entry of
 * driving_privileges) is a Map too. `Object.values`/`Object.entries` on a
 * Map always return `[]`, because a Map's pairs are internal state, not
 * enumerable own properties — so naively spreading/assigning over one
 * silently produces an empty result. Confirmed by decoding a live-issued
 * mDL's CBOR directly with @animo-id/mdoc: `allIssuerSignedNamespaces`
 * really is a Map, and the naive Object.values(namespaces) loop this
 * replaced never ran a single iteration for any mdoc, ever.
 *
 * Nested Map values (driving_privileges' entries) are left as-is here —
 * `isPlainObject`/`entriesOf`/`keysOf` in this file, and the equivalent
 * handling in registerDigitalCredentials.ts, already treat a Map as a
 * valid keyed structure downstream.
 */
export const flattenMdocNamespaces = (
  namespaces: Map<string, Map<string, unknown>> | Record<string, Record<string, unknown>> | undefined,
): Record<string, unknown> => {
  const claims: Record<string, unknown> = {};
  const namespaceValues: unknown[] = namespaces instanceof Map
    ? Array.from(namespaces.values())
    : Object.values(namespaces ?? {});
  for (const ns of namespaceValues) {
    if (ns instanceof Map) {
      for (const [k, v] of ns.entries()) claims[k] = v;
    } else if (ns && typeof ns === 'object') {
      Object.assign(claims, ns);
    }
  }
  return claims;
};

/**
 * mso_mdoc (ISO/IEC 18013-5, e.g. mDL). Unlike SD-JWT/W3C, mdoc has no issuer/vc
 * envelope to read a display name or issuer identity from — the credentialName/
 * issuerName tags set in storeCredential.ts are the only source for those; claims
 * come from the (possibly multiple) IssuerSigned namespaces, flattened into one
 * object since this wallet only ever displays a single namespace's worth of fields
 * for mDL (org.iso.18013.5.1).
 */
export const fromMdocRecord = (record: MdocRecord): CredentialEntry => {
  const mdoc = record.firstCredential;
  const tags = record.getTags() as Record<string, unknown>;

  const type = typeof tags.credentialName === 'string'
    ? tags.credentialName
    : cleanCredentialType(mdoc.docType.split('.').pop() ?? mdoc.docType);
  const issuer = typeof tags.issuerName === 'string' ? tags.issuerName : i18n.t('receive.unknown_issuer');

  const claims = flattenMdocNamespaces(mdoc.issuerSignedNamespaces);

  let issuanceDate = new Date().toISOString();
  let expiryDate: string | undefined;
  try {
    // mdoc.validityInfo is the MSO's OWN signature-validity window (how long
    // this signed structure is considered fresh before the issuer expects a
    // re-issuance/refresh) — it is NOT the document's real-world expiry.
    // walt.id's issuer-api2 sets validUntil to a fixed default (confirmed
    // empirically: signed 2026-08-24 -> validUntil 2027-08-24, exactly one
    // year, with nothing in issuer2-profiles.conf configuring it) that has
    // no relationship to the mDL's own `expiry_date` data element the
    // operator actually entered (e.g. 2031-08-24 in that same test). Using
    // validUntil as "the credential's expiry" showed a 1-year MSO-refresh
    // date instead of the multi-year real expiry printed on the licence —
    // confirmed by decoding a live-issued mDL's CBOR directly, not assumed.
    // The `expiry_date` claim (ISO 18013-5 mandatory element) is the correct
    // source when present; validUntil is only a fallback for a docType that
    // happens not to carry expiry_date at all.
    // expiry_date decodes to a DateOnly (CBOR tag 1004), not a plain Date —
    // asDate() above already handles both (see its own doc comment); using
    // `instanceof Date` directly here would silently miss every real mDL,
    // since none of them carry expiry_date as a plain Date.
    const claimExpiryDate = asDate(claims.expiry_date);
    if (claimExpiryDate) {
      expiryDate = claimExpiryDate.toISOString();
    }
    const validity = mdoc.validityInfo as { signed?: Date; validUntil?: Date } | undefined;
    if (validity?.signed) issuanceDate = new Date(validity.signed).toISOString();
    if (!expiryDate && validity?.validUntil) expiryDate = new Date(validity.validUntil).toISOString();
  } catch { /* validityInfo/claims not always parseable — fall back to defaults above */ }

  return {
    id: record.id,
    format: 'mdoc',
    type,
    issuer,
    issuanceDate,
    expiryDate,
    claims,
    selectiveFields: sortClaimKeys(Object.keys(claims)),
    sdFields: [],
    rawRecord: record,
  };
};

export const formatClaimKey = (key: string): string =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Sorts claim keys alphabetically by their DISPLAYED label, not the raw
 * key — "birth_date" and "birthDate" should sort next to each other the way
 * they read on screen, not by underscore/casing accidents in the raw key.
 *
 * Every claim source here — mdoc (raw CBOR map/Map entry order, whatever the
 * issuer happened to serialize), SD-JWT (payload order for direct claims,
 * separately reconstructed disclosure order for _sd claims — two different
 * orderings stitched together, not one), W3C (credentialSubject's own key
 * order) — carries a "wire order" that reflects how the credential was
 * encoded, not a normative schema order; none of these formats guarantee
 * field order matches any published schema. Confirmed by user report: same
 * apparent scrambling on both mdoc and SD-JWT credentials, which only makes
 * sense as a shared "we show wire order" behavior, not a per-format parsing
 * bug in either one. Alphabetical-by-label is the chosen fix: applied once
 * here so every `from*Record` constructor gets it uniformly, rather than
 * each one sorting (or forgetting to sort) selectiveFields on its own.
 *
 * Exported (not module-private) so app/present.tsx's disclosure breakdown —
 * a separate screen with its own field list, built from requestedFields (the
 * verifier's own field order in its request, a third wire-order source) —
 * can apply the identical rule. Consistency was the explicit ask: a field
 * should sort the same way regardless of which screen is showing it.
 */
export const sortClaimKeys = (keys: string[]): string[] =>
  [...keys].sort((a, b) => formatClaimKey(a).localeCompare(formatClaimKey(b)));

/**
 * Byte-valued claims (ISO 18013-5 bstr elements: portrait,
 * signature_usual_mark, the biometric_template_* family) decode to
 * Uint8Array. JSON.stringify turns those into {"0":255,"1":216,...} — a wall
 * of digits where a photo belongs. isImageClaim lets the UI render them
 * properly instead; asDataUri builds the source.
 *
 * Sniffing the magic bytes rather than trusting the field name keeps this
 * working for any bstr element, and avoids emitting an <Image> for a byte
 * string that is not an image at all (signature_usual_mark may be either).
 */
export const asBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array((value as ArrayBufferView).buffer);
  return null;
};

export const imageMimeType = (value: unknown): string | null => {
  const b = asBytes(value);
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  return null;
};

export const isImageClaim = (value: unknown): boolean => imageMimeType(value) !== null;

/** data: URI for an image-valued claim, or null when the claim is not an image. */
export const claimImageUri = (value: unknown): string | null => {
  const mime = imageMimeType(value);
  const bytes = asBytes(value);
  if (!mime || !bytes) return null;
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${global.btoa(binary)}`;
};

/**
 * True when the value is a Date, an @animo-id/mdoc DateOnly (CBOR tag 1004
 * full-date — e.g. birth_date/issue_date/expiry_date on a real mDL), or an
 * ISO date/date-time string.
 *
 * DateOnly wraps a real Date in `.date` but is NOT `instanceof Date` — it's
 * its own class (node_modules/@animo-id/mdoc/dist/index.js: `var DateOnly =
 * class _DateOnly { constructor(date) { this.date = ... } ... }`). Without
 * this check, isPlainObject() sees "an object, not a Date, not bytes" and
 * treats it as a generic keyed structure — confirmed live: claimShape(a
 * real DateOnly) produced `{ kind: 'list', rows: [{ key: 'Date', value:
 * '...' }] }` instead of a plain formatted date, i.e. every individual
 * mdoc date field silently risked rendering as a one-row "Date: ..." list
 * instead of a clean date string.
 */
const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value instanceof DateOnly) {
    // DateOnly's `.date` field is a real Date, set in its constructor
    // (node_modules/@animo-id/mdoc/dist/index.js), but its own .d.ts marks
    // it private — accessible at runtime, blocked at the type level. `value
    // as unknown as { date: unknown }` (rather than DateOnly's own shape)
    // sidesteps that without asserting a shape TS thinks overlaps DateOnly.
    const d = (value as unknown as { date: unknown }).date;
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/**
 * ISO 18013-5 full-date elements (birth_date, issue_date, expiry_date,
 * portrait_capture_date, and the dates nested inside driving_privileges)
 * decode to Date. Rendering them raw produced "1990-05-14T00:00:00.000Z" —
 * a timestamp for a value that carries no time at all.
 *
 * Formatted in the holder's own language via the active i18n locale, and
 * date-only: a full-date has no meaningful time component, so showing
 * midnight UTC invites the reader to mistake a timezone artifact for data.
 */
const formatDate = (d: Date): string => {
  try {
    return new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
};

export const formatClaimValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? i18n.t('common.yes') : i18n.t('common.no');
  if (typeof value === 'number') return String(value);

  const date = asDate(value);
  if (date) return formatDate(date);

  if (typeof value === 'string') return value.length > 0 ? value : '—';

  // Byte strings: never dump the digits. An image is rendered by the UI via
  // claimImageUri; anything else gets a size summary.
  const bytes = asBytes(value);
  if (bytes) {
    if (bytes.length === 0) return '—';
    const mime = imageMimeType(value);
    return mime ? `${mime} · ${Math.round(bytes.length / 1024)} KB` : `${bytes.length} bytes`;
  }

  // Nested structures: see claimShape, which the UI uses to render a table
  // or a property list. This text form is the fallback for callers that can
  // only take a string, and for nesting inside a table cell.
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    if (!value.some(isPlainObject)) {
      return value.map((v) => formatClaimValue(v)).join(', ');
    }
    return value.map((v) => formatClaimValue(v)).join('\n');
  }
  if (isPlainObject(value)) {
    const parts = objectEntries(value)
      .map(([k, v]) => `${formatClaimKey(k)}: ${formatClaimValue(v)}`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  return String(value);
};

/**
 * A keyed data structure — a plain object OR a Map — but not a Date, a
 * DateOnly, a byte string, or an array. All these satisfy
 * `typeof x === 'object'` and each needs different treatment, so every
 * structural branch tests this rather than typeof alone.
 *
 * Map is included because @animo-id/mdoc's CBOR decoder is configured with
 * `mapsAsObjects: false` (its own encoderDefaults), so every nested CBOR map
 * inside an mdoc claim — e.g. each entry of driving_privileges — arrives as
 * a real JS Map, not a plain object. Object.keys/Object.entries return `[]`
 * for a Map (its pairs are internal state, not enumerable own properties),
 * so treating a Map as "not a plain object" silently rendered every nested
 * mdoc field as an empty {} — confirmed by decoding a live-issued mDL's CBOR
 * and finding driving_privileges correctly shaped upstream, with the empty
 * render only reproducible client-side once its entries were real Maps.
 *
 * DateOnly is excluded for the same class of reason: it is not `instanceof
 * Date`, so without this exclusion every mdoc full-date field (birth_date,
 * issue_date, expiry_date, ...) rendered as a one-row list `{ Date:
 * '<formatted date>' }` instead of a plain formatted date — confirmed live
 * against the real @animo-id/mdoc DateOnly class, not assumed.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> | Map<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
  && !(v instanceof Date) && !(v instanceof DateOnly) && asBytes(v) === null;

/** Key/value pairs of a plain object OR a Map, uniformly. */
const entriesOf = (v: Record<string, unknown> | Map<string, unknown>): [string, unknown][] =>
  v instanceof Map ? Array.from(v.entries()) : Object.entries(v);

/** Keys of a plain object OR a Map, uniformly, in insertion/definition order. */
const keysOf = (v: Record<string, unknown> | Map<string, unknown>): string[] =>
  v instanceof Map ? Array.from(v.keys()) : Object.keys(v);

/** Object/Map entries with empty values dropped, so blank rows/columns vanish. */
const objectEntries = (v: unknown): [string, unknown][] =>
  entriesOf(v as Record<string, unknown> | Map<string, unknown>)
    .filter(([, val]) => val !== null && val !== undefined && val !== '');

/**
 * How a claim should be laid out. The UI switches on `kind`; every decision
 * is derived from the value's own shape, so a docType this wallet has never
 * seen renders correctly without a per-field rule.
 *
 *   table  — array of objects: one column per key, one row per entry
 *   list   — a single object: property name beside its value
 *   scalar — everything else, already rendered by formatClaimValue
 *
 * Columns are the union of keys in first-seen order, not the first entry's
 * keys: entries in an mdoc array are not required to carry identical key
 * sets, and a later entry's extra field would otherwise be dropped silently.
 */
export type ClaimShape =
  | { kind: 'scalar'; text: string }
  | { kind: 'list'; rows: { key: string; value: string }[] }
  | { kind: 'table'; columns: string[]; rows: string[][] };

export const claimShape = (value: unknown): ClaimShape => {
  if (Array.isArray(value) && value.length > 0 && value.every(isPlainObject)) {
    // Union of keys, THEN alphabetized by label — same wire-order problem as
    // selectiveFields (see sortClaimKeys' doc comment): first-seen order
    // here still reflects each entry's raw CBOR/JSON key order, not a
    // schema. Sorted after union so a later entry's extra column is still
    // included, just not pinned to the end.
    const columns: string[] = [];
    for (const entry of value as (Record<string, unknown> | Map<string, unknown>)[]) {
      for (const k of keysOf(entry)) if (!columns.includes(k)) columns.push(k);
    }
    const sortedColumns = sortClaimKeys(columns);
    const rows = (value as (Record<string, unknown> | Map<string, unknown>)[]).map((entry) =>
      sortedColumns.map((c) => {
        const cell = entry instanceof Map ? entry.get(c) : entry[c];
        return cell === null || cell === undefined || cell === ''
          ? '—'
          : formatClaimValue(cell);
      }),
    );
    return { kind: 'table', columns: sortedColumns.map(formatClaimKey), rows };
  }

  if (isPlainObject(value)) {
    const rows = objectEntries(value)
      .sort(([a], [b]) => formatClaimKey(a).localeCompare(formatClaimKey(b)))
      .map(([k, v]) => ({ key: formatClaimKey(k), value: formatClaimValue(v) }));
    if (rows.length > 0) return { kind: 'list', rows };
  }

  return { kind: 'scalar', text: formatClaimValue(value) };
};
