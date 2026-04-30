import type { WalletAgent } from './setup';

// DIDComm mediation was removed in @credo-ts/core 0.6.x; OID4VC flows don't need it
export const connectToMediator = async (_agent: WalletAgent): Promise<void> => {
  return;
};
