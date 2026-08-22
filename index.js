// Custom entry point, required by @animo-id/expo-digital-credentials-api's
// documented setup (its README's "Registering the component" section, which
// links to Expo Router's own custom-entry-point guide,
// https://docs.expo.dev/router/installation/#custom-entry-point-to-initialize-and-load).
//
// ORDER IS LOAD-BEARING. '@expo/metro-runtime' must be the first import in the
// entry point: expo-router/entry-classic.js opens with the comment
// "`@expo/metro-runtime` MUST be the first import" and imports it before
// anything else, and it installs global runtime setup (location polyfills,
// the RSC runtime) that the rest of the app assumes is already in place.
//
// Setting "main": "index.js" in package.json moved the entry point here, so
// this file — not expo-router/entry — is what loads first. Any import placed
// above expo-router/entry therefore runs BEFORE metro-runtime is installed.
// That is what took iOS down: first a white screen, then an outright crash on
// launch once the import was reshuffled. Android tolerated it; iOS did not.
//
// So: expo-router/entry first, and only then the Android registration.
require('expo-router/entry');

// Diagnostic: log uncaught JS errors before RN's default handler runs.
// Added after an iOS crash whose device .ips carried only a generic C++
// stack (objc_exception_rethrow / ObjCTurboModule::performVoidMethodInvocation)
// with no exception message — Console.app wasn't available to get the real
// reason. This won't fix a native-level crash (one that never reaches JS'
// ErrorUtils at all), but it ensures the next uncaught JS-level exception on
// either platform gets its message and stack into the log, not just a
// symbol-less abort().
{
  const ErrorUtils = require('react-native').ErrorUtils;
  const originalHandler = ErrorUtils?.getGlobalHandler?.();
  ErrorUtils?.setGlobalHandler?.((error, isFatal) => {
    console.error('[global-error-handler]', isFatal ? 'FATAL' : 'non-fatal', error?.message, error?.stack);
    originalHandler?.(error, isFatal);
  });
}

// registerGetCredentialComponent gives Android's
// androidx.credentials.registry.provider.action.GET_CREDENTIAL intent (fired
// when the user picks cdpi-wallet from the system credential picker — C.7.3b)
// a component to render into.
//
// The CALL is Android-only; the import is inert everywhere. The package
// declares "platforms": ["android"], ships no ios/ directory, and its
// register() calls ensureAndroid(), which throws
// `Expo Digital Credentials API library is not supported on iOS`. Verified in
// the package's own build output that ensureAndroid() sits INSIDE register()
// and neither register.js nor util.js does anything at module scope, so
// importing on iOS is safe and only invoking it is not.
//
// Guarding the call (rather than the import) is also what the rest of the
// codebase does — see app/(tabs)/credentials/index.tsx, which imports
// registerMdlDigitalCredentials at module scope and wraps only the invocation
// in `Platform.OS === 'android'`.
const { Platform } = require('react-native');

if (Platform.OS === 'android') {
  const registerGetCredentialComponent =
    require('@animo-id/expo-digital-credentials-api/register').default;
  const {
    DigitalCredentialsRequestOverlay,
  } = require('./src/components/DigitalCredentialsRequestOverlay');

  registerGetCredentialComponent(DigitalCredentialsRequestOverlay);
}
