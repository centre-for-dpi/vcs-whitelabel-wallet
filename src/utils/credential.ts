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
  const payload = record.compactSdJwtVc
    ? decodeSdJwtPayload(record.compactSdJwtVc)
    : {};

  const claims = (payload as Record<string, unknown>) ?? {};
  const vct = (claims.vct as string) ?? 'Credential';
  const issuer =
    typeof claims.iss === 'string' ? claims.iss : 'Unknown issuer';
  const issuanceDate =
    typeof claims.iat === 'number'
      ? new Date(claims.iat * 1000).toISOString()
      : new Date().toISOString();

  // Fields that can be selectively disclosed (exclude reserved JWT claims)
  const reserved = new Set(['iss', 'iat', 'exp', 'nbf', 'sub', 'jti', 'vct', 'cnf', '_sd', '_sd_alg']);
  const selectiveFields = Object.keys(claims).filter((k) => !reserved.has(k));

  return {
    id: record.id,
    format: 'sdjwt',
    type: vct.split('/').pop() ?? vct,
    issuer,
    issuanceDate,
    claims,
    selectiveFields,
    rawRecord: record,
  };
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

  return {
    id: record.id,
    format: 'w3c',
    type,
    issuer,
    issuanceDate,
    claims,
    selectiveFields: [],
    rawRecord: record,
  };
};

const decodeSdJwtPayload = (compact: string): Record<string, unknown> => {
  try {
    const parts = compact.split('~')[0].split('.');
    if (parts.length < 2) return {};
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
    return JSON.parse(json);
  } catch {
    return {};
  }
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
