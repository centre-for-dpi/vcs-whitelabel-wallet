import { Agent, ConsoleLogger, InitConfig, LogLevel } from '@credo-ts/core';
import { agentDependencies } from '@credo-ts/react-native';
import { AskarModule } from '@credo-ts/askar';
import { OpenId4VcHolderModule } from '@credo-ts/openid4vc';
import { ariesAskar } from '@openwallet-foundation/askar-react-native';

export type WalletAgent = Agent<{
  askar: AskarModule;
  openId4VcHolder: OpenId4VcHolderModule;
}>;

export const setupAgent = async (): Promise<WalletAgent> => {
  const config: InitConfig = {
    label: 'cdpi-wallet',
    walletConfig: {
      id: 'cdpi-wallet-v1',
      key: 'cdpi-wallet-key-v1',
    },
    logger: new ConsoleLogger(LogLevel.warn),
  };

  const agent = new Agent({
    config,
    modules: {
      askar: new AskarModule({ ariesAskar }),
      openId4VcHolder: new OpenId4VcHolderModule(),
    },
    dependencies: agentDependencies,
  });

  await agent.initialize();
  return agent;
};
