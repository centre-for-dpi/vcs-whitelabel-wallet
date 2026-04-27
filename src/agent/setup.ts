import {
  Agent,
  AutoAcceptCredential,
  ConnectionsModule,
  ConsoleLogger,
  CredentialsModule,
  DidsModule,
  InitConfig,
  JsonLdCredentialFormatService,
  KeyDidRegistrar,
  KeyDidResolver,
  LogLevel,
  MediationRecipientModule,
  V2CredentialProtocol,
  W3cCredentialsModule,
  WebDidResolver,
} from '@credo-ts/core';
import {
  HttpOutboundTransport,
  WsOutboundTransport,
  agentDependencies,
} from '@credo-ts/react-native';
import { AskarModule } from '@credo-ts/askar';
import { OpenId4VcHolderModule } from '@credo-ts/openid4vc';
import { ariesAskar } from '@openwallet-foundation/askar-react-native';

export type WalletAgent = Agent;

export const setupAgent = async (walletKey: string): Promise<WalletAgent> => {
  const config: InitConfig = {
    label: 'cdpi-wallet',
    walletConfig: {
      id: 'cdpi-wallet-v1',
      key: walletKey,
    },
    logger: new ConsoleLogger(LogLevel.warn),
  };

  const agent = new Agent({
    config,
    modules: {
      // Storage — required
      askar: new AskarModule({ ariesAskar }),

      // OID4VCI + OID4VP (INJI, walt.id, CREDEBL future)
      openId4VcHolder: new OpenId4VcHolderModule(),

      // DID management
      dids: new DidsModule({
        registrars: [new KeyDidRegistrar()],
        resolvers: [new KeyDidResolver(), new WebDidResolver()],
      }),

      // W3C VC storage and validation
      w3cCredentials: new W3cCredentialsModule(),

      // DIDComm — for CREDEBL compatibility today
      connections: new ConnectionsModule({ autoAcceptConnections: true }),
      credentials: new CredentialsModule({
        autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
        credentialProtocols: [
          new V2CredentialProtocol({
            credentialFormats: [new JsonLdCredentialFormatService()],
          }),
        ],
      }),
      mediationRecipient: new MediationRecipientModule(),
    },
    dependencies: agentDependencies,
  });

  agent.registerOutboundTransport(new HttpOutboundTransport());
  agent.registerOutboundTransport(new WsOutboundTransport());

  await agent.initialize();
  return agent;
};
