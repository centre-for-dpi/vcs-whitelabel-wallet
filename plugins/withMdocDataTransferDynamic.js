const { withPodfile } = require('@expo/config-plugins');

// MdocDataTransfer.podspec hardcodes `s.static_framework = true`
// (openwallet-foundation-labs/expo-mdoc-data-transfer, ios/MdocDataTransfer.podspec)
// — unconditionally, regardless of the consuming Podfile's use_frameworks!
// setting. That's the opposite of what the pod's own two Swift Package
// Manager dependencies (eudi-lib-ios-iso18013-security's MdocSecurity18013,
// eudi-lib-ios-wallet-storage's WalletStorage) need: RN's spm_dependency
// mechanism only produces a correct, non-duplicated build under dynamic
// frameworks (facebook/react-native#44627's own author documents this in
// facebook/react-native#47344, a report that hit the exact same duplicate-
// symbol crash with these exact two EUDI libraries). Under static linking
// (this project's default — see app.json's expo-build-properties config,
// chosen because the rest of the RN pod tree does NOT tolerate dynamic
// frameworks: ReactCodegen/react-native-get-random-values/RNFS all threw
// undefined RCTRegisterModule/jsi symbols under useFrameworks: "dynamic"),
// MdocDataTransfer's two SPM package trees each pull in their own copy of
// shared transitive dependencies (swift-collections, swift-crypto,
// swift-asn1, SwiftCBOR) and both copies end up statically linked into the
// same MdocDataTransfer.framework — ~15,600 duplicate symbols at the final
// app link step.
//
// Fix: force only the MdocDataTransfer pod target to dynamic via a
// pre_install hook, mirroring the *inverse* pattern the package's own
// config plugin already uses for its ios.buildStatic option (forcing
// specific OTHER pods to static under global dynamic linking) — see
// node_modules/expo-mdoc-data-transfer/plugin/build/withIos.js's
// withIosBuildStatic. Everything else in the tree stays static.
module.exports = function withMdocDataTransferDynamic(config) {
  return withPodfile(config, (config) => {
    const marker = 'MDOC_DATA_TRANSFER_FORCE_DYNAMIC';
    if (config.modResults.contents.includes(marker)) return config;

    config.modResults.contents += `
# ${marker} — see plugins/withMdocDataTransferDynamic.js for why.
pre_install do |installer|
  installer.pod_targets.each do |pod|
    if pod.name == 'MdocDataTransfer'
      def pod.build_type;
        Pod::BuildType.dynamic_framework
      end
    end
  end
end
`;
    return config;
  });
};
