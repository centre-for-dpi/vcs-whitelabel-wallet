import {
  Agent,
  ConsoleLogger,
  DidsModule,
  InitConfig,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  SdJwtVcModule,
  W3cCredentialsModule,
  WebDidResolver,
  X509Module,
} from '@credo-ts/core';
import { agentDependencies } from '@credo-ts/react-native';
import { AskarModule } from '@credo-ts/askar';
import { OpenId4VcModule } from '@credo-ts/openid4vc';
import { askar } from '@openwallet-foundation/askar-react-native';

export type WalletAgent = Agent;

// mdoc issuer trust anchors — Credo's Mdoc.verify() (invoked automatically by
// holder.requestCredentials() for mso_mdoc offers) throws "No trusted
// certificates found. Cannot verify mdoc." if X509Module has no
// trustedCertificates configured at all, regardless of whether the actual
// chain would validate. This never surfaced against the legacy walt.id
// issuer-api because its mdoc offers are routed through the manual-mdoc path
// in requestCredentials.ts (isLegacyEndpoint), which bypasses Credo's
// requestCredentials()/verify() entirely. issuer-api2's well-known URL
// doesn't match any of the legacy patterns, so its mdoc offers take the
// standard 'credo' path instead — the first path that actually exercises
// mdoc signature verification.
//
// This is a static allowlist scoped to today's single test issuer
// (issuer-api2 on cdpi-vps, profile isoMdl). It is NOT a general trust
// registry — see src/agent/trust.ts's trustRegistry for the (cosmetic-only,
// unrelated) issuer-name badge. A dynamic per-issuer resolver
// (X509ModuleConfig.getTrustedCertificatesForVerification) is the intended
// longer-term replacement once there's more than one mdoc issuer to trust.
//
// walt.id's own issuer2 sample "defaultIssuerX5chain" cert turned out to be
// unusable: its Issuer DN is only "CN=MDOC ROOT CA", no countryName. Credo's
// mdoc verifier requires C on the certificate's *Issuer* field specifically
// (Mdoc.getIssuingCountry -> X509Certificate.getIssuerNameField reads
// x509Certificate.issuerName, i.e. the X.509 Issuer, not the Subject — the
// method name is misleading), so every credential signed by that cert fails
// with "Country name (C) must be present in the issuer certificate's subject
// distinguished name" (the check's own message is also misleading — it's
// really checking the Issuer field of the chain). Reported nowhere upstream;
// confirmed by decoding a live-issued credential's COSE_Sign1 x5chain and
// inspecting the cert directly.
//
// Replaced with a purpose-built ISO 18013-5 test PKI instead of patching
// around it: a self-signed IACA root (CA:TRUE) and a Document Signer cert
// it issues (EKU 1.0.18013.5.1.2, the mDL DS OID X509Certificate.ts already
// recognizes as X509ExtendedKeyUsage.MdlDs), both P-256, both carrying C in
// their DN. issuer2-profiles.conf's defaultIssuerKey/defaultIssuerX5chain on
// cdpi-vps were swapped to the DS key/cert so mdocs are now signed by this
// chain; the wallet trusts the IACA root here, one level up, matching how a
// real chain (DS presented, root trusted out-of-band) is verified.
//
// Country is AT, not CDPI's own DO, because it must equal issuer2-profiles.
// conf's isoMdl sample data's issuing_country/nationality (Austria) —
// @animo-id/mdoc's verifier separately checks that the mdoc's
// issuing_country *data element* equals the countryName in the signing
// cert's *Subject* DN (distinct from the Issuer-DN check above; error was
// "The 'issuing_country' (AT) must match the 'countryName' (DO) in the
// subject field within the issuer certificate" against a first C=DO
// attempt). Changing the sample profile's country data instead of the cert
// remains an option later; matching the cert to the data was the smaller
// change.
//
// ST=AT-9 for the same reason, one field over: a THIRD check
// (verifyData -> matchCertificate) requires the mdoc's issuing_jurisdiction
// element to equal stateOrProvinceName (ST) in the same Subject DN — the
// sample data's issuing_jurisdiction is "AT-9" everywhere in the profile.
// issuing_country/issuing_jurisdiction are the only two data elements
// @animo-id/mdoc cross-checks against the certificate (grepped the full
// verifier for every "must match"/matchCertificate call site to confirm no
// third field is checked before adding this comment) — C and ST are the
// complete list, nothing else in the Subject DN is read.
// Root subject: CN=INTRANT POC IACA,O=POC-DO-NOT-TRUST,ST=DO-01,C=DO.
//
// Swapped from the earlier AT test root to a DO one so the certificate's
// country matches the credential's own data. The two cross-checks above are
// what force this to move as a SET: an mdoc issued with issuing_country=DO
// and issuing_jurisdiction=DO-01 only verifies against a signing cert whose
// Subject carries C=DO and ST=DO-01. Issuing Dominican credentials under an
// Austrian test cert worked only because the sample data was Austrian too.
//
// The matching DSC + issuer key live on cdpi-vps in issuer2-profiles.conf
// (defaultIssuerX5chain / defaultIssuerKey). Both are POC material, marked
// O=POC-DO-NOT-TRUST: self-signed, not from any recognised authority. Real
// certificate provisioning is owned by the issuer-key-rotation design.
const MDOC_TRUSTED_CERTIFICATES = [
  `-----BEGIN CERTIFICATE-----
MIIB6DCCAY2gAwIBAgIRAI7mbdaG/Rl1sGHKW2Qh40YwCgYIKoZIzj0EAwIwUzEL
MAkGA1UEBhMCRE8xDjAMBgNVBAgTBURPLTAxMRkwFwYDVQQKExBQT0MtRE8tTk9U
LVRSVVNUMRkwFwYDVQQDExBJTlRSQU5UIFBPQyBJQUNBMB4XDTI2MDgyMjE1NDYw
N1oXDTMxMDgyMjE2NDYwN1owUzELMAkGA1UEBhMCRE8xDjAMBgNVBAgTBURPLTAx
MRkwFwYDVQQKExBQT0MtRE8tTk9ULVRSVVNUMRkwFwYDVQQDExBJTlRSQU5UIFBP
QyBJQUNBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEmydYUCm8cBXkFK/D42eN
WC7Um63klPYVGgl9hMuCmgog/TJSjt3wECjBFTo2cZKh3Z09F5ZmzfRu+iSwKMlM
/KNCMEAwDgYDVR0PAQH/BAQDAgEGMA8GA1UdEwEB/wQFMAMBAf8wHQYDVR0OBBYE
FE2Zu45cQUD6gV8HJR/RmQg6vB8CMAoGCCqGSM49BAMCA0kAMEYCIQDwlxmSpnk5
+7TMznBZ/vd38mjq9Te+VTy5XpwzJ9f47gIhAK56crbjVw5ZXEyRpGKc2CtLBUaP
Ly5+B8iOHYFat1ZH
-----END CERTIFICATE-----`,
];

export const setupAgent = async (walletKey: string): Promise<WalletAgent> => {
  const config: InitConfig = {
    logger: new ConsoleLogger(LogLevel.warn),
  };

  const agent = new Agent({
    config,
    modules: {
      askar: new AskarModule({
        askar,
        store: {
          id: 'cdpi-wallet-v1',
          key: walletKey,
        },
      }),
      openid4vc: new OpenId4VcModule({}),
      sdJwtVc: new SdJwtVcModule({
        customTypeMetadataResolver: async (_vct, _integrity, { defaultResolver }) => {
          try {
            const doc = await defaultResolver({ throwErrorOnFetchError: false, throwErrorOnUnsupportedVctValue: false });
            // If the document is missing or lacks a valid `vct` string, skip validation by returning undefined
            if (!doc || typeof doc.vct !== 'string') return undefined;
            return doc;
          } catch {
            return undefined;
          }
        },
      }),
      dids: new DidsModule({
        registrars: [new KeyDidRegistrar()],
        resolvers: [new KeyDidResolver(), new WebDidResolver()],
      }),
      w3cCredentials: new W3cCredentialsModule(),
      x509: new X509Module({
        trustedCertificates: MDOC_TRUSTED_CERTIFICATES,
      }),
    },
    dependencies: agentDependencies,
  });

  await agent.initialize();
  return agent;
};
