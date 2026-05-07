import type { SdJwtVcRecord, W3cCredentialRecord, W3cV2CredentialRecord } from '@credo-ts/core';
import { branding } from '../../branding.config';

export type CredentialEntry = {
  id: string;
  format: 'sdjwt' | 'w3c';
  type: string;
  issuer: string;
  issuanceDate: string;
  claims: Record<string, unknown>;
  selectiveFields: string[];
  rawRecord: SdJwtVcRecord | W3cCredentialRecord;
};

export const fromSdJwtRecord = (record: SdJwtVcRecord): CredentialEntry => {
  const sdJwtVc = record.firstCredential;
  const payload = sdJwtVc.payload as Record<string, unknown>;
  const prettyClaims = sdJwtVc.prettyClaims as Record<string, unknown>;

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
  const issuer = formatIssuerUrl(rawIssuerResolved, type);

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
  const selectiveFields = Object.keys(claimsSource).filter(
    (k) => !reserved.has(k) && !w3cMeta.has(k),
  );

  return {
    id: record.id,
    format: 'sdjwt',
    type,
    issuer,
    issuanceDate,
    claims: claimsSource,
    selectiveFields,
    rawRecord: record,
  };
};

const humanizeSegment = (segment: string): string =>
  segment.split(/[-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const formatIssuerUrl = (raw: string, credentialType?: string): string => {
  if (!raw && !credentialType) return 'Emisor desconocido';

  // 1. Match by credential type name against branding issuers — highest priority
  // Normalize both sides: lowercase + remove spaces to handle camelCase vs spaced variants
  if (credentialType) {
    const normalizedType = credentialType.toLowerCase().replace(/\s+/g, '');
    const byType = branding.issuers.find((i) =>
      (i.credentials as readonly string[]).some(
        (c) => c.toLowerCase().replace(/\s+/g, '') === normalizedType,
      ),
    );
    if (byType) return byType.label;
  }

  // 2. Match by issuer URL against branding issuers
  if (raw) {
    const byUrl = branding.issuers.find(
      (i) => raw.startsWith(i.url) || i.url.startsWith(raw),
    );
    if (byUrl) return byUrl.label;
  }

  if (!raw) return 'Emisor desconocido';

  // 3. DID:WEB — extract the domain and humanize it
  if (raw.startsWith('did:web:')) {
    const domain = decodeURIComponent(raw.replace('did:web:', '').split('#')[0]);
    return humanizeSegment(domain.split(':')[0].split('.')[0]);
  }

  // 4. Other DIDs (did:key, did:jwk, etc.) — not human readable
  if (raw.startsWith('did:')) return 'Emisor desconocido';

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
  const issuer = formatIssuerUrl(rawIssuer, type);

  const issuanceDate = typeof vc.issuanceDate === 'string'
    ? vc.issuanceDate
    : new Date().toISOString();

  const rawSubject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  // W3cCredentialSubject stores custom attributes under .claims
  const claims: Record<string, unknown> = { ...(rawSubject?.claims ?? {}) };

  const selectiveFields = Object.keys(claims);

  return {
    id: record.id,
    format: 'w3c',
    type,
    issuer,
    issuanceDate,
    claims,
    selectiveFields,
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
  const issuer = formatIssuerUrl(rawIssuer, type);

  // W3C VC 2.0 uses validFrom instead of issuanceDate
  const issuanceDate = vc.validFrom ?? new Date().toISOString();

  const subject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  const claims: Record<string, unknown> = { ...(subject as object) };

  const W3C_RESERVED = new Set(['id', 'type']);
  const selectiveFields = Object.keys(claims).filter((k) => !W3C_RESERVED.has(k));

  return {
    id: record.id,
    format: 'w3c',
    type,
    issuer,
    issuanceDate,
    claims,
    selectiveFields,
    rawRecord: record as unknown as W3cCredentialRecord,
  };
};

export const formatClaimKey = (key: string): string =>
  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const formatClaimValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};
