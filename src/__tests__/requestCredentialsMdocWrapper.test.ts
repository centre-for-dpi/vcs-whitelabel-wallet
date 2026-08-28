// @animo-id/mdoc is a transitive dependency of @credo-ts/core, already present
// in node_modules — no new CBOR dependency is added here (confirmed by reading
// node_modules/@animo-id/mdoc/dist/index.d.ts, which exports cborDecode/
// cborEncode as public named exports).
//
// requestCredentials.ts imports DidsApi/Kms/TypedArrayEncoder from
// @credo-ts/core at module scope (used by buildProofJwt, unrelated to
// detectAndUnwrapMdocEnvelope) — importing the module at all therefore pulls
// in @credo-ts/core's real ESM build, which Jest cannot parse unmocked (same
// reason storeCredentialMdoc.test.ts mocks it — see that file's header
// comment on hoisting). TypedArrayEncoder is mocked here with real
// Buffer-backed behavior (not a stub) because detectAndUnwrapMdocEnvelope
// uses its base64url methods directly; DidsApi/Kms are unused by the function
// under test and are stubbed only so the import doesn't throw. @credo-ts/openid4vc
// is mocked too since requestCredentials.ts imports its OpenId4VciResolvedCredentialOffer
// type only (type-only import, erased at compile time) but also references
// credentialBindingResolver from a sibling module — mocked transitively below.
jest.mock('@credo-ts/core', () => ({
  DidsApi: class {},
  Kms: { KeyManagementApi: class {} },
  TypedArrayEncoder: {
    toBase64URL: (buffer: Uint8Array) =>
      Buffer.from(buffer).toString('base64url'),
    fromBase64: (base64: string) => Buffer.from(base64, 'base64'),
    fromString: (str: string) => Buffer.from(str, 'utf8'),
  },
}));

jest.mock('../agent/credentialBinding', () => ({
  credentialBindingResolver: jest.fn(),
}));

// IMPORTANT: cborDecode returns a real JS Map for a CBOR map, NOT a plain
// object — confirmed empirically (node against both fixtures below) before
// writing these assertions. `'issuerSigned' in decoded` / `decoded.issuerSigned`
// (plain-object idioms) silently do nothing useful against a Map, so this
// test (and the implementation) uses Map.has()/get().
import { detectAndUnwrapMdocEnvelope } from '../agent/oid4vci/requestCredentials';
import { cborDecode } from '@animo-id/mdoc';
import wrappedFixture from './fixtures/inji-mdoc-wrapped.json';
import unwrappedFixture from './fixtures/waltid-mdoc-unwrapped.json';
import tag18Fixture from './fixtures/inji-mdoc-tag18-unwrapped.json';

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe('detectAndUnwrapMdocEnvelope', () => {
  test('extracts issuerSigned from an Inji-style {docType, issuerSigned} wrapper', () => {
    const wrappedBase64Url = (wrappedFixture as { credential: string }).credential;
    const result = detectAndUnwrapMdocEnvelope(wrappedBase64Url);
    expect(result.wasWrapped).toBe(true);
    const decoded = cborDecode(base64UrlToBytes(result.base64Url)) as Map<string, unknown>;
    expect(decoded).toBeInstanceOf(Map);
    expect(decoded.has('nameSpaces')).toBe(true);
    expect(decoded.has('issuerAuth')).toBe(true);
    expect(decoded.has('docType')).toBe(false);
    expect(decoded.has('issuerSigned')).toBe(false);
  });

  test('passes a walt.id-style unwrapped CBOR through unmodified', () => {
    const unwrappedBase64Url = (unwrappedFixture as { credential: string }).credential;
    const result = detectAndUnwrapMdocEnvelope(unwrappedBase64Url);
    expect(result.wasWrapped).toBe(false);
    expect(result.base64Url).toBe(unwrappedBase64Url); // identical, no re-serialization
  });

  // Reproduces a live bug found during Task 6 end-to-end verification, one
  // step past the {docType, issuerSigned} envelope bug above: a REAL mDL
  // issued by Inji Certify v0.14.0 (all server-side bugs already fixed,
  // credential successfully signed and returned) still failed on-device
  // with "TypeError: iterator method is not callable" inside
  // @animo-id/mdoc's parseIssuerAuthElement — `new IssuerAuth(...rawIssuerAuth)`
  // spreading a cbor-x Tag object (not iterable) because Inji encodes
  // issuerAuth as a properly CBOR-tag-18-wrapped COSE_Sign1 (RFC 8152 §4.2
  // permits this), while @animo-id/mdoc's parser assumes the bare-array
  // shape walt.id's issuer produces instead. This fixture is the exact
  // credential from that live failure (already unwrapped of the
  // {docType, issuerSigned} envelope — that bug was fixed first — but
  // still carrying the tag-18 issuerAuth underneath).
  test('unwraps a cbor-x auto-parsed Sign1 (CBOR tag-18 COSE_Sign1) issuerAuth', () => {
    const tag18Base64Url = (tag18Fixture as { credential: string }).credential;
    const before = cborDecode(base64UrlToBytes(tag18Base64Url)) as Map<string, unknown>;
    const rawIssuerAuthBefore = before.get('issuerAuth') as Record<string, unknown>;
    // Confirms the fixture actually reproduces the bug precondition: cbor-x's
    // registered tag-18 extension (Sign1.tag = 18) auto-parsed issuerAuth
    // into a class instance with named properties, NOT the bare 4-element
    // array @animo-id/mdoc's parseIssuerAuthElement spreads into
    // `new IssuerAuth(...)`. If a future version changes this auto-parse
    // behavior, cborDecode would return something else here and this test
    // would no longer be exercising anything real.
    expect(Array.isArray(rawIssuerAuthBefore)).toBe(false);
    expect('encodedProtectedHeaders' in rawIssuerAuthBefore).toBe(true);
    expect('unprotectedHeaders' in rawIssuerAuthBefore).toBe(true);
    expect('payload' in rawIssuerAuthBefore).toBe(true);
    expect('signature' in rawIssuerAuthBefore).toBe(true);

    const result = detectAndUnwrapMdocEnvelope(tag18Base64Url);
    expect(result.wasWrapped).toBe(false); // no {docType, issuerSigned} envelope here

    const after = cborDecode(base64UrlToBytes(result.base64Url)) as Map<string, unknown>;
    const rawIssuerAuthAfter = after.get('issuerAuth');
    // Unwrapped to the bare 4-element array @animo-id/mdoc's spread expects,
    // with every byte carried through untouched.
    expect(Array.isArray(rawIssuerAuthAfter)).toBe(true);
    const [protectedHeaders, unprotectedHeaders, payload, signature] = rawIssuerAuthAfter as unknown[];
    expect(Buffer.from(protectedHeaders as Uint8Array)).toEqual(
      Buffer.from(rawIssuerAuthBefore.encodedProtectedHeaders as Uint8Array),
    );
    expect(unprotectedHeaders).toBeInstanceOf(Map);
    expect(Array.from((unprotectedHeaders as Map<unknown, unknown>).entries())).toEqual(
      Array.from((rawIssuerAuthBefore.unprotectedHeaders as Map<unknown, unknown>).entries()),
    );
    expect(Buffer.from(payload as Uint8Array)).toEqual(Buffer.from(rawIssuerAuthBefore.payload as Uint8Array));
    expect(Buffer.from(signature as Uint8Array)).toEqual(Buffer.from(rawIssuerAuthBefore.signature as Uint8Array));
  });
});
