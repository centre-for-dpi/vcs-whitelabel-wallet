/**
 * Branding configuration — the only file a country needs to edit.
 *
 * Steps to customize:
 *  1. Change appName, primaryColor, secondaryColor
 *  2. Replace assets/logo.png with your logo (keep the same filename)
 *  3. Update the issuers list with your deployment URLs
 *  4. Run: eas build --platform android --profile production
 */

export const branding = {
  appName: 'ROBI Wallet',
  primaryColor: '#db1a3d',
  secondaryColor: '#ffffff',
  backgroundColor: '#F9FAFB',
  loginBackgroundColor: '#06095a',
  headerBackgroundColor: '#06095a',
  headerLogoTintColor: '#F9FAFB' as string | undefined,
  textColor: '#F9FAFB',

  // Issuers shown in the "Get a credential" screen.
  // credentials: list of cleaned credential type names issued by this issuer
  // (used to resolve the issuer display name when the raw URL/DID is not readable).
  issuers: [
    {
      id: 'employment',
      label: 'Issuer of Employment Credential',
      url: 'https://credebl.bootcamp.cdpi.dev',
      dpg: 'credebl' as const,
      credentials: ['Employment Credential'],
    },
    {
      id: 'ministerio-agricultura',
      label: 'Ministerio de Agricultura',
      url: 'https://walt-issuer.bootcamp.cdpi.dev',
      dpg: 'waltid' as const,
      credentials: ['Cedula Rural'],
    },
    {
      id: 'migracion-colombia',
      label: 'Migracion Colombia  ',
      url: 'https://walt-issuer.bootcamp.cdpi.dev',
      dpg: 'waltid' as const,
      credentials: ['Permiso de Proteccion Temporal'],
    }
  ],
} as const;

export type Dpg = 'inji' | 'credebl' | 'waltid';

// OIDC configuration — edit these values to enable SSO login.
// Keycloak issuerUrl format: https://{host}/realms/{realm}
// Register redirectUri exactly as-is in Keycloak → Client → Valid redirect URIs
export const oidcConfig: {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  buttonLabel: string;
} = {
  enabled: true,
  issuerUrl: 'https://qaautenticaciondigital.and.gov.co',
  clientId: 'colombiawalletQA',
  redirectUri: 'colombiawallet://auth',
  scopes: ['openid', 'profile', 'email'],
  buttonLabel: 'Continuar con ID Colombia',
};
