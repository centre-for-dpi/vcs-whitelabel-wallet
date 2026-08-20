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
// around it: a self-signed IACA root (C=DO, CA:TRUE) and a Document Signer
// cert it issues (EKU 1.0.18013.5.1.2, the mDL DS OID X509Certificate.ts
// already recognizes as X509ExtendedKeyUsage.MdlDs), both P-256, both
// carrying C in their DN. issuer2-profiles.conf's defaultIssuerKey/
// defaultIssuerX5chain on cdpi-vps were swapped to the DS key/cert so mdocs
// are now signed by this chain; the wallet trusts the IACA root here, one
// level up, matching how a real chain (DS presented, root trusted
// out-of-band) is verified. Root subject:
// CN=CDPI mDL Test IACA,OU=mDL Test,O=CDPI,C=DO.
const MDOC_TRUSTED_CERTIFICATES = [
  `-----BEGIN CERTIFICATE-----
MIIB/zCCAaagAwIBAgIUKTOoXxp25Z983OGn634fdplzVjYwCgYIKoZIzj0EAwIw
TDELMAkGA1UEBhMCRE8xDTALBgNVBAoMBENEUEkxETAPBgNVBAsMCG1ETCBUZXN0
MRswGQYDVQQDDBJDRFBJIG1ETCBUZXN0IElBQ0EwHhcNMjYwODIwMDI0ODUzWhcN
NDEwODE2MDI0ODUzWjBMMQswCQYDVQQGEwJETzENMAsGA1UECgwEQ0RQSTERMA8G
A1UECwwIbURMIFRlc3QxGzAZBgNVBAMMEkNEUEkgbURMIFRlc3QgSUFDQTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABCTcslEgOrzjLtPBoWBJbaDZiyOo9ftMpzjE
+QM8zM4eykUzqldkX2hwHucuI0YS79OcTleKOU+kr6VqyGE6TeWjZjBkMB8GA1Ud
IwQYMBaAFP8GEePHxctw433/sGUcgJEabn+7MBIGA1UdEwEB/wQIMAYBAf8CAQAw
DgYDVR0PAQH/BAQDAgEGMB0GA1UdDgQWBBT/BhHjx8XLcON9/7BlHICRGm5/uzAK
BggqhkjOPQQDAgNHADBEAiA06c/iRQg8MrWeOjP5+FV9eVtPRrKphOB/zMOy8UkL
HQIgZrMypmgVbQx1O5g0m25JuYgmBI+yIKTX4QEhnccXXnY=
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
