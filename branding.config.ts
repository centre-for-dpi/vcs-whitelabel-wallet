/**
 * Branding configuration — the only file a country needs to edit.
 *
 * Steps to customize:
 *  1. Change appName, primaryColor, secondaryColor
 *  2. Replace assets/logo.png with your logo (keep the same filename)
 *  3. Update mediatorUrl with your VPS IP (required for CREDEBL DIDComm)
 *  4. Update the issuers list with your deployment URLs
 *  5. Run: eas build --platform android --profile production
 */

export const branding = {
  appName: 'CDPI Wallet',
  primaryColor: '#1A56DB',
  secondaryColor: '#E8F0FE',
  backgroundColor: '#F9FAFB',
  textColor: '#111827',

  // Mediator URL for DIDComm connectivity (CREDEBL)
  // Change VPS_IP to your server's public IP address
  mediatorUrl: 'ws://VPS_IP:3010/ws',

  // Issuers shown in the "Get a credential" screen
  issuers: [
    {
      id: 'employment',
      label: 'Ministerio del Trabajo',
      url: 'http://VPS_IP:8091',
      dpg: 'inji' as const,
    },
  ],
} as const;

export type Dpg = 'inji' | 'credebl' | 'waltid';
