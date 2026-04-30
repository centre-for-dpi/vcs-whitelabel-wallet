import type { SdJwtVcRecord, W3cCredentialRecord } from '@credo-ts/core';

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
  // prettyClaims includes all selectively-disclosed attributes with values applied
  const prettyClaims = sdJwtVc.prettyClaims as Record<string, unknown>;

  const vct = (payload.vct as string) ?? 'Credential';
  const rawIssuer = typeof payload.iss === 'string' ? payload.iss : '';
  const issuanceDate =
    typeof payload.iat === 'number'
      ? new Date(payload.iat * 1000).toISOString()
      : new Date().toISOString();

  // Prefer display names stored as tags at receive time
  const tags = record.getTags() as Record<string, unknown>;
  const issuer =
    typeof tags.issuerName === 'string' ? tags.issuerName : formatIssuerUrl(rawIssuer);
  const type =
    typeof tags.credentialName === 'string' ? tags.credentialName : vct.split('/').pop() ?? vct;

  const reserved = new Set(['iss', 'iat', 'exp', 'nbf', 'sub', 'jti', 'vct', 'cnf', '_sd', '_sd_alg', 'status']);
  const selectiveFields = Object.keys(prettyClaims).filter((k) => !reserved.has(k));

  return {
    id: record.id,
    format: 'sdjwt',
    type,
    issuer,
    issuanceDate,
    claims: prettyClaims,
    selectiveFields,
    rawRecord: record,
  };
};

const formatIssuerUrl = (url: string): string => {
  if (!url) return 'Unknown issuer';
  try {
    const u = new URL(url);
    const segment = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
    return segment.split(/[-_]+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  } catch {
    return url;
  }
};

export const fromW3cRecord = (record: W3cCredentialRecord): CredentialEntry => {
  const vc = record.credential;
  const types = Array.isArray(vc.type)
    ? vc.type.filter((t: string) => t !== 'VerifiableCredential')
    : [];
  const type = types[0] ?? 'VerifiableCredential';

  const issuer =
    typeof vc.issuer === 'string'
      ? vc.issuer
      : (vc.issuer as { id?: string })?.id ?? 'Unknown issuer';

  const issuanceDate =
    vc.issuanceDate instanceof Date
      ? vc.issuanceDate.toISOString()
      : typeof vc.issuanceDate === 'string'
      ? vc.issuanceDate
      : new Date().toISOString();

  const subject = Array.isArray(vc.credentialSubject)
    ? vc.credentialSubject[0]
    : vc.credentialSubject;
  const claims: Record<string, unknown> = { ...subject };

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
    rawRecord: record,
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
