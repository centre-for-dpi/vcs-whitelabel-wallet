// @credo-ts/core's ESM build isn't set up to be imported unmocked under Jest
// (see selectCredentials.test.ts's jest.mock for the established pattern).
// credential.ts only imports MdocRecord etc. as TYPES (import type), so it
// never touches the real module at runtime — but THIS TEST needs a real
// Mdoc shaped exactly like Credo's real one, so we build it from
// @animo-id/mdoc's parseIssuerSigned directly (confirmed, by reading
// node_modules/@credo-ts/core/build/modules/mdoc/Mdoc.mjs, that Credo's own
// Mdoc.fromBase64Url / .issuerSignedNamespaces / .validityInfo are thin
// wrappers over exactly this) rather than importing @credo-ts/core itself.
//
// Confirmed live (node --experimental-vm-modules, no Jest) what Credo's
// real Mdoc.issuerSignedNamespaces actually returns for this exact
// credential: the OUTER namespace map IS flattened to a plain object by
// Credo's own Object.fromEntries call (Mdoc.mjs:94-96) — so
// flattenMdocNamespaces' Map-handling for the outer level is defensive,
// not strictly required against today's Credo version. But Credo's
// flattening is only ONE level deep: driving_privileges (a claim VALUE, not
// a namespace) is untouched by it and its entries are still real
// @animo-id/mdoc Maps — confirmed in that same live run. That is the
// exact bug this whole fix addresses.
import { parseIssuerSigned } from '@animo-id/mdoc';
import { fromMdocRecord, formatClaimValue, claimShape } from '../utils/credential';

/**
 * A real mDL issued by waltid/issuer-api2:0.23.1 during this session's live
 * diagnosis (not a hand-built/synthetic CBOR). Fixed here so the test is
 * reproducible without hitting the VPS. Known-good values decoded from this
 * same credential independently with cbor2 (Python) before this fix was
 * written:
 *   - MSO validityInfo: signed 2026-08-24T13:02:48Z, validUntil
 *     2027-08-24T13:02:48Z (walt.id's own 1-year default — NOT configured
 *     anywhere in issuer2-profiles.conf, and unrelated to the licence's own
 *     expiry_date below).
 *   - expiry_date data element (CBOR tag 1004 / DateOnly): 2031-08-24.
 *   - issue_date data element: 2026-08-24.
 *   - birth_date data element: 1990-05-15.
 */
const REAL_ISSUED_MDL_CBOR_B64URL = 'ompuYW1lU3BhY2VzoXFvcmcuaXNvLjE4MDEzLjUuMY_YGFhjpGhkaWdlc3RJRABmcmFuZG9tWBj8hWar5w5XwPswyh5qHdtObuTSnKqGIVZxZWxlbWVudElkZW50aWZpZXJ2dW5fZGlzdGluZ3Vpc2hpbmdfc2lnbmxlbGVtZW50VmFsdWVg2BhYb6RoZGlnZXN0SUQBZnJhbmRvbVgYWBlF-cqJVKIyrSoNazb_vFHngDtQOfkFcWVsZW1lbnRJZGVudGlmaWVydXBvcnRyYWl0X2NhcHR1cmVfZGF0ZWxlbGVtZW50VmFsdWXZA-xqMjAyNi0wOC0yNNgYWPekaGRpZ2VzdElEAmZyYW5kb21YGA0RH3deGvoQ9kkJ-h-y0BIMVJHU2NJuNHFlbGVtZW50SWRlbnRpZmllcnJkcml2aW5nX3ByaXZpbGVnZXNsZWxlbWVudFZhbHVlgqN1dmVoaWNsZV9jYXRlZ29yeV9jb2RlYUJqaXNzdWVfZGF0ZdkD7GoyMDI2LTA4LTI0a2V4cGlyeV9kYXRl2QPsajIwMzEtMDgtMjSjdXZlaGljbGVfY2F0ZWdvcnlfY29kZWFCamlzc3VlX2RhdGXZA-xqMjAyNi0wOC0yNGtleHBpcnlfZGF0ZdkD7GoyMDMxLTA4LTI02BhYZqRoZGlnZXN0SUQDZnJhbmRvbVgYt2lNIWcmyTz2p4U64l6Hmi0hzi4eXTHGcWVsZW1lbnRJZGVudGlmaWVyb2RvY3VtZW50X251bWJlcmxlbGVtZW50VmFsdWVqMDAwMTExMjIyM9gYWGSkaGRpZ2VzdElEBGZyYW5kb21YGLXDrSYDcZzK-00Tu2Q-FfRuootVnjtbZXFlbGVtZW50SWRlbnRpZmllcmpiaXJ0aF9kYXRlbGVsZW1lbnRWYWx1ZdkD7GoxOTkwLTA1LTE12BhYZaRoZGlnZXN0SUQFZnJhbmRvbVgYnNxcgvLRGz2EomxsLzwjLgtnb-Ta1oy3cWVsZW1lbnRJZGVudGlmaWVya2V4cGlyeV9kYXRlbGVsZW1lbnRWYWx1ZdkD7GoyMDMxLTA4LTI02BhYWKRoZGlnZXN0SUQGZnJhbmRvbVgYYqcT0gVNPBZI5nq2b80YPeqz5j5kY-6icWVsZW1lbnRJZGVudGlmaWVya2FnZV9vdmVyXzIxbGVsZW1lbnRWYWx1ZfTYGFhgpGhkaWdlc3RJRAdmcmFuZG9tWBhrhcXu3JWduPNAHgFBzdQt0ZSOoz9EGypxZWxlbWVudElkZW50aWZpZXJqZ2l2ZW5fbmFtZWxlbGVtZW50VmFsdWVpQW5hIE1hcmlh2BhYVaRoZGlnZXN0SUQIZnJhbmRvbVgYxyv3rt-LpiwPCWKlKoQ6Owd_BAv5QhMpcWVsZW1lbnRJZGVudGlmaWVyaHBvcnRyYWl0bGVsZW1lbnRWYWx1ZUDYGFhYpGhkaWdlc3RJRAlmcmFuZG9tWBi-hogSLFBwXdUDClTNg6leeQWpwTGnh11xZWxlbWVudElkZW50aWZpZXJrYWdlX292ZXJfMThsZWxlbWVudFZhbHVl9NgYWGSkaGRpZ2VzdElECmZyYW5kb21YGIK2fGjcbOcIqy9bSL-dF-6QvLNGJ20nRHFlbGVtZW50SWRlbnRpZmllcmppc3N1ZV9kYXRlbGVsZW1lbnRWYWx1ZdkD7GoyMDI2LTA4LTI02BhYXqRoZGlnZXN0SUQLZnJhbmRvbVgYteMDqwn0UKZ9PM9zSJaPfJm6soX9LjeccWVsZW1lbnRJZGVudGlmaWVyb2lzc3VpbmdfY291bnRyeWxlbGVtZW50VmFsdWViRE_YGFhlpGhkaWdlc3RJRAxmcmFuZG9tWBiuwIt1aKzMWSwXaATC-qyQx-d066JkeuVxZWxlbWVudElkZW50aWZpZXJxaXNzdWluZ19hdXRob3JpdHlsZWxlbWVudFZhbHVlZ0lOVFJBTlTYGFhmpGhkaWdlc3RJRA1mcmFuZG9tWBjnJnZBa77jwSXH0xoTpsqFpig1uSr-SrZxZWxlbWVudElkZW50aWZpZXJ0aXNzdWluZ19qdXJpc2RpY3Rpb25sZWxlbWVudFZhbHVlZURPLTAx2BhYXaRoZGlnZXN0SUQOZnJhbmRvbVgYa_G1Law7EU22bjeTzGvKhhOz-hoR-F-BcWVsZW1lbnRJZGVudGlmaWVya2ZhbWlseV9uYW1lbGVsZW1lbnRWYWx1ZWVQZXJlemppc3N1ZXJBdXRohEOhASahGCGCWQIDMIIB_zCCAaSgAwIBAgIQAzQ0HwKxrAD9wNkeNJ6mkTAKBggqhkjOPQQDAjBWMQswCQYDVQQGEwJETzEOMAwGA1UECBMFRE8tMDExGTAXBgNVBAoTEFBPQy1ETy1OT1QtVFJVU1QxHDAaBgNVBAMTE1ZFUklGSUFCTFkgUE9DIElBQ0EwHhcNMjYwODIzMTgwNTUxWhcNMjcxMTIzMTkwNTUxWjBVMQswCQYDVQQGEwJETzEOMAwGA1UECBMFRE8tMDExGTAXBgNVBAoTEFBPQy1ETy1OT1QtVFJVU1QxGzAZBgNVBAMTElZFUklGSUFCTFkgUE9DIERTQzBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABAhnCsNo4DkOO5GOdZaj2wbROmqhf86NvydIyoMo2q2V8kmKbFwtmKVXNXznhKnqYhYwBISi949Q8VOMzW-9TkGjVTBTMA4GA1UdDwEB_wQEAwIHgDASBgNVHSUECzAJBgcogYxdBQECMAwGA1UdEwEB_wQCMAAwHwYDVR0jBBgwFoAU5mmUMKBSvwr4wu0Vj7_4232Cr_IwCgYIKoZIzj0EAwIDSQAwRgIhAJqQbaBiPSYzJY5sFDtoUGMhb2MRsmknPEWgdr_sHvqvAiEAqNX7qqFu9qEy9rjSDdIGx1j6yms0xyQI9YzCCRbxB01ZAfMwggHvMIIBlqADAgECAhEA2b5lN3IfSlaY4Xpq-bgwKzAKBggqhkjOPQQDAjBWMQswCQYDVQQGEwJETzEOMAwGA1UECBMFRE8tMDExGTAXBgNVBAoTEFBPQy1ETy1OT1QtVFJVU1QxHDAaBgNVBAMTE1ZFUklGSUFCTFkgUE9DIElBQ0EwHhcNMjYwODIzMTgwNTUxWhcNMjkwODIyMTkwNTUxWjBWMQswCQYDVQQGEwJETzEOMAwGA1UECBMFRE8tMDExGTAXBgNVBAoTEFBPQy1ETy1OT1QtVFJVU1QxHDAaBgNVBAMTE1ZFUklGSUFCTFkgUE9DIElBQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARi6yn7ygmP9WQHhRHn08As5CpiLQYJKydurBKNtLR-9cpqZnadPoEv_07SH2XxNnG4y_WSIY4FmFs8gA-qjs3jo0UwQzAOBgNVHQ8BAf8EBAMCAQYwEgYDVR0TAQH_BAgwBgEB_wIBADAdBgNVHQ4EFgQU5mmUMKBSvwr4wu0Vj7_4232Cr_IwCgYIKoZIzj0EAwIDRwAwRAIgJl3nw6WLLn_3BZctmXM6I-H5gF_by745-CGKLtsup_ECIAxOVHxsJjg6k_t1WzsuLLmLMPw6Jp8OepldQU0uhfKhWQNG2BhZA0GmZ3ZlcnNpb25jMS4wb2RpZ2VzdEFsZ29yaXRobWdTSEEtMjU2bHZhbHVlRGlnZXN0c6Fxb3JnLmlzby4xODAxMy41LjGvAFgguHjH8WIHpwCivz3PYe8Xpobm-kUDBTnDsHPpaYFRqYYBWCCT4mVL0e71AX69cPsgDultDENGQs_FuJXSLWPF6-erHgJYIDhKSU3ji5H5XJuUJfzoSxQDV0iWoIfTpkchUGXBFjSJA1gg9g9pFVCaKjAEOyDjGOfEUuFhXJ88_-8sw90J-ATPaJwEWCAra7tfPvxLzFshyriCVzIlUwFuz_LDXM9KM_90KnnNegVYIA5iLAUjqrensE6oh-mZcXGXXPmL6cIjW_1iV5k0G5CkBlggdBEhXZQYQGME9JhipF70RWQZHMn0qIKjI2dgYnkp5KwHWCASPL99Rvb5VeiKihjtXkR7_r9Y9o7e4EXSSbRNpwszKQhYIJ-6KDSt1s4ipIPHTb9c2ujhswzeMSLVFRJCXMWoURjfCVggDD042TeRoshRCD9dMzZrN-pxrCJm4_03oUmcUJucgSoKWCAyZSAFahjYdMoUEQHBTgVRaOmgcwP4-fm8hHajIeem8QtYIC8lFJXYYZWku02aXvJHSEjlAEGbVDQe59x0jXikYFv5DFgg-VhVhEA7Qs6N4TyACdKuK5cyPxS3y5L4sW6IvQtldx4NWCA4eT81by3wLCZREl2B_hBu9MBlPM69jjxPC4YI5yaiOg5YIBI8FoBKfqHCR4LWtjRN4Uh0klwASa6bSVhfQOM9xRwubWRldmljZUtleUluZm-haWRldmljZUtleaQBAiABIVggTNZX0ncyhKFHgsDcF0J-aljvBheNDIEmZxp0752BKp4iWCAKqwm7gnhqO4Z0e_YIVcPt6izLn9Wg4_ehnpujEAcJAmdkb2NUeXBldW9yZy5pc28uMTgwMTMuNS4xLm1ETGx2YWxpZGl0eUluZm-jZnNpZ25lZMB0MjAyNi0wOC0yNFQxMzowMjo0OFppdmFsaWRGcm9twHQyMDI2LTA4LTI0VDEzOjAyOjQ4Wmp2YWxpZFVudGlswHQyMDI3LTA4LTI0VDEzOjAyOjQ4WlhA9bR0_ekp4-cx4NjRLzsMP7LN7SM7EOA2opDSNGKhqjgC8Hz8RFoZVLFQHiWy7sfXCxlTXGU2-IYxmV_qmzi85A';

/**
 * Builds the exact object shape Credo's real Mdoc exposes for these three
 * properties (verified against node_modules/@credo-ts/core/build/modules/
 * mdoc/Mdoc.mjs's real getters, and confirmed with a live, non-Jest Node run
 * against this exact credential — see the file-level comment above):
 * docType is a plain string, validityInfo is the raw decoded payload
 * object, and issuerSignedNamespaces is Object.fromEntries(outer) with each
 * namespace's VALUE also Object.fromEntries'd — but nested Maps inside a
 * claim VALUE (driving_privileges' entries) are left untouched, because
 * Credo's flattening does not recurse into claim values.
 */
function buildCredoShapedMdoc(cborB64Url: string, expectedDocType: string) {
  const bytes = Buffer.from(cborB64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const issuerSignedDocument = parseIssuerSigned(bytes, expectedDocType);
  const outer = issuerSignedDocument.allIssuerSignedNamespaces as Map<string, Map<string, unknown>>;
  const issuerSignedNamespaces: Record<string, Record<string, unknown>> = {};
  for (const [ns, inner] of outer.entries()) {
    issuerSignedNamespaces[ns] = Object.fromEntries(inner.entries());
  }
  return {
    docType: issuerSignedDocument.docType,
    issuerSignedNamespaces,
    validityInfo: issuerSignedDocument.issuerSigned.issuerAuth.decodedPayload.validityInfo,
  };
}

/** Minimal MdocRecord-shaped stub — see the file-level comment above for why. */
function makeRecord(mdoc: ReturnType<typeof buildCredoShapedMdoc>) {
  return {
    id: 'test-record-id',
    firstCredential: mdoc,
    getTags: () => ({}),
  } as unknown as import('@credo-ts/core').MdocRecord;
}

describe('fromMdocRecord expiryDate — real-vs-MSO-validity regression', () => {
  test('uses the expiry_date DATA ELEMENT, not the MSO validityInfo.validUntil', () => {
    const mdoc = buildCredoShapedMdoc(REAL_ISSUED_MDL_CBOR_B64URL, 'org.iso.18013.5.1.mDL');
    const entry = fromMdocRecord(makeRecord(mdoc));

    // The bug: expiryDate used to come from validityInfo.validUntil, which
    // for THIS credential is 2027-08-24 (walt.id's fixed 1-year MSO
    // default) — a date that has nothing to do with the licence's real
    // expiry. The correct source is the expiry_date claim: 2031-08-24.
    expect(entry.expiryDate).toBeDefined();
    expect(entry.expiryDate!.slice(0, 10)).toBe('2031-08-24');
    expect(entry.expiryDate!.slice(0, 10)).not.toBe('2027-08-24');
  });

  test('claims.expiry_date is present and independently reads the same date', () => {
    const mdoc = buildCredoShapedMdoc(REAL_ISSUED_MDL_CBOR_B64URL, 'org.iso.18013.5.1.mDL');
    const entry = fromMdocRecord(makeRecord(mdoc));
    expect(formatClaimValue(entry.claims.expiry_date)).toBe('August 24, 2031');
  });
});

describe('DateOnly rendering — real CBOR tag 1004 values, not simulated', () => {
  test('formatClaimValue renders a real DateOnly as a plain formatted date, not "Date: ..."', () => {
    const mdoc = buildCredoShapedMdoc(REAL_ISSUED_MDL_CBOR_B64URL, 'org.iso.18013.5.1.mDL');
    const entry = fromMdocRecord(makeRecord(mdoc));
    const text = formatClaimValue(entry.claims.birth_date);
    expect(text).not.toContain('Date:');
    expect(text).toBe('May 15, 1990');
  });

  test('claimShape renders a real DateOnly as scalar, not a one-row list', () => {
    const mdoc = buildCredoShapedMdoc(REAL_ISSUED_MDL_CBOR_B64URL, 'org.iso.18013.5.1.mDL');
    const entry = fromMdocRecord(makeRecord(mdoc));
    const shape = claimShape(entry.claims.issue_date);
    expect(shape.kind).toBe('scalar');
  });

  test('driving_privileges dates (real @animo-id/mdoc Maps, untouched by Credo flattening) render as clean dates in the table', () => {
    const mdoc = buildCredoShapedMdoc(REAL_ISSUED_MDL_CBOR_B64URL, 'org.iso.18013.5.1.mDL');
    const entry = fromMdocRecord(makeRecord(mdoc));
    // Confirmed live (see file header) that Credo does NOT flatten this —
    // it is still an array of real Maps at this point.
    expect(Array.isArray(entry.claims.driving_privileges)).toBe(true);
    expect((entry.claims.driving_privileges as unknown[])[0] instanceof Map).toBe(true);

    const shape = claimShape(entry.claims.driving_privileges);
    expect(shape.kind).toBe('table');
    if (shape.kind !== 'table') return;
    for (const row of shape.rows) {
      for (const cell of row) {
        expect(cell).not.toContain('Date:');
        expect(cell).not.toBe('{}');
      }
    }
    // The two entries this real credential carries (the profile requires
    // exactly 2, so a single-category submission gets padded/duplicated —
    // see internal/mdoc/drivingprivileges.go on the issuer side) both show
    // real issue/expiry dates, not "—" placeholders.
    expect(shape.rows).toHaveLength(2);
  });
});
