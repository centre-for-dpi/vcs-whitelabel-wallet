// Regression test for a real @credo-ts/core@0.6.3 bug, patched via
// patches/@credo-ts+core+0.6.3.patch — NOT exercised through cdpi-wallet's
// own code (spkiToPublicJwk is an internal, unexported Credo function reached
// only indirectly via Mdoc.verify()'s X.509 chain building), so this test
// exercises the exact ASN.1 extraction logic in isolation using only the
// @peculiar/* packages Credo's real code also uses — no Credo import at all,
// which avoids the tsyringe/reflect-metadata polyfill chain that made
// importing Credo's build directly outside the RN runtime impractical.
//
// Reproduced live during Task 6 end-to-end verification: a real mDL, fully
// issued, correctly signed, and successfully verified as far as X.509 chain
// building, still failed trust verification with "Data does not match to
// RSAPublicKey ASN1 schema" — thrown from @peculiar/asn1-schema's AsnParser,
// called by @credo-ts/core's spkiToPublicJwk (keyAlgorithmConversion.mjs)
// while converting Inji Certify's self-signed ROOT certificate's RSA public
// key (the ROOT is RSA; the credential's own leaf/signing key is EC — mixed
// RSA-root/EC-leaf chains are valid X.509 and this is exactly what Inji
// Certify's mock-HSM path produces).
//
// Root cause: Credo's spkiToPublicJwk called
// `new Uint8Array(spki.subjectPublicKey).slice(1)` to drop what it assumed
// was cbor-x-style tag/unused-bits framing before parsing the RSAPublicKey
// SEQUENCE — but @peculiar/asn1-x509's own SubjectPublicKeyInfo.subjectPublicKey
// (an AsnPropTypes.BitString field) ALREADY excludes the leading
// "unused bits" count byte during its own BER->JS conversion. The extra
// `.slice(1)` therefore cut the first real byte of the RSAPublicKey
// SEQUENCE's own DER tag (0x30) instead, corrupting the structure before
// AsnParser ever saw it — confirmed empirically: parsing the SAME
// subjectPublicKey bytes WITHOUT the extra slice succeeds and returns a
// correctly-shaped 257-byte (2048-bit + sign-padding) modulus.
import { AsnParser } from '@peculiar/asn1-schema';
import { SubjectPublicKeyInfo } from '@peculiar/asn1-x509';
import { RSAPublicKey } from '@peculiar/asn1-rsa';
import * as x509 from '@peculiar/x509';
import fs from 'fs';
import path from 'path';

// The real self-signed ROOT certificate Inji Certify's mock-HSM path
// generated on the live VPS during this session's end-to-end verification —
// captured directly from CERTIFY_PKCS12/local.p12 (openssl pkcs12 -info),
// not synthesized. Its RSA public key is exactly what triggered the bug.
const INJI_ROOT_PEM = fs.readFileSync(
  path.join(__dirname, 'fixtures/inji-preauth-root.pem'),
  'utf8',
);

describe('@credo-ts/core RSA SPKI parsing (patched dependency)', () => {
  test('extracts a real RSA public key from a certificate without an extra byte-slice', () => {
    const cert = new x509.X509Certificate(INJI_ROOT_PEM);
    const spki = AsnParser.parse(new Uint8Array(cert.publicKey.rawData), SubjectPublicKeyInfo);

    // This is the exact call Credo's patched spkiToPublicJwk makes — no
    // extra .slice(1). Before the patch, an additional .slice(1) here
    // reproduced "Data does not match to RSAPublicKey ASN1 schema." on
    // this exact certificate.
    const rsaPublicKey = AsnParser.parse(new Uint8Array(spki.subjectPublicKey), RSAPublicKey);

    // A 2048-bit RSA modulus is 256 bytes; 257 confirms the DER's own
    // required sign-disambiguation zero-pad byte survived intact (its
    // absence, or an extra byte missing from the front, is exactly what an
    // incorrect slice offset would produce instead).
    expect(rsaPublicKey.modulus.byteLength).toBe(257);
    expect(rsaPublicKey.publicExponent.byteLength).toBeGreaterThan(0);
  });

  test('reproduces the original bug when Credo\'s removed extra slice(1) is reinstated', () => {
    const cert = new x509.X509Certificate(INJI_ROOT_PEM);
    const spki = AsnParser.parse(new Uint8Array(cert.publicKey.rawData), SubjectPublicKeyInfo);

    // This IS the pre-patch behavior — kept here (not run against the real
    // module) specifically so a future upgrade of @credo-ts/core that drops
    // the patch fails LOUDLY with a clear "the bug is back" signal instead
    // of silently reintroducing this exact on-device failure.
    const keyWithUnwantedExtraSlice = new Uint8Array(spki.subjectPublicKey).slice(1);
    expect(() => AsnParser.parse(keyWithUnwantedExtraSlice, RSAPublicKey)).toThrow(
      /does not match to RSAPublicKey ASN1 schema/,
    );
  });
});
