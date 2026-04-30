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
} from '@credo-ts/core';
import { agentDependencies } from '@credo-ts/react-native';
import { AskarModule } from '@credo-ts/askar';
import { OpenId4VcModule } from '@credo-ts/openid4vc';
import { askar } from '@openwallet-foundation/askar-react-native';

export type WalletAgent = Agent;

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
    },
    dependencies: agentDependencies,
  });

  await agent.initialize();
  return agent;
};
