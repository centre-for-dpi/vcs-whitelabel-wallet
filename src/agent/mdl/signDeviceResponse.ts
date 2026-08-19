import * as ExpoCrypto from 'expo-crypto';
import { Hasher, Kms, Mdoc } from '@credo-ts/core';
import { DeviceRequest, DeviceResponse, MDoc } from '@animo-id/mdoc';
import type { WalletAgent } from '../setup';
import type { MdocContext } from '@animo-id/mdoc';

/* eslint-disable no-console */
const log = __DEV__ ? console.log.bind(console) : () => {};

// @animo-id/mdoc's DeviceResponse.authenticateWithSignature only accepts this
// stricter subset (device authentication is always a plain signature over
// DeviceAuthenticationBytes, never HMAC/RSA/etc.) — narrower than Credo's own
// Kms.KnownJwaSignatureAlgorithm, which also covers algorithms mdoc device
// auth never uses.
export type MdocDeviceAuthAlgorithm = 'ES256' | 'ES384' | 'ES512' | 'EdDSA';

/**
 * Minimal MdocContext for DeviceResponse.sign — only the crypto.digest,
 * crypto.random and cose.sign1.sign operations authenticateWithSignature's
 * (non-MAC) signing path actually calls (confirmed by reading getDeviceAuthSign
 * in @animo-id/mdoc's source — it calls exactly ctx.cose.sign1.sign({sign1, jwk}),
 * nothing else). @credo-ts/core's own getMdocContext (used internally for
 * issuance/verification) is NOT part of its public API surface — the
 * package.json "exports" map only allows "." and "./kms", so a deep import
 * of modules/mdoc/MdocContext.mjs would fail under Metro's exports-map
 * enforcement even though it resolves in plain Node — so this rebuilds the
 * same operations from the KMS + Hasher + expo-crypto, all of which are
 * public. cose.mac0 and x509 are stubbed to throw: DeviceResponse.sign never
 * reaches them on the authenticateWithSignature path this wallet uses —
 * walt.id's mdoc issuer offers no shared reader key to MAC against, and MAC
 * auth is an alternative to signature auth per spec, never both.
 *
 * IMPORTANT — mirrors Credo's own getMdocContext pattern for cose.sign1.sign:
 * the `jwk` DeviceResponse.authenticateWithSignature is given (named
 * "devicePrivateKey" in its own signature) is passed through verbatim to
 * this callback. Credo's KMS (Askar) never exposes real private key
 * material — it only signs by keyId. So the "devicePrivateKey" passed in
 * here is actually the device's PUBLIC jwk (with its Credo keyId embedded),
 * never the private key itself; this callback resolves it to publicJwk.keyId
 * and asks the KMS to sign with that key, exactly like getMdocContext does.
 */
function buildPresentationMdocContext(kms: Kms.KeyManagementApi): Pick<MdocContext, 'crypto' | 'cose'> {
  return {
    crypto: {
      digest: async ({ bytes, digestAlgorithm }) => Hasher.hash(new Uint8Array(bytes), digestAlgorithm),
      random: (length: number) => ExpoCrypto.getRandomBytes(length),
      calculateEphemeralMacKeyJwk: async () => {
        throw new Error('calculateEphemeralMacKeyJwk is not used by the signature (non-MAC) device-auth path.');
      },
    },
    cose: {
      sign1: {
        sign: async ({ jwk, sign1 }) => {
          const { data } = sign1.getRawSigningData();
          const publicJwk = Kms.PublicJwk.fromUnknown(jwk);
          // publicJwk.signatureAlgorithm (Credo's own strongly-typed derivation from the
          // jwk's kty/crv) takes priority; sign1.algName is only a same-value fallback
          // typed as a bare `string` by @animo-id/mdoc, so it's cast here rather than
          // widening kms.sign's algorithm parameter to `string`.
          const algorithm = publicJwk.signatureAlgorithm ?? (sign1.algName as Kms.KnownJwaSignatureAlgorithm);
          const { signature } = await kms.sign({ data, algorithm, keyId: publicJwk.keyId });
          return signature;
        },
        verify: async () => {
          throw new Error('cose.sign1.verify is not used by the presentation (device-response-signing) path.');
        },
      },
      mac0: {
        sign: async () => {
          throw new Error('cose.mac0.sign (MAC device auth) is not supported — this wallet only signs, never MACs.');
        },
        verify: async () => {
          throw new Error('cose.mac0.verify is not used by the presentation (device-response-signing) path.');
        },
      },
    },
  };
}

/**
 * Builds and signs the DeviceResponse CBOR to send back to the reader, given
 * the stored mdoc, the reader's raw DeviceRequest CBOR, and the
 * sessionTranscriptBytes expo-mdoc-data-transfer's waitForDeviceRequest()
 * already computed. sessionTranscriptBytes is NOT rebuilt here — the native
 * module's underlying EUDI TransferManager derives it from the real BLE
 * device engagement + reader engagement exchange, which this JS layer never
 * observes directly; using anything else here would sign a transcript the
 * reader never agreed to, and the reader's own signature verification would
 * reject it.
 *
 * devicePublicJwk must be the JWK (with Credo keyId) matching the device key
 * embedded in the mdoc's MSO at issuance time — see generateDeviceKey.ts /
 * the deviceKeyId storeCredential.ts sets on the stored MdocRecord — not any
 * other key, or the reader's DeviceAuthentication signature check fails.
 *
 * Uses @animo-id/mdoc's own DeviceResponse builder — the same CBOR library
 * Credo uses internally for Mdoc — rather than hand-rolling CBOR, so the
 * output is spec-correct by construction instead of by careful imitation.
 */
export async function buildDeviceResponse(
  agent: WalletAgent,
  options: {
    storedMdoc: Mdoc;
    deviceRequestBytes: Uint8Array;
    sessionTranscriptBytes: Uint8Array;
    devicePublicJwk: Kms.KmsJwkPublic;
    deviceKeyAlgorithm: MdocDeviceAuthAlgorithm;
  },
): Promise<Uint8Array> {
  const kms = agent.dependencyManager.resolve(Kms.KeyManagementApi);
  const mdocContext = buildPresentationMdocContext(kms);
  const deviceRequest = DeviceRequest.parse(options.deviceRequestBytes);

  // Credo's Mdoc wraps a single @animo-id/mdoc IssuerSignedDocument internally
  // (issuerSignedDocument) — DeviceResponse.from expects @animo-id/mdoc's own
  // MDoc wrapper (a *list* of documents), so re-wrap it here rather than
  // re-parsing the base64url a second time.
  const issuerSignedDocument = (options.storedMdoc as unknown as {
    issuerSignedDocument: ConstructorParameters<typeof MDoc>[0] extends (infer D)[] | undefined ? D : never;
  }).issuerSignedDocument;
  const mdoc = new MDoc([issuerSignedDocument]);

  const signedResponse = await new DeviceResponse(mdoc)
    .usingDeviceRequest(deviceRequest)
    .usingSessionTranscriptBytes(options.sessionTranscriptBytes)
    .authenticateWithSignature(options.devicePublicJwk as unknown as Parameters<DeviceResponse['authenticateWithSignature']>[0], options.deviceKeyAlgorithm)
    .sign(mdocContext);

  log('[presentMdoc] DeviceResponse signed, encoding to CBOR');
  return signedResponse.encode();
}
