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

/**
 * Wallet visual design — controls the pocket card-holder look and feel.
 * Every value here is a deployment customization point.
 */
export const walletDesign = {
  // ── Screen background ───────────────────────────────────────────────────
  screenBgColor: '#F9FAFB',

  // ── Card geometry ────────────────────────────────────────────────────────
  cardHeight: 90,        // height of the card body (without the knot)
  tabRX: 48,             // horizontal radius of the knot
  tabRY: 36,             // vertical radius of the knot
  tabShoulder: 12,       // radius of the knot shoulders (inner corners)
  cardCornerRadius: 13,  // top corners of the card

  // ── Dotted Lines ─────────────────────────────────────────────────────
  dashPattern: '6 14',   // 'long_dash long_space'
  dashColor: '#C2CAD4',  // color of the dotted lines
  dashWidth: 2.0,        // thickness of the dotted lines
  frameRadius: 18,       // radius of the corners of the dotted frame
  pocketRadius: 20,      // radius of the corners between each pocket
  dividerGap: 10,        // gap between the line and the edge of the card

  // ── pockets background ─────────────────────────────────────────────────────
  pocketBgColor: '#955f50',      // color of the pockets background
  pocketBorderColor: '#D7DBE0',  // color of the pockets border
  pocketBorderWidth: 6,          // thickness of the pockets border
  pocketBgRadius: 18,            // radius of the corners of the pockets background

  // ── Spacing (from outside to inside) ──────────────────────────────────
  pocketScreenGap: 10,   // gap between the pockets and the screen edge
  frameBgGap: 12,        // gap between the dotted lines and the pockets background
  cardFrameGap: 14,      // gap between the cards and the dotted lines
  walletPad: 14,         // vertical padding inside the wallet
  knotToNextCard: 60,    // gap between the knot and the next card

  // ── Add card button ─────────────────────────────────────────────────
  addCardBgColor: '#4B5563',
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
  issuerUrl: 'https://keycloak.verifiably.ysalabs.work/realms/vcplatform',
  clientId: 'vcplatform',
  redirectUri: 'cdpiwallet://auth',
  scopes: ['openid', 'profile', 'email'],
  buttonLabel: 'Login with SSO',
};

// Credential discovery — powers the "Descubrir" tab.
//
// hubUrl points at the federation hub (verifiably-go in the `hub` role), which
// aggregates every trusted member's /.well-known/openid-credential-issuer into
// one catalog. The wallet GETs `${hubUrl}/api/v1/discovery/credentials`, then
// self-issues each credential against ITS OWN `service_endpoint` returned in
// that catalog — so a citizen browses the whole federation and downloads any
// credential they're eligible for, no operator in the loop. Self-issue requires
// the citizen's OIDC id_token (oidcConfig above must be enabled).
//
// Set hubUrl to your hub host. Leave enabled:false to hide the tab.
export const discoveryConfig: {
  enabled: boolean;
  hubUrl: string;
} = {
  enabled: true,
  hubUrl: 'https://verifiably.ysalabs.work',
};
