/**
 * Branding configuration — the only file a country needs to edit.
 *
 * Steps to customize:
 *  1. Change appName, primaryColor, secondaryColor
 *  2. Replace assets/logo.png with your logo (keep the same filename)
 *  3. Run: eas build --platform android --profile production
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
  // Set to false to allow credential offers from HTTP (non-HTTPS) issuers.
  // When true, Credo-TS enforces HTTPS and rejects HTTP issuer URLs.
  requireHttps: false,
} as const;

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
