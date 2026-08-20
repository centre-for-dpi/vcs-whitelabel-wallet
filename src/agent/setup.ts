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
// change. Root subject: CN=CDPI mDL Test IACA AT,OU=mDL Test,O=CDPI,C=AT.
const MDOC_TRUSTED_CERTIFICATES = [
  `-----BEGIN CERTIFICATE-----
MIICBTCCAaugAwIBAgITF9LDzhLeukwO/L+bDMfS5M20kzAKBggqhkjOPQQDAjBP
MQswCQYDVQQGEwJBVDENMAsGA1UECgwEQ0RQSTERMA8GA1UECwwIbURMIFRlc3Qx
HjAcBgNVBAMMFUNEUEkgbURMIFRlc3QgSUFDQSBBVDAeFw0yNjA4MjAwMzExNTVa
Fw00MTA4MTYwMzExNTVaME8xCzAJBgNVBAYTAkFUMQ0wCwYDVQQKDARDRFBJMREw
DwYDVQQLDAhtREwgVGVzdDEeMBwGA1UEAwwVQ0RQSSBtREwgVGVzdCBJQUNBIEFU
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9dL/wqtxBt1Iuu1Hah4F/lWj3/4g
fEXLU5453VXF1F91t9+mZbDFo2vIo1+GnehtAAOoj1wMAdEyxg1pwtkx1aNmMGQw
HwYDVR0jBBgwFoAUr4egBHwowZqB8qLaeG/EdUCpBocwEgYDVR0TAQH/BAgwBgEB
/wIBADAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFK+HoAR8KMGagfKi2nhvxHVA
qQaHMAoGCCqGSM49BAMCA0gAMEUCIDkU3Ekv6fH8ha5BsFH7Ud9NzaSjaFOtHF/l
i1M9lcruAiEAreksYOd8LJ4+65V/wSVGV0NffrGOUrqEWxzvW0I9hWk=
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
