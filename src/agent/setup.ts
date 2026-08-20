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
// This is the walt.id issuer2 sample profile's "defaultIssuerX5chain" cert
// (waltid/issuer-api2 config/issuer2-profiles.conf) — its public key is the
// one defaultIssuerKey actually signs mdocs with, confirmed by decoding a
// live-issued credential's COSE_Sign1 x5chain header. Despite the Issuer
// field reading "CN=MDOC ROOT CA", this is walt.id's own demo cert, not a
// real external CA; no separate root is published, so this cert IS the trust
// anchor. Subject: CN=walt.is,OU=walt.id,O=walt.id,L=Vienna,ST=Vienna,C=AT.
const MDOC_TRUSTED_CERTIFICATES = [
  `-----BEGIN CERTIFICATE-----
MIIBeTCCAR8CFHrWgrGl5KdefSvRQhR+aoqdf48+MAoGCCqGSM49BAMCMBcxFTAT
BgNVBAMMDE1ET0MgUk9PVCBDQTAgFw0yNTA1MTQxNDA4MDlaGA8yMDc1MDUwMjE0
MDgwOVowZTELMAkGA1UEBhMCQVQxDzANBgNVBAgMBlZpZW5uYTEPMA0GA1UEBwwG
Vmllbm5hMRAwDgYDVQQKDAd3YWx0LmlkMRAwDgYDVQQLDAd3YWx0LmlkMRAwDgYD
VQQDDAd3YWx0LmlzMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEG0RINBiF+oQU
D3d5DGnegQuXenI29JDaMGoMvioKRBN53d4UazakS2unu8BnsEtxutS2kqRhYBPY
k9RAriU3gTAKBggqhkjOPQQDAgNIADBFAiAOMwM7hH7q9Di+mT6qCi4LvB+kH8Ox
MheIrZ2eRPxtDQIhALHzTxwvN8Udt0Z2Cpo8JBihqacfeXkIxVAO8XkxmXhB
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
