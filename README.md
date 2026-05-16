# CDPI Wallet

White-label mobile verifiable credential wallet built on [Credo-TS](https://github.com/openwallet-foundation/credo-ts) and Expo. Supports credential issuance (OpenID4VCI), presentation (OpenID4VP / DCQL with SD-JWT disclosure), SSO login via OIDC, and a full presentation history log. Available in English, Spanish, and French.

---

## Features

- **Credential issuance** — OpenID4VCI (Authorization Code and Pre-Authorized Code flows)
- **Credential presentation** — OpenID4VP with DCQL query support and selective SD-JWT disclosure
- **SSO login** — OIDC via `expo-auth-session`
- **Presentation history** — local log of every OID4VP presentation with verifier, purpose, and disclosed fields
- **Biometric unlock** — Face ID / fingerprint gate on app open
- **White-label** — all colors, name, and logo configured in a single file (`branding.config.ts`)
- **Internationalization** — English, Spanish, and French built-in
- **HTTP issuer support** — optional `requireHttps: false` flag for non-HTTPS environments

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

Edit [branding.config.ts](branding.config.ts) with the values for your deployment:

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
```

Replace the app logo by overwriting `assets/logo.png` (keep the same filename).

> Issuer names and credential type labels are resolved automatically from each OID4VCI issuer's well-known metadata — no manual configuration required.

> Set `requireHttps: false` in `branding.config.ts` to allow credential offers from non-HTTPS issuers (useful in development / staging environments).

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

This installs the app with all native modules. Subsequent JS changes only require restarting the bundler:

```bash
npm start
```

---

## EAS Builds

Generate APK/IPA without a local native environment.

```bash
# Android APK (preview — sideloadable)
npm run build:android:preview
# or: eas build --platform android --profile preview

# Android AAB (production — Play Store)
npm run build:android:production
# or: eas build --platform android --profile production

# iOS IPA (production — App Store)
npm run build:ios:production
# or: eas build --platform ios --profile production
```

> Requires an [expo.dev](https://expo.dev) account and `eas login`.

---

## Project structure

```
cdpi-wallet/
├── app/                   # Expo Router routes
│   ├── index.tsx          # Entry screen
│   ├── onboarding.tsx     # First-run flow
│   ├── unlock.tsx         # Biometric / PIN unlock
│   ├── auth.tsx           # OIDC authentication callback
│   ├── receive.tsx        # Credential issuance (OpenID4VCI)
│   ├── present.tsx        # Credential presentation (OpenID4VP / DCQL)
│   └── (tabs)/            # Tab navigation
│       ├── credentials/   # Credential list and detail
│       ├── scan.tsx       # QR scanner
│       ├── history.tsx    # Presentation history log
│       └── settings.tsx   # Settings and session
├── src/
│   ├── agent/             # Credo-TS agent logic
│   │   ├── setup.ts       # Agent initialization
│   │   ├── context.tsx    # Agent React context
│   │   ├── credentialBinding.ts
│   │   ├── oid4vci/       # Issuance: requestCredentials, storeCredential, normalizeOffer
│   │   └── oid4vp/        # Presentation: selectCredentials, presentCredentials, normalizeRequest
│   ├── auth/              # OIDC user context (UserContext)
│   ├── components/        # Shared components (CredentialCard)
│   ├── i18n/              # Internationalization (EN / ES / FR)
│   └── utils/             # Helpers (storage, credential, QR, presentationHistory)
├── assets/                # App logo and images
├── branding.config.ts     # Per-deployment configuration
├── app.json               # Expo configuration
├── eas.json               # EAS build profiles
└── metro.config.js        # Bundler (.cjs support for Credo-TS)
```

---

## Deep links

| Scheme | Purpose |
|---|---|
| `openid-credential-offer://` | Receive a credential offer (OpenID4VCI) |
| `openid4vp://` | Respond to a presentation request (OpenID4VP) |
| `<app-scheme>://auth` | OIDC authentication callback |

Declared in [app.json](app.json) as `intentFilters` for Android and as a URL scheme for iOS.

---

## Troubleshooting

**`Cannot find module '@openwallet-foundation/askar-react-native'`**  
Use the dev client, not Expo Go. Build it first with `npm run android` or `npm run ios`.

**Metro cannot resolve Credo-TS packages**  
Check that [metro.config.js](metro.config.js) has `resolver.unstable_enablePackageExports: true` and `sourceExts` includes `cjs`.

**OIDC login does not redirect back to the app**  
Ensure `redirectUri` in [branding.config.ts](branding.config.ts) is registered exactly in Keycloak → Client → Valid redirect URIs, including the custom scheme.

**Biometrics not working on emulator**  
Biometric authentication requires real hardware or an emulator with biometrics configured (Android Studio → Virtual Device → Extended Controls → Fingerprint).

**App language not changing**  
The language follows the device locale automatically. To test a specific locale, change the device language in Settings. Supported locales: `en`, `es`, `fr`. Add translations in `src/i18n/locales/`.

**OID4VP presentation fails with DCQL error**  
Ensure the verifier sends a `dcql_query` and that the credential uses the `dc+sd-jwt` format. The wallet selects credentials and discloses only the requested SD-JWT fields automatically.
