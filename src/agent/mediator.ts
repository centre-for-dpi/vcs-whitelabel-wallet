import type { WalletAgent } from './setup';
import { branding } from '../../branding.config';

export const connectToMediator = async (agent: WalletAgent): Promise<void> => {
  if (!branding.mediatorUrl || branding.mediatorUrl.includes('VPS_IP')) {
    // Mediator URL not configured — skip silently
    return;
  }

  try {
    await agent.mediationRecipient.provision({
      mediatorPickupStrategy: undefined,
    });
  } catch {
    // Mediator connection is best-effort; wallet still works for OID4VCI/OID4VP
  }
};
