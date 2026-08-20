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
// Imported from the package's dedicated /register subpath, not its main
// export, per the README: importing from the main path would eagerly load
// the native module and break normal app startup on every launch, not just
// the GET_CREDENTIAL one.
import registerGetCredentialComponent from '@animo-id/expo-digital-credentials-api/register';

import { DigitalCredentialsRequestOverlay } from './src/components/DigitalCredentialsRequestOverlay';

registerGetCredentialComponent(DigitalCredentialsRequestOverlay);

// eslint-disable-next-line import/no-unresolved
require('expo-router/entry');
