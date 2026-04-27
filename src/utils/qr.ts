export type QrType =
  | { kind: 'oid4vci'; url: string }
  | { kind: 'oid4vp'; url: string }
  | { kind: 'didcomm_oob'; url: string }
  | { kind: 'unknown'; url: string };

export const detectQrType = (raw: string): QrType => {
  const url = raw.trim();

  if (
    url.startsWith('openid-credential-offer://') ||
    url.includes('credential_offer=') ||
    url.includes('credential_offer_uri=')
  ) {
    return { kind: 'oid4vci', url };
  }

  if (
    url.startsWith('openid4vp://') ||
    url.startsWith('siopv2://') ||
    url.includes('request_uri=') ||
    url.includes('response_type=vp_token')
  ) {
    return { kind: 'oid4vp', url };
  }

  // DIDComm OOB invitation — encoded as ?d_m= or oob= query param
  if (url.includes('?d_m=') || url.includes('?oob=') || url.startsWith('didcomm://')) {
    return { kind: 'didcomm_oob', url };
  }

  return { kind: 'unknown', url };
};
