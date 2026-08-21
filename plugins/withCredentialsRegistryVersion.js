const { withAppBuildGradle } = require('@expo/config-plugins');

// Forces androidx.credentials.registry:* artifacts to 1.0.0-alpha05.
//
// @animo-id/expo-digital-credentials-api@0.4.0's own build.gradle hardcodes
// androidx.credentials.registry:{registry-provider,registry-provider-play-services,
// registry-digitalcredentials-mdoc}:1.0.0-alpha01 — the very first release.
// `supportedProtocols` on the registration side (and the corresponding
// matcher-side gate that reads it: an empty/missing list makes the whole
// matching loop run zero iterations, silently, no error) was only added in
// 1.0.0-alpha05 (confirmed against CMWallet's matcher-rs source and Google's
// Maven group-index — alpha02 first introduced the OpenID4VP 1.0 registry
// API at all). Without this force, any supported_protocols we send in the
// registered JSON is inert against an alpha01-vintage matcher/registry pair.
//
// registry-digitalcredentials-preview never published past 1.0.0-alpha01 —
// left unforced (unforced == whatever alpha01 transitively resolves, which
// is correct, since there is no newer version to force it to).
//
// NOTE (C.7.3b, 2026-08-21): confirmed via extensive on-device testing that
// this fix is necessary but NOT sufficient — cdpi-wallet still does not
// appear in Chrome's Digital Credentials picker even with this forced and a
// registration path using the official MdocEntry/OpenId4VpRegistry classes
// (bypassing the npm package's manual JSON encoding entirely, byte-for-byte
// matching CMWallet's own known-working registration code). The remaining
// gap is unconfirmed — see docs/superpowers/plans/2026-08-20-mdl-tramo-c-status-and-next-steps.md
// for the full investigation log before spending more time here.
module.exports = function withCredentialsRegistryVersion(config) {
  return withAppBuildGradle(config, (config) => {
    const marker = 'androidx.credentials.registry:registry-provider:1.0.0-alpha05';
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents = config.modResults.contents.replace(
        /resolutionStrategy\s*\{/,
        'resolutionStrategy {\n' +
          '        force "androidx.credentials.registry:registry-provider:1.0.0-alpha05"\n' +
          '        force "androidx.credentials.registry:registry-provider-play-services:1.0.0-alpha05"\n' +
          '        force "androidx.credentials.registry:registry-digitalcredentials-mdoc:1.0.0-alpha05"\n'
      );
    }
    return config;
  });
};
