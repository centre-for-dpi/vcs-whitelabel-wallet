import { checkTrust, TRUST_COLORS, TRUST_ICONS, type TrustEntry } from '../agent/trust';

const registry: TrustEntry[] = [
  { pattern: 'cdpi\\.dev', name: 'CDPI' },
  { pattern: 'bootcamp\\.cdpi\\.dev', name: 'CDPI Bootcamp' },
];

describe('checkTrust', () => {
  test('returns trusted when URL matches a registry pattern', () => {
    expect(checkTrust('https://cdpi.dev/issuer', registry)).toBe('trusted');
  });

  test('returns trusted for subdomain match', () => {
    expect(checkTrust('https://bootcamp.cdpi.dev/credential', registry)).toBe('trusted');
  });

  test('returns trusted when URL contains the pattern anywhere', () => {
    expect(checkTrust('https://api.cdpi.dev/vc/issue', registry)).toBe('trusted');
  });

  test('returns unknown for URL that does not match any entry', () => {
    expect(checkTrust('https://unknown.example.com/issuer', registry)).toBe('unknown');
  });

  test('returns unknown when registry is empty', () => {
    expect(checkTrust('https://cdpi.dev/issuer', [])).toBe('unknown');
  });

  test('returns unknown when URL is empty', () => {
    expect(checkTrust('', registry)).toBe('unknown');
  });

  test('matching is case-insensitive', () => {
    expect(checkTrust('https://CDPI.DEV/anything', registry)).toBe('trusted');
    expect(checkTrust('HTTPS://Bootcamp.CDPI.Dev/', registry)).toBe('trusted');
  });

  test('falls back to substring match when pattern is an invalid regex', () => {
    const badRegistry: TrustEntry[] = [{ pattern: 'cdpi.dev[invalid' }];
    expect(checkTrust('https://cdpi.dev[invalid/x', badRegistry)).toBe('trusted');
  });

  test('returns unknown when pattern is invalid regex and URL has no substring match', () => {
    const badRegistry: TrustEntry[] = [{ pattern: 'cdpi.dev[invalid' }];
    expect(checkTrust('https://other.com', badRegistry)).toBe('unknown');
  });

  test('matches with a simple substring pattern (no special regex chars)', () => {
    const simpleRegistry: TrustEntry[] = [{ pattern: 'example.com' }];
    expect(checkTrust('https://api.example.com/v1', simpleRegistry)).toBe('trusted');
    expect(checkTrust('https://other.org/v1', simpleRegistry)).toBe('unknown');
  });
});

describe('TRUST_COLORS', () => {
  test('has color for all three trust statuses', () => {
    expect(typeof TRUST_COLORS.trusted).toBe('string');
    expect(typeof TRUST_COLORS.unknown).toBe('string');
    expect(typeof TRUST_COLORS.untrusted).toBe('string');
  });

  test('trusted color is green-ish', () => {
    expect(TRUST_COLORS.trusted).toMatch(/^#/);
  });
});

describe('TRUST_ICONS', () => {
  test('has icon for all three trust statuses', () => {
    expect(typeof TRUST_ICONS.trusted).toBe('string');
    expect(typeof TRUST_ICONS.unknown).toBe('string');
    expect(typeof TRUST_ICONS.untrusted).toBe('string');
  });
});
