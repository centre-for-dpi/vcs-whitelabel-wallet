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
// ANDROID ONLY, and the guard has to be here rather than inside the imported
// module. The package declares `"platforms": ["android"]` and ships no ios/
// directory at all; its register() calls ensureAndroid(), which throws
// `Expo Digital Credentials API library is not supported on iOS` outright.
// A static `import` is hoisted and evaluated before any statement in this
// file, so on iOS that throw happened before require('expo-router/entry')
// could run — the app died at its entry point with no UI ever mounting, not
// even the unlock screen. A white screen with a successful build is the exact
// signature: the bundle is fine, it just throws on its first line.
//
// require() inside the branch keeps the module off the iOS execution path
// entirely. Importing from the /register subpath (not the main export) is
// still required on Android per the README: the main path eagerly loads the
// native module and would break normal startup on every launch.
if (require('react-native').Platform.OS === 'android') {
  const registerGetCredentialComponent =
    require('@animo-id/expo-digital-credentials-api/register').default;
  const {
    DigitalCredentialsRequestOverlay,
  } = require('./src/components/DigitalCredentialsRequestOverlay');

  registerGetCredentialComponent(DigitalCredentialsRequestOverlay);
}

// eslint-disable-next-line import/no-unresolved
require('expo-router/entry');
