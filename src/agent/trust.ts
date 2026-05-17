export type TrustStatus = 'trusted' | 'unknown' | 'untrusted';

export type TrustEntry = {
  /** Substring or regex pattern to match against the issuer/verifier URL. */
  pattern: string;
  name?: string;
};

/**
 * Checks a URL against a trust registry.
 * Returns 'trusted' if any entry pattern matches, otherwise 'unknown'.
 * 'untrusted' is reserved for future explicit blocklists.
 */
export function checkTrust(url: string, registry: TrustEntry[]): TrustStatus {
  if (!url || registry.length === 0) return 'unknown';
  const normalized = url.toLowerCase();
  for (const entry of registry) {
    try {
      if (new RegExp(entry.pattern, 'i').test(normalized)) return 'trusted';
    } catch {
      if (normalized.includes(entry.pattern.toLowerCase())) return 'trusted';
    }
  }
  return 'unknown';
}

export const TRUST_COLORS: Record<TrustStatus, string> = {
  trusted: '#059669',
  unknown: '#D97706',
  untrusted: '#DC2626',
};

export const TRUST_ICONS: Record<TrustStatus, string> = {
  trusted: '✓',
  unknown: '⚠',
  untrusted: '✗',
};
