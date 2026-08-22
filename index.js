// Custom entry point, required by @animo-id/expo-digital-credentials-api's
// documented setup (its README's "Registering the component" section, which
// links to Expo Router's own custom-entry-point guide,
// https://docs.expo.dev/router/installation/#custom-entry-point-to-initialize-and-load).
//
// registerGetCredentialComponent must run before expo-router/entry loads the
// app, so Android's androidx.credentials.registry.provider.action.GET_CREDENTIAL
// intent (fired when the user picks cdpi-wallet from the system credential
// picker — C.7.3b) has a component to render into, no matter which route the
// main app would otherwise have booted into.
//
// The CALL is Android-only; the imports stay static and unconditional.
//
// The package declares `"platforms": ["android"]`, ships no ios/ directory,
// and its register() calls ensureAndroid(), which throws
// `Expo Digital Credentials API library is not supported on iOS`. Calling it
// unconditionally killed iOS at its entry point — white screen, no UI, not
// even the unlock screen, while every CI build stayed green because the
// bundle itself is fine and only throws at runtime.
//
// Guarding with require() inside an `if` instead was WORSE: it turned the
// white screen into an immediate crash on launch. metro.config.js sets
// unstable_enablePackageExports, so a runtime require() of the /register
// subpath resolves differently from the static import the bundler prepares.
// Importing statically and guarding only the call is what the rest of the
// codebase already does — see app/(tabs)/credentials/index.tsx, which imports
// registerMdlDigitalCredentials at module scope and wraps only the invocation
// in `Platform.OS === 'android'`. Importing the module is harmless on iOS;
// invoking it is not.
import { Platform } from 'react-native';

import registerGetCredentialComponent from '@animo-id/expo-digital-credentials-api/register';

import { DigitalCredentialsRequestOverlay } from './src/components/DigitalCredentialsRequestOverlay';

if (Platform.OS === 'android') {
  registerGetCredentialComponent(DigitalCredentialsRequestOverlay);
}

// eslint-disable-next-line import/no-unresolved
require('expo-router/entry');
