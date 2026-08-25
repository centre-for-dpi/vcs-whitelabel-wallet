import { flattenMdocNamespaces, claimShape, formatClaimValue, supportsSelectiveDisclosure } from '../utils/credential';

/**
 * @animo-id/mdoc's CBOR decoder is configured with `mapsAsObjects: false`
 * (its own `encoderDefaults`, node_modules/@animo-id/mdoc/dist/index.js —
 * `var encoderDefaults = { tagUint8Array: false, useRecords: false,
 * mapsAsObjects: false }`), so both `issuerSignedNamespaces` itself and
 * every nested CBOR map inside a claim value (e.g. each entry of
 * driving_privileges) are real JS `Map`s, never plain objects. Confirmed by
 * decoding a live-issued mDL's CBOR directly against the real library, not
 * assumed from its .d.ts types alone.
 *
 * These tests build the exact Map-of-Maps shape the real decoder produces
 * and drive it through flattenMdocNamespaces + claimShape end-to-end,
 * without touching a running issuer or Credo's own parsing (which the
 * empirical VPS-based verification already covered separately).
 */
describe('flattenMdocNamespaces', () => {
  test('flattens a real Map<string, Map<string, unknown>> into a plain claim record', () => {
    const namespaces = new Map([
      ['org.iso.18013.5.1', new Map<string, unknown>([
        ['family_name', 'Perez'],
        ['given_name', 'Ana Maria'],
      ])],
    ]);
    const claims = flattenMdocNamespaces(namespaces);
    expect(claims).toEqual({ family_name: 'Perez', given_name: 'Ana Maria' });
  });

  test('merges multiple namespaces into one flat claim record', () => {
    const namespaces = new Map([
      ['org.iso.18013.5.1', new Map<string, unknown>([['family_name', 'Perez']])],
      ['org.iso.18013.5.1.aamva', new Map<string, unknown>([['DHS_compliance', 'F']])],
    ]);
    const claims = flattenMdocNamespaces(namespaces);
    expect(claims).toEqual({ family_name: 'Perez', DHS_compliance: 'F' });
  });

  test('never returns an empty result for a non-empty Map input (the actual bug)', () => {
    // The bug this guards: Object.values(aMap) is [] for any Map, so a naive
    // `Object.assign(claims, ...Object.values(namespaces))` silently produced
    // {} for every mdoc, no matter how many claims it actually carried.
    const namespaces = new Map([
      ['org.iso.18013.5.1', new Map<string, unknown>([['document_number', '0001112223']])],
    ]);
    const claims = flattenMdocNamespaces(namespaces);
    expect(Object.keys(claims).length).toBeGreaterThan(0);
  });

  test('still works for a plain-object namespaces shape (defensive fallback)', () => {
    const namespaces = { 'org.iso.18013.5.1': { family_name: 'Perez' } } as unknown as Map<
      string,
      Map<string, unknown>
    >;
    const claims = flattenMdocNamespaces(namespaces);
    expect(claims).toEqual({ family_name: 'Perez' });
  });

  test('returns {} for undefined input rather than throwing', () => {
    expect(flattenMdocNamespaces(undefined)).toEqual({});
  });
});

describe('claimShape on driving_privileges-shaped data (the reported bug)', () => {
  test('renders a table with real columns/rows when entries are Maps, not [{},{}]', () => {
    // Exactly what a live-issued mDL's driving_privileges decodes to today:
    // an array of Maps, one per vehicle category.
    const drivingPrivileges = [
      new Map<string, unknown>([
        ['vehicle_category_code', 'B'],
        ['issue_date', new Date('2026-08-24')],
        ['expiry_date', new Date('2031-08-24')],
      ]),
      new Map<string, unknown>([
        ['vehicle_category_code', 'B'],
        ['issue_date', new Date('2026-08-24')],
        ['expiry_date', new Date('2031-08-24')],
      ]),
    ];

    const shape = claimShape(drivingPrivileges);
    expect(shape.kind).toBe('table');
    if (shape.kind !== 'table') return;

    // The bug produced zero columns and rows of {} — assert real content.
    expect(shape.columns.length).toBeGreaterThan(0);
    expect(shape.columns).toEqual(
      expect.arrayContaining(['Vehicle Category Code', 'Issue Date', 'Expiry Date']),
    );
    expect(shape.rows).toHaveLength(2);
    for (const row of shape.rows) {
      expect(row.some((cell) => cell !== '—' && cell !== '{}')).toBe(true);
    }
    // Vehicle category code must be readable, not the JSON.stringify(Map) => "{}"
    expect(shape.rows[0]).toContain('B');
  });

  test('formatClaimValue never renders a Map as "{}"', () => {
    const entry = new Map<string, unknown>([['vehicle_category_code', 'B']]);
    const text = formatClaimValue(entry);
    expect(text).not.toBe('{}');
    expect(text).toContain('B');
  });

  test('a plain-object array (non-mdoc credentials) still renders as a table exactly as before', () => {
    // Regression guard: this fix must not change behavior for the
    // non-mdoc/plain-object case other claim types already relied on.
    const value = [
      { code: 'A', note: 'x' },
      { code: 'B', note: 'y' },
    ];
    const shape = claimShape(value);
    expect(shape.kind).toBe('table');
    if (shape.kind !== 'table') return;
    expect(shape.rows).toEqual([['A', 'x'], ['B', 'y']]);
  });
});

describe('claim field ordering (reported: fields display in CBOR/JSON wire order, not the schema order)', () => {
  test('table columns sort alphabetically by label, not by first-seen wire order', () => {
    // Wire order deliberately reversed/scrambled relative to alphabetical —
    // mirrors what a real issuer's CBOR serialization order looks like.
    const drivingPrivileges = [
      new Map<string, unknown>([
        ['expiry_date', new Date('2031-08-24')],
        ['vehicle_category_code', 'B'],
        ['issue_date', new Date('2026-08-24')],
      ]),
    ];
    const shape = claimShape(drivingPrivileges);
    expect(shape.kind).toBe('table');
    if (shape.kind !== 'table') return;
    expect(shape.columns).toEqual(['Expiry Date', 'Issue Date', 'Vehicle Category Code']);
  });

  test('a later entry’s extra column is still included after sorting, not dropped', () => {
    const value = [
      new Map<string, unknown>([['zebra', 'z1']]),
      new Map<string, unknown>([['zebra', 'z2'], ['apple', 'a1']]),
    ];
    const shape = claimShape(value);
    expect(shape.kind).toBe('table');
    if (shape.kind !== 'table') return;
    expect(shape.columns).toEqual(['Apple', 'Zebra']);
  });

  test('list rows (a single nested object) sort alphabetically by label', () => {
    const value = { zebra: 'z', apple: 'a', mango: 'm' };
    const shape = claimShape(value);
    expect(shape.kind).toBe('list');
    if (shape.kind !== 'list') return;
    expect(shape.rows.map((r) => r.key)).toEqual(['Apple', 'Mango', 'Zebra']);
  });
});

describe('supportsSelectiveDisclosure — the "Selective disclosure"/"Full presentation" badge', () => {
  test('mdoc is always selective, regardless of sdFields (structural property of ISO 18013-5)', () => {
    expect(supportsSelectiveDisclosure({ format: 'mdoc', sdFields: [] })).toBe(true);
  });

  test('sdjwt with real disclosures is selective', () => {
    expect(supportsSelectiveDisclosure({ format: 'sdjwt', sdFields: ['given_name'] })).toBe(true);
  });

  test('sdjwt with zero disclosures (e.g. a plain JWT via manual-jwt) is NOT selective', () => {
    expect(supportsSelectiveDisclosure({ format: 'sdjwt', sdFields: [] })).toBe(false);
  });

  test('w3c has no selective mechanism here and is never selective', () => {
    expect(supportsSelectiveDisclosure({ format: 'w3c', sdFields: [] })).toBe(false);
  });
});
