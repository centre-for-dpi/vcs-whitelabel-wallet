// Regression test for a real Inji Certify v0.14.0 non-conformance,
// reproduced live during Task 6 end-to-end verification: after a real mDL
// was successfully issued, downloaded, and verified (trust chain, country/
// jurisdiction matching all confirmed working in earlier fixes this same
// session), opening the credential's detail sheet in the wallet caused
// severe UI lag and sometimes a full app crash. The credential list also
// showed an unrelated, CORRECT "expired" badge (the test data's own
// expiry_date, 2026-03-03, had genuinely already passed — not a bug).
//
// Root cause: Inji Certify encodes the `portrait` data element (an ISO
// 18013-5 `bstr`) as a base64-encoded STRING claim value, not a real CBOR
// byte string — confirmed live: a captured credential's `claims.portrait`
// was `typeof 'string'`, 314488 characters long, starting with
// `/9j/4AAQSkZJRgAB...` (a genuine JPEG's base64 text — `/9j/` decodes to
// FF D8 FF, the JPEG SOI marker). This is a non-conformance in Inji
// Certify's own MSO construction (portrait must be a bstr, not a base64
// tstr), the same general category of issue as the missing
// validityInfo.signed field fixed earlier in this investigation — but this
// one is fixable wallet-side, since the wallet controls how it interprets
// its own claim values before display, unlike the third-party-library bugs
// patched via patch-package elsewhere in this session.
//
// asBytes()/imageMimeType()/claimImageUri() previously only recognised
// Uint8Array/ArrayBufferView — a string claim value never reached the
// image-detection path at all, and formatClaimValue's plain-string branch
// (checked BEFORE the byte-string branch, pre-fix) returned the entire
// 300KB+ base64 text verbatim, which the UI then rendered as one giant
// <Text> node — reproduced live as the lag/crash.
import { asBytes, imageMimeType, isImageClaim, claimImageUri, formatClaimValue } from '../utils/credential';

// A real, minimal-but-valid JPEG (SOI + JFIF APP0 + padding + EOI),
// base64-encoded — long enough (296 chars) to exercise the same code path
// a real ~314KB portrait does, without committing an actual photo to the
// repo. Mirrors the real captured credential's prefix exactly
// (`/9j/4AAQSkZJRgAB...`).
const JPEG_BASE64_STRING =
  '/9j/4AAQSkZJRgABAQAAAQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/Z';

describe('base64-STRING-encoded bstr claims (Inji Certify non-conformance)', () => {
  test('a genuine captured-credential-length base64 portrait is recognized as bytes', () => {
    const bytes = asBytes(JPEG_BASE64_STRING);
    expect(bytes).not.toBeNull();
    expect(bytes?.[0]).toBe(0xff);
    expect(bytes?.[1]).toBe(0xd8);
    expect(bytes?.[2]).toBe(0xff);
  });

  test('imageMimeType/isImageClaim recognize it as a JPEG despite being a string', () => {
    expect(imageMimeType(JPEG_BASE64_STRING)).toBe('image/jpeg');
    expect(isImageClaim(JPEG_BASE64_STRING)).toBe(true);
  });

  test('claimImageUri builds a data: URI, reusing the base64 text directly rather than decode+re-encode', () => {
    const uri = claimImageUri(JPEG_BASE64_STRING);
    expect(uri).toBe(`data:image/jpeg;base64,${JPEG_BASE64_STRING}`);
  });

  test('formatClaimValue renders it as a mime/size summary, NOT the raw base64 text', () => {
    const text = formatClaimValue(JPEG_BASE64_STRING);
    expect(text).toMatch(/^image\/jpeg · \d+ KB$/);
    // The actual bug: before the fix, this would equal JPEG_BASE64_STRING
    // itself (a UI-freezing wall of text for a real ~314KB portrait).
    expect(text).not.toBe(JPEG_BASE64_STRING);
    expect(text.length).toBeLessThan(50);
  });

  test('an ordinary short string claim (e.g. a document number) is unaffected', () => {
    expect(asBytes('123456789')).toBeNull();
    expect(formatClaimValue('123456789')).toBe('123456789');
    expect(formatClaimValue('Juan')).toBe('Juan');
  });

  test('a base64url-alphabet string (with -/_ instead of +//) is also recognized', () => {
    const base64url = JPEG_BASE64_STRING.replace(/\+/g, '-').replace(/\//g, '_');
    expect(imageMimeType(base64url)).toBe('image/jpeg');
  });

  test('a short string that happens to contain only base64-alphabet characters is NOT misdetected as bytes', () => {
    // Guards the 100-character floor in BASE64_LIKE_RE: without it, common
    // short alphanumeric claim values (names, document numbers) could
    // false-positive as "bytes" and lose their plain-text rendering.
    const shortAlnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'; // 37 chars, all base64-alphabet-safe
    expect(asBytes(shortAlnum)).toBeNull();
    expect(formatClaimValue(shortAlnum)).toBe(shortAlnum);
  });
});
