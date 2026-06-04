# CDPI Wallet

A **white-label mobile wallet for verifiable credentials**, built on [Credo-TS](https://github.com/openwallet-foundation/credo-ts) and [Expo](https://expo.dev). It implements the full **OpenID4VCI / OpenID4VP** stack with on-device security, selective disclosure, trust governance, and revocation — in English, Spanish, and French.

---

## What is this wallet for?

This app is the **holder** side of the verifiable-credentials triangle (issuer → holder → verifier). It lets a person:

- **Receive** digital credentials (national IDs, diplomas, employment records, etc.) from any standards-compliant **issuer** via OpenID4VCI.
- **Hold** them securely on the device (PIN + biometric protected, keys in the OS secure store).
- **Present** them to a **verifier** via OpenID4VP — choosing exactly which fields to share (selective disclosure), and being warned if a credential is revoked or untrusted.

It is **white-label by design**: a government or organization can ship its own branded credential wallet — name, colors, logo, login provider, and trusted-party list — **without touching the protocol code**. Almost everything you need to rebrand lives in a single file ([branding.config.ts](branding.config.ts)) plus a handful of image assets.

> **Issuer/verifier names and credential labels are resolved automatically** from each party's well-known metadata — there is no per-credential configuration to maintain.

---

## Table of contents

- [How to use it (end-user flow)](#how-to-use-it-end-user-flow)
- [Customize it (white-label)](#customize-it-white-label)
- [Run it (technical setup)](#run-it-technical-setup)
- [Features](#features)
- [Project structure](#project-structure)
- [Deep links](#deep-links)
- [Tests](#tests)
- [Troubleshooting](#troubleshooting)

---

## How to use it (end-user flow)

1. **First launch** — set a 6-digit PIN, optionally enable biometric unlock, and (if SSO is enabled) sign in with your identity provider.
2. **Receive a credential** — tap **Scan**, point at the issuer's QR code (or paste an `openid-credential-offer://` link). Review the issuer's trust badge and the offered credential, enter a transaction code if required, then **Accept and save**.
3. **View a credential** — on **My Wallet**, tap a card. A sheet slides up showing the issuer, credential name, issue date, whether it is *selective disclosure* or *full presentation*, and all its attributes.
4. **Present a credential** — either tap **Present** inside a card's sheet, or scan a verifier's QR code. The wallet shows what will be **disclosed** vs. kept **private**, lets you deselect optional fields, checks revocation, and sends the presentation.
5. **Review activity** — the **Activity** tab keeps a local audit log of every presentation (verifier, purpose, fields shared).
6. **Settings** — change language, toggle biometrics, change PIN, view/share your holder DIDs, and export/restore an encrypted backup.

---

## Customize it (white-label)

Rebranding for a new deployment is three files and a few images.

### 1. Branding, login & trust — [branding.config.ts](branding.config.ts)

This is the **main file a deployment edits**. It holds three exports:

```ts
// Colors, name, and security flags
export const branding = {
  appName: 'CDPI Wallet',
  primaryColor: '#5454ee',          // buttons, active tabs, highlights
  secondaryColor: '#ffffff',        // accents
  backgroundColor: '#f9fafba5',     // app background
  loginBackgroundColor: '#ffffff',  // unlock / login screen background
  headerBackgroundColor: '#ffffff', // top header background
  headerLogoTintColor: undefined,   // set a color to tint the header logo, or leave undefined
  textColor: '#2c2c77',             // titles and header text
  // false = accept credential offers from HTTP (non-HTTPS) issuers (dev/staging).
  // true  = Credo-TS enforces HTTPS and rejects HTTP issuer URLs.
  requireHttps: false,
} as const;

// SSO login (OpenID Connect). Set enabled: false to hide the SSO button.
// Keycloak issuerUrl format: https://{host}/realms/{realm}
export const oidcConfig = {
  enabled: true,
  issuerUrl: 'https://auth.example.com/realms/my-realm',
  clientId: 'my-wallet-oidc-client',
  redirectUri: 'cdpiwallet://auth',  // MUST match app.json "scheme" + "://auth"
  scopes: ['openid', 'profile', 'email'],
  buttonLabel: 'Login with SSO',
};

// Trusted issuers/verifiers. Matched case-insensitively against the party's
// effective client ID, as a plain substring OR a JavaScript regex pattern.
// Anything not listed shows an ⚠ "Unknown" indicator (it is not blocked).
export const trustRegistry: TrustEntry[] = [
  { pattern: 'cdpi\\.dev', name: 'CDPI' },
  { pattern: 'my-trusted-issuer\\.example\\.com', name: 'My Issuer' },
];
```

### 2. Logos & icons — `assets/`

Replace these images **keeping the same filenames**:

| File | Where it appears |
|---|---|
| `assets/logo.png` | Onboarding and unlock screens |
| `assets/header-logo.png` | Top header on the main tabs |
| `assets/icon.png` | App icon (iOS + general) |
| `assets/adaptive-icon.png` | Android adaptive icon foreground |
| `assets/splash.png` | Splash / launch screen |

### 3. App identity — [app.json](app.json)

Set the published identity of the build:

| Field | Purpose |
|---|---|
| `expo.name` | App display name |
| `expo.slug` | Expo project slug |
| `expo.scheme` | Custom URL scheme — **must match** the `oidcConfig.redirectUri` prefix (e.g. scheme `cdpiwallet` → `cdpiwallet://auth`) |
| `expo.ios.bundleIdentifier` | iOS bundle ID (e.g. `org.cdpi.wallet`) |
| `expo.android.package` | Android package name |
| `expo.extra.eas.projectId` | Your own EAS project ID (replace when building under a different Expo account) |

### 4. Languages — `src/i18n/`

English, Spanish, and French are auto-detected from the device locale. To add a language: copy `src/i18n/locales/en.ts`, translate the strings, then register it in [src/i18n/index.ts](src/i18n/index.ts) (`SUPPORTED_LANGS` + the `resources` map).

### Minimum rebrand checklist

- [ ] Edit `branding` (name + colors) in `branding.config.ts`
- [ ] Configure `oidcConfig` (or set `enabled: false`)
- [ ] Add your trusted parties to `trustRegistry`
- [ ] Replace the images in `assets/`
- [ ] Set name, scheme, and bundle/package IDs in `app.json`
- [ ] Build: `npm run build:android:production`

---

## Run it (technical setup)

### Prerequisites

| Tool | Min version | Notes |
|---|---|---|
| Node.js | 20 LTS | |
| npm | 7+ | Bundled with Node 20 |
| EAS CLI | 12.0+ | `npm install -g eas-cli` — only for cloud builds |
| Android Studio | latest | For the Android emulator / native build |
| Xcode | 15+ | macOS only, for iOS |

### Install

```bash
git clone <repo-url>
cd cdpi-wallet
npm install
```

### Develop

Credo-TS needs native modules (Askar, camera, biometrics), so you must run a **dev client** — plain Expo Go will **not** work.

Build the dev client once (installs it on the emulator/device):

```bash
npm run android      # Android
npm run ios          # iOS (macOS only)
```

After that, day-to-day JS changes just need the bundler:

```bash
npm start
```

### Build for distribution (EAS)

```bash
npm run build:android:preview      # Android APK (sideloadable)
npm run build:android:production   # Android AAB (Play Store)
npm run build:ios:production       # iOS IPA (App Store)
```

> Requires an [expo.dev](https://expo.dev) account and `eas login`.

---

## Features

### Issuance — OpenID4VCI
- Authorization Code and Pre-Authorized Code flows (Draft 13, 14, 15)
- SD-JWT (`dc+sd-jwt`), W3C JWT VC (`jwt_vc_json`), and JSON-LD formats
- Transaction code (PIN) support for pre-authorized flows
- Automatic normalization for non-conformant issuers (missing `proof_types_supported`, legacy draft detection, `presentation_definition_uri` inlining)
- HTTP issuer support via `requireHttps: false` (dev/staging)
- Issuer trust badge during accept (trusted / unknown / untrusted)
- OIDC-backed issuance: SSO via `expo-auth-session`, refresh-token storage, server-side logout via `revocation_endpoint`

### Presentation — OpenID4VP
- Presentation Exchange (PEX) matching by `$.vct`, `$.vc.type`, and `credentialVct` tag
- DCQL (`dcql_query`) with `vct_values` matching
- SD-JWT selective disclosure — only requested claims are included
- KB-JWT (Key Binding JWT) attached when the credential declares `cnf`
- Manual posting path for non-conformant / W3C-wrapped issuers
- HTTP `response_uri` bypass for development verifiers
- **Revocation check before presenting** — StatusList2021 (W3C) and TokenStatusList (IETF); blocks a revoked credential, fails open (`unknown`) on network errors

### Selective disclosure UI
- Presentation confirmation splits claims into **Being disclosed** and **Staying private**
- Optional fields are toggles — deselect any non-required claim before confirming
- The credential sheet shows a single **selective disclosure / full presentation** indicator

### Security
- PIN stored as double-SHA256 + random salt (never plain text)
- Progressive lockout: 5 attempts → 30 s, 8 → 5 min, 10 → 30 min
- Biometric unlock (Face ID / fingerprint) via `expo-local-authentication`

### Credential lifecycle
- Expiry indicators (color-coded): **Expired** (red), **Expiring soon ≤ 30 days** (yellow, days left)
- Revocation status surfaced when opening a credential
- Delete with confirmation

### Trust & governance
- Configurable trust registry (substring or regex) → display names
- Trust indicators on verifier and issuer screens: ✓ trusted / ⚠ unknown / ✗ untrusted
- DID management in settings — view all holder DIDs, tap to share

### Presentation history / audit log
- Persistent local log of every OID4VP presentation (timestamp, verifier, purpose, credential types, shared/private fields, trust status, protocol)
- Atomic writes (tmp → final), capped at 200 entries

### Backup & recovery
- Export an **encrypted** backup of the wallet and restore it on another device (Settings → Backup)

---

## Project structure

```
cdpi-wallet/
├── app/                        # Expo Router routes (screens)
│   ├── index.tsx               # Entry / redirect
│   ├── onboarding.tsx          # First-run PIN setup + biometrics
│   ├── unlock.tsx              # PIN / biometric unlock with lockout
│   ├── auth.tsx                # OIDC authentication callback
│   ├── receive.tsx             # Credential issuance (OpenID4VCI)
│   ├── present.tsx             # Credential presentation (OpenID4VP / DCQL)
│   └── (tabs)/
│       ├── credentials/        # Wallet list + inline detail sheet
│       ├── scan.tsx            # QR scanner
│       ├── history.tsx         # Presentation audit log
│       └── settings.tsx        # Security, biometrics, language, DIDs, backup
├── src/
│   ├── agent/                  # Credo-TS agent logic
│   │   ├── setup.ts            # Agent + Askar initialization
│   │   ├── context.tsx         # React context
│   │   ├── trust.ts            # Trust registry matching
│   │   ├── revocation.ts       # StatusList2021 + TokenStatusList
│   │   ├── oid4vci/            # Issuance: normalize, request, store
│   │   └── oid4vp/             # Presentation: normalize, select, present
│   ├── auth/                   # OIDC session + biometric helpers
│   ├── components/             # CredentialCard, NotchedSurface, detail sheet
│   ├── i18n/                   # Locales: en / es / fr
│   ├── utils/                  # storage, credential mapping, history
│   └── __tests__/              # Integration tests (jest-expo)
├── branding.config.ts          # 👈 per-deployment configuration
├── app.json                    # Expo / app identity configuration
├── eas.json                    # EAS build profiles
└── metro.config.js             # Bundler (.cjs support for Credo-TS)
```

---

## Deep links

| Scheme | Purpose |
|---|---|
| `openid-credential-offer://` | Receive a credential offer (OpenID4VCI) |
| `openid4vp://` | Respond to a presentation request (OpenID4VP) |
| `<scheme>://auth` | OIDC authentication callback (`scheme` from `app.json`) |

Declared in [app.json](app.json) as `intentFilters` (Android) and the URL `scheme` (iOS).

---

## Tests

Integration tests cover the core agent logic (no native Credo/Askar bindings required):

| Suite | Covers |
|---|---|
| `trust.test.ts` | Registry pattern matching, case-insensitivity, invalid-regex fallback |
| `normalizeOffer.test.ts` | OID4VCI offer normalization for non-conformant issuers |
| `normalizeRequest.test.ts` | OID4VP request normalization, PD URI inlining, alg injection |
| `selectCredentials.test.ts` | PEX + DCQL credential selection, VCT matching, error paths |
| `revocation.test.ts` | getBit logic, TokenStatusList, StatusList2021 (JWT + JSON-LD) |

```bash
npm test
```

---

## Troubleshooting

**`Cannot find module '@openwallet-foundation/askar-react-native'`**
Use the dev client, not Expo Go. Build it first with `npm run android` or `npm run ios`.

**Metro cannot resolve Credo-TS packages**
Confirm [metro.config.js](metro.config.js) sets `resolver.unstable_enablePackageExports: true` and includes `cjs` in `sourceExts`.

**OIDC login does not redirect back to the app**
The `oidcConfig.redirectUri` must be registered exactly in your identity provider's allowed redirect URIs, and its scheme must match `expo.scheme` in `app.json`.

**Biometrics not working on emulator**
Requires real hardware or an emulator with biometrics enrolled (Android Studio → Virtual Device → Extended Controls → Fingerprint).

**Revocation check always returns "unknown"**
The wallet makes a best-effort request to the issuer's status-list endpoint at presentation time. `unknown` means the endpoint was unreachable or the credential carries no `status` claim — the presentation is **not** blocked. Confirm connectivity and that the issuer publishes `status.status_list` (TokenStatusList) or `credentialStatus` (StatusList2021).

**OID4VP presentation fails for a non-HTTPS verifier**
Set `requireHttps: false` in `branding.config.ts` to route HTTP `response_uri` endpoints through the manual posting bypass.

**App language not changing**
Language follows the device locale automatically (supported: `en`, `es`, `fr`). Add one by copying `src/i18n/locales/en.ts` and registering it in `src/i18n/index.ts`.
