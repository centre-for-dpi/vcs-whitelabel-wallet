const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Required for Credo-TS: resolves .cjs module format used by several Credo packages
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs'];

// Required for Credo-TS: enables package.json exports field resolution
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
