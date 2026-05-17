# CDPI Wallet

White-label mobile verifiable credential wallet built on [Credo-TS](https://github.com/openwallet-foundation/credo-ts) and Expo. Implements the full OID4VCI / OID4VP stack with production-grade security, selective disclosure, trust governance, and revocation — available in English, Spanish, and French.

---

## Features

### Credential issuance — OpenID4VCI
- Authorization Code and Pre-Authorized Code flows (Draft 13, 14, 15)
- SD-JWT (`dc+sd-jwt`), W3C JWT VC (`jwt_vc_json`), and JSON-LD formats
- Transaction code (PIN) support for pre-authorized flows
- Automatic normalization for non-conformant issuers (missing `proof_types_supported`, legacy draft detection, `presentation_definition_uri` inlining)
- HTTP issuer support via `requireHttps: false` flag (dev/staging environments)
- Issuer trust badge displayed during the accept flow (trusted / unknown / untrusted)
- OIDC-backed issuance: SSO via `expo-auth-session`, refresh token storage, server-side logout via `revocation_endpoint`

### Credential presentation — OpenID4VP
- Presentation Exchange (PEX) with `input_descriptors` matching by `$.vct`, `$.vc.type`, and `credentialVct` tag
- DCQL (`dcql_query`) with `vct_values` matching
- SD-JWT selective disclosure — only requested claims are included in the presentation
- KB-JWT (Key Binding JWT) attached when the credential declares `cnf`
- Manual posting for non-conformant / W3C-wrapped issuers that bypass Credo's strict HTTPS validation
- HTTP `response_uri` bypass path for development verifiers
- **Revocation check before presenting**: StatusList2021 (W3C) and TokenStatusList (IETF draft) — blocks presentation if credential is revoked; returns `unknown` gracefully on network failure

### Selective disclosure UI
- Confirmation screen breaks down claims into **Being disclosed** (shared with verifier) and **Staying private** (remains hidden)
- Optional fields rendered as toggles — user can deselect any non-required claim before confirming
- Each credential attribute tagged with an `SD` badge if it is selectively disclosable

### Security
- PIN protected with double-SHA256 + random salt (no plain-text PIN ever stored)
- Progressive lockout after failed attempts: 5 attempts → 30 s, 8 → 5 min, 10 → 30 min
- Biometric unlock: Face ID / fingerprint via `expo-local-authentication`, enabled optionally during onboarding or toggled in settings

### Credential lifecycle
- Expiry indicators on credential cards (color-coded accent bar) and detail screen:
  - **Expired** — red badge
  - **Expiring soon** (≤ 30 days) — yellow badge with days remaining
- Revocation status badge in credential detail: checks StatusList2021 or TokenStatusList on open
- Delete credential with confirmation dialog

### Trust & governance
- Configurable trust registry in `branding.config.ts`: URL patterns (plain substring or regex) mapped to display names
- Trust indicators on verifier (present) and issuer (receive) screens: ✓ trusted / ⚠ unknown / ✗ untrusted
- DID management section in settings — view all holder DIDs, tap to share via native share sheet

### Presentation history / audit log
- Persistent local log of every OID4VP presentation
- Each entry records: timestamp, verifier, purpose, credential types, shared fields, private fields count, trust status, protocol used (PEX or DCQL)
- Atomic file writes (tmp → final) with recovery from partial writes; capped at 200 entries

### Internationalization
- English, Spanish, and French — auto-detected from device locale
- All strings in `src/i18n/locales/` — add a new locale by creating one file

### White-label
- Colors, app name, OIDC config, and trust registry all in a single file: `branding.config.ts`
- Replace `assets/logo.png` to change the logo

### Test suite
74 integration tests covering core agent logic (no native Credo/Askar bindings required):

| Suite | Tests | Covers |
|---|---|---|
| `trust.test.ts` | 10 | Registry pattern matching, case-insensitive, invalid regex fallback |
| `normalizeOffer.test.ts` | 13 | OID4VCI offer normalization: 3 patches for non-conformant issuers |
| `normalizeRequest.test.ts` | 15 | OID4VP request normalization, PD URI inlining, alg injection |
| `selectCredentials.test.ts` | 15 | PEX + DCQL credential selection, VCT matching, error paths |
| `revocation.test.ts` | 21 | getBit logic, TokenStatusList, StatusList2021 (JWT + JSON-LD) |

Run with:
```bash
npm test
```

---

## Prerequisites

| Tool | Min version | Notes |
|---|---|---|
| Node.js | 20 LTS | |
| npm | 7+ | Bundled with Node 20 |
| EAS CLI | 12.0+ | `npm install -g eas-cli` — only needed for cloud builds |
| Android Studio | latest | For Android emulator or native compilation |
| Xcode | 15+ | macOS only, for iOS |

---

## Installation

```bash
git clone <repo-url>
cd cdpi-wallet
npm install
```

---

## Configuration

Edit [branding.config.ts](branding.config.ts):

```ts
export const branding = {
  appName: 'My Wallet',
  primaryColor: '#db1a3d',
  secondaryColor: '#ffffff',
  backgroundColor: '#F9FAFB',
  loginBackgroundColor: '#06095a',
  headerBackgroundColor: '#06095a',
  headerLogoTintColor: '#F9FAFB',
  textColor: '#F9FAFB',
  // Set to false to allow credential offers from HTTP (non-HTTPS) issuers.
  requireHttps: true,
};

// SSO login — configure to enable OIDC authentication
export const oidcConfig = {
  enabled: true,
  issuerUrl: 'https://<oidc-host>',
  clientId: '<client-id>',
  redirectUri: '<app-scheme>://auth',
  scopes: ['openid', 'profile', 'email'],
  buttonLabel: 'Continue with <provider>',
};

// Trust registry — URL patterns matched against issuer/verifier effective client ID.
// Each entry can be a plain substring or a JavaScript-compatible regex pattern.
export const trustRegistry: TrustEntry[] = [
  { pattern: 'cdpi\\.dev', name: 'CDPI' },
  { pattern: 'my-trusted-issuer\\.example\\.com', name: 'My Issuer' },
];
```

Replace the app logo by overwriting `assets/logo.png` (keep the same filename).

> Issuer names and credential type labels are resolved automatically from each OID4VCI issuer's well-known metadata — no manual configuration required.

---

## Running in development

Credo-TS requires native modules (Askar, camera, biometrics), so a **dev client** is needed — standard Expo Go will not work.

Build the dev client once:

```bash
# Android
npm run android

# iOS (macOS only)
npm run ios
```

Subsequent JS changes only require restarting the bundler:

```bash
npm start
```

---

## EAS Builds

```bash
# Android APK (preview — sideloadable)
npm run build:android:preview

# Android AAB (production — Play Store)
npm run build:android:production

# iOS IPA (production — App Store)
npm run build:ios:production
```

> Requires an [expo.dev](https://expo.dev) account and `eas login`.

---

## Project structure

```
cdpi-wallet/
├── app/                        # Expo Router routes
│   ├── index.tsx               # Entry / redirect
│   ├── onboarding.tsx          # First-run PIN setup + biometrics enrollment
│   ├── unlock.tsx              # PIN / biometric unlock with lockout
│   ├── auth.tsx                # OIDC authentication callback
│   ├── receive.tsx             # Credential issuance (OpenID4VCI)
│   ├── present.tsx             # Credential presentation (OpenID4VP / DCQL)
│   └── (tabs)/
│       ├── credentials/        # Credential list (with expiry badges) and detail
│       ├── scan.tsx            # QR scanner
│       ├── history.tsx         # Presentation audit log
│       └── settings.tsx        # Security, biometrics, language, DIDs
├── src/
│   ├── agent/                  # Credo-TS agent logic
│   │   ├── setup.ts            # Agent + Askar initialization
│   │   ├── context.tsx         # React context
│   │   ├── trust.ts            # Trust registry matching
│   │   ├── revocation.ts       # StatusList2021 + TokenStatusList check
│   │   ├── oid4vci/            # Issuance: normalize, request, store
│   │   └── oid4vp/             # Presentation: normalize, select, present
│   ├── auth/
│   │   ├── UserContext.tsx     # OIDC session, refresh token, logout
│   │   └── biometric.ts        # Biometric enroll / authenticate helpers
│   ├── components/
│   │   └── CredentialCard.tsx  # Card with expiry badge and accent color
│   ├── i18n/                   # Locales: en / es / fr
│   ├── utils/
│   │   ├── storage.ts          # Secure PIN hash, lockout state, wallet keys
│   │   ├── credential.ts       # CredentialEntry mapping, expiry helpers
│   │   └── presentationHistory.ts  # Atomic audit log (tmp→final, 200-entry cap)
│   └── __tests__/              # Integration tests (74 tests, jest-expo)
├── branding.config.ts          # Per-deployment configuration
├── app.json                    # Expo configuration
├── eas.json                    # EAS build profiles
└── metro.config.js             # Bundler (.cjs support for Credo-TS)
```

---

## Deep links

| Scheme | Purpose |
|---|---|
| `openid-credential-offer://` | Receive a credential offer (OpenID4VCI) |
| `openid4vp://` | Respond to a presentation request (OpenID4VP) |
| `<app-scheme>://auth` | OIDC authentication callback |

Declared in [app.json](app.json) as `intentFilters` (Android) and a URL scheme (iOS).

---

## Troubleshooting

**`Cannot find module '@openwallet-foundation/askar-react-native'`**  
Use the dev client, not Expo Go. Build it first with `npm run android` or `npm run ios`.

**Metro cannot resolve Credo-TS packages**  
Check that [metro.config.js](metro.config.js) has `resolver.unstable_enablePackageExports: true` and `sourceExts` includes `cjs`.

**OIDC login does not redirect back to the app**  
Ensure `redirectUri` in [branding.config.ts](branding.config.ts) is registered exactly in your identity provider's allowed redirect URIs, including the custom scheme.

**Biometrics not working on emulator**  
Requires real hardware or an emulator with biometrics configured (Android Studio → Virtual Device → Extended Controls → Fingerprint).

**Credential revocation check always returns unknown**  
The wallet issues a best-effort HTTP request to the issuer's status list endpoint at presentation time. `unknown` means the endpoint was unreachable or the credential carries no `status` claim — the presentation is not blocked. Check network connectivity or confirm the issuer publishes a `status.status_list` (TokenStatusList) or `credentialStatus` (StatusList2021) claim in the credential.

**OID4VP presentation fails for a non-HTTPS verifier**  
Set `requireHttps: false` in `branding.config.ts`. The wallet will route HTTP `response_uri` endpoints through its manual posting bypass, skipping Credo's HTTPS enforcement.

**App language not changing**  
Language follows the device locale automatically. Supported locales: `en`, `es`, `fr`. To add a new language, copy `src/i18n/locales/en.ts` and register it in `src/i18n/index.ts`.
