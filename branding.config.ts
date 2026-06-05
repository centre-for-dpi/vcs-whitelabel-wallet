/**
 * Branding configuration — the only file a country needs to edit.
 *
 * Steps to customize:
 *  1. Change appName, primaryColor, secondaryColor
 *  2. Replace assets/logo.png with your logo (keep the same filename)
 *  3. Add trusted issuers/verifiers to trustRegistry
 *  4. Run: eas build --platform android --profile production
 */

import type { TrustEntry } from './src/agent/trust';

export const branding = {
  appName: 'Wakanda National Wallet',
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

/**
 * Trust Registry — add domains/patterns for issuers and verifiers you trust.
 * Entries are matched case-insensitively as substrings or regex patterns.
 * Credentials from unlisted entities are shown with an ⚠ Unknown indicator.
 */
export const trustRegistry: TrustEntry[] = [
  { pattern: 'cdpi\\.dev', name: 'CDPI' },
  { pattern: 'bootcamp\\.cdpi\\.dev', name: 'CDPI Bootcamp' },
];

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
