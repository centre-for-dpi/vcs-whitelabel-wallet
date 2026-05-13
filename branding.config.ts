/**
 * Branding configuration — the only file a country needs to edit.
 *
 * Steps to customize:
 *  1. Change appName, primaryColor, secondaryColor
 *  2. Replace assets/logo.png with your logo (keep the same filename)
 *  3. Run: eas build --platform android --profile production
 */

export const branding = {
  appName: 'CDPI Wallet',
  primaryColor: '#5454ee',           // CDPI purple — buttons, active tabs, highlights
  secondaryColor: '#ffffff',         // CDPI dark navy — accents
  backgroundColor: '#f9fafba5',
  loginBackgroundColor: '#ffffff',   // white login screen (CDPI website style)
  headerBackgroundColor: '#ffffff',  // white header (CDPI website style)
  headerLogoTintColor: undefined as string | undefined,  // no tint — black logo on white header
  textColor: '#2c2c77',              // CDPI dark navy for titles and header text
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
  issuerUrl: 'https://auth.bootcamp.cdpi.dev/realms/verifiably-demo',
  clientId: 'cdpi-wallet-oidc-client',
  redirectUri: 'cdpiwallet://auth',
  scopes: ['openid', 'profile', 'email'],
  buttonLabel: 'Login with SSO',
};
