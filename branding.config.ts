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
  appName: 'CDPI Bootcamp Wallet',
  primaryColor: '#db1a3d',
  secondaryColor: '#E8F0FE',
  backgroundColor: '#F9FAFB',
  textColor: '#111827',

  // Mediator URL for DIDComm connectivity (CREDEBL)
  // Change VPS_IP to your server's public IP address
  mediatorUrl: 'ws://crebebl.bootcamp.cdpi.dev/mediator/ws',

  // Issuers shown in the "Get a credential" screen
  issuers: [
    {
      id: 'employment',
      label: 'Issuer of Employment Credential',
      url: 'https://credebl.bootcamp.cdpi.dev',
      dpg: 'credebl' as const,
    },
  ],
} as const;

export type Dpg = 'inji' | 'credebl' | 'waltid';
