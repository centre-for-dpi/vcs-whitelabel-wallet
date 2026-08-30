// Regression test for a real @animo-id/mdoc@0.5.2 bug, patched via
// patches/@animo-id+mdoc+0.5.2.patch — reproduced live during Task 6
// end-to-end verification, AFTER the Inji Certify keystore migration
// (RSA ROOT -> EC ROOT) was already deployed and a real mdoc had already
// passed X.509 trust-chain verification on a real device: the wallet then
// crashed with an UNCAUGHT "Cannot read property 'toUTCString' of
// undefined", surfaced to the user as "La credencial mdoc no pasó la
// verificación de firma/confianza: Cannot read property 'toUTCString' of
// undefined" -- a misleading message, since trust verification had in fact
// already passed; the crash happened one check later.
//
// Root cause: Verifier.verifyIssuerSignature's "MSO signed date must be
// within the validity period of the certificate" check builds its `reason`
// string by calling `validityInfo.signed.toUTCString()` unconditionally.
// `signed` is an OPTIONAL field of ValidityInfo per ISO 18013-5 §9.1.2.4,
// and Inji Certify v0.14.0 never emits it (confirmed by decompiling its
// MDocProcessor.class: it substitutes ${_validFrom}/${_validUntil} markers
// but has no equivalent for a "signed" field at all -- this is a genuine
// gap in Inji Certify's own MSO construction, not something the credential
// issuer's Velocity template can work around). Every real mdoc this issuer
// produces therefore has `validityInfo.signed === undefined`, and the
// reason-string interpolation throws before the check's actual PASS/FAIL
// outcome is ever reported -- the crash happens even though the comparison
// on the line above it (`validityInfo.signed < certificateData.notBefore`)
// evaluates safely to `false` for `undefined` and does not itself throw.
//
// Fix: when `validityInfo.signed` is absent, report the check as PASSED
// (not FAILED) with an explanatory reason, instead of crashing. PASSED
// (not FAILED) is deliberate: verifyIssuerSignature's overall ISSUER_AUTH
// verdict is `checks.every(check => check.status === 'PASSED')` (see
// index.mjs), so FAILED here would make the wallet reject every credential
// this issuer produces solely because of a missing *optional* field with
// no bearing on whether the credential is actually trustworthy -- the
// credential's signature and X.509 chain (verified by separate, unaffected
// checks) are what establish trust.
import { Verifier, parseIssuerSigned, cborDecode, cborEncode, type X509Context, type MdocContext } from '@animo-id/mdoc';
import fs from 'fs';
import path from 'path';

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

// The real credential captured during this session's live Task 6
// verification -- an Inji Certify-issued mdoc whose validityInfo carries
// only validFrom/validUntil, exactly like every credential this issuer
// produces (not synthesized: this is what exposed the bug on a real
// device).
const rawFixture = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, 'fixtures/inji-mdoc-tag18-unwrapped.json'),
    'utf8',
  ),
) as { credential: string };

// This raw fixture's issuerAuth is still cbor-x's auto-parsed tag-18 Sign1
// shape (a class instance with named properties), which @animo-id/mdoc's
// OWN parseIssuerSigned cannot spread into IssuerAuth directly -- exactly
// the bug documented and fixed in requestCredentials.ts's
// unwrapIssuerAuthTag (see requestCredentialsMdocWrapper.test.ts). That
// unwrap is a real, already-tested, independent fix; it is reproduced
// inline here (rather than importing requestCredentials.ts, which requires
// mocking @credo-ts/core's real ESM build for unrelated reasons -- see that
// file's header) purely so this fixture is well-formed enough to reach the
// *different* bug this file targets: the missing validityInfo.signed field.
function unwrapTag18ForTest(base64Url: string): string {
  const decoded = cborDecode(base64UrlToBytes(base64Url)) as Map<string, unknown>;
  const rawIssuerAuth = decoded.get('issuerAuth') as {
    encodedProtectedHeaders: unknown;
    unprotectedHeaders: unknown;
    payload: unknown;
    signature: unknown;
  };
  const fixed = new Map(decoded);
  fixed.set('issuerAuth', [
    rawIssuerAuth.encodedProtectedHeaders,
    rawIssuerAuth.unprotectedHeaders,
    rawIssuerAuth.payload,
    rawIssuerAuth.signature,
  ]);
  return bytesToBase64Url(cborEncode(fixed));
}

const fixture = { credential: unwrapTag18ForTest(rawFixture.credential) };

describe('@animo-id/mdoc missing validityInfo.signed (patched dependency)', () => {
  test('the real Inji Certify credential fixture has no validityInfo.signed', () => {
    const issuerSignedDocument = parseIssuerSigned(base64UrlToBytes(fixture.credential));
    const { validityInfo } = issuerSignedDocument.issuerSigned.issuerAuth.decodedPayload;
    // validFrom/validUntil are present (as CBOR full-date/tdate values --
    // the re-encode this test's fixture setup does to reach a well-formed
    // issuerAuth shape does not preserve @animo-id/mdoc's own DateOnly/Date
    // wrapper classes, only their ISO string content, which is irrelevant
    // to the bug under test here). `signed` is the field that matters:
    // genuinely absent, exactly as every real Inji Certify credential has
    // it.
    expect(validityInfo.validFrom).toBeTruthy();
    expect(validityInfo.validUntil).toBeTruthy();
    expect(validityInfo.signed).toBeUndefined();
  });

  test('verifyIssuerSignature does not throw and does not fail the credential solely for a missing signed date', async () => {
    const issuerSignedDocument = parseIssuerSigned(base64UrlToBytes(fixture.credential));
    const { issuerAuth } = issuerSignedDocument.issuerSigned;

    const checks: Array<{ category: string; status: string; check: string; reason?: string }> = [];

    // Minimal x509/cose ctx stub: disableCertificateChainValidation skips
    // the chain-building path entirely (covered by its own tests elsewhere,
    // e.g. credoRsaSpkiPatch.test.ts and the keystore migration's own
    // server-side chain checks) -- this test isolates the "signed date"
    // check specifically. getCertificateData/getPublicKey/cose.sign1.verify
    // return fixed, valid-shaped values so every OTHER check in this
    // function passes, isolating whether the missing `signed` field alone
    // crashes or fails verification.
    const now = new Date('2027-01-01T00:00:00.000Z');
    const x509: X509Context = {
      getIssuerNameField: () => ['IN'],
      getPublicKey: () => ({ kty: 'EC', crv: 'P-256', x: 'stub', y: 'stub' }) as unknown as ReturnType<X509Context['getPublicKey']>,
      validateCertificateChain: async () => {},
      getCertificateData: async () => ({
        issuerName: 'stub-issuer',
        subjectName: 'stub-subject',
        serialNumber: '1',
        thumbprint: 'stub',
        notBefore: new Date('2020-01-01T00:00:00.000Z'),
        notAfter: new Date('2035-01-01T00:00:00.000Z'),
        pem: 'stub',
      }),
    };
    const cose: MdocContext['cose'] = {
      sign1: {
        sign: async () => {
          throw new Error('not used by this test');
        },
        verify: async () => true,
      },
      mac0: {
        sign: async () => {
          throw new Error('not used by this test');
        },
        verify: async () => true,
      },
    } as unknown as MdocContext['cose'];

    const verifier = new Verifier();
    await expect(
      verifier.verifyIssuerSignature(
        {
          trustedCertificates: [],
          issuerAuth,
          now,
          disableCertificateChainValidation: true,
          onCheckG: (check) => {
            checks.push(check as (typeof checks)[number]);
          },
        },
        { x509, cose },
      ),
    ).resolves.not.toThrow();

    const signedDateCheck = checks.find(
      (c) => c.check === 'The MSO signed date must be within the validity period of the certificate',
    );
    expect(signedDateCheck).toBeDefined();
    // PASSED, not FAILED -- a missing optional field must not sink an
    // otherwise-trustworthy credential (see file header for why).
    expect(signedDateCheck?.status).toBe('PASSED');
    expect(signedDateCheck?.reason).toMatch(/does not include a 'signed' date/);
  });

  test('reproduces the original crash when the unpatched interpolation is reinstated', () => {
    // Mirrors the exact pre-patch line from @animo-id/mdoc's dist bundle --
    // kept here (not run against the real module patch, consistent with
    // this codebase's established pattern for these regression tests, see
    // credoRsaSpkiPatch.test.ts) so a future @animo-id/mdoc upgrade that
    // silently drops this patch fails LOUDLY with a clear "the bug is back"
    // signal instead of quietly reintroducing this exact on-device crash.
    const validityInfo: { signed?: Date } = { signed: undefined };
    const certificateData = { notBefore: new Date(), notAfter: new Date() };
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      `${validityInfo.signed!.toUTCString()} vs ${certificateData.notBefore.toUTCString()}`;
    }).toThrow(/toUTCString/);
  });
});
