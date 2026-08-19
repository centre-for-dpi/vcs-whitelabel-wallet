const { withPodfile } = require('@expo/config-plugins');

// ---------------------------------------------------------------------------
// Why this plugin exists
// ---------------------------------------------------------------------------
// plugins/withMdocSpmOnAppTarget.js moves the two EUDI Swift packages off the
// MdocDataTransfer pod target and onto the *app* target, which is what killed
// the 15,640 duplicate symbols (see the long comment in that file). The pod
// still `import`s five SPM modules, and MdocDataTransfer.podspec puts the
// shared per-configuration products dir on its SWIFT_INCLUDE_PATHS so those
// imports can resolve.
//
// That search path is correct — run 32274046079 showed the pod's compile line
// resolving to `-I .../Build/Products/Release-iphoneos`, and three of the five
// modules importing cleanly through it. What was still missing is *ordering*:
// with the products declared only on the app target, the dependency graph had
// no edge between the pod and the SPM targets, so Xcode scheduled them
// concurrently and the pod compiled 2.1s before MdocSecurity18013 and
// WalletStorage had written their .swiftmodule.
//
// ---------------------------------------------------------------------------
// Why the obvious fix did not work
// ---------------------------------------------------------------------------
// The first attempt at this plugin (commit 2e81148) added a PBXTargetDependency
// carrying only `product_ref` to the pod target — the "Dependencies" list,
// deliberately avoiding the "Link Binary With Libraries" list so no SPM object
// could reach `libtool -static`. The hook ran and reported success:
//
//     [mdoc-spm-order] MdocDataTransfer now waits for Swift package product
//                      'MdocSecurity18013'.
//
// but run 32284697230 showed Xcode silently ignoring it. Its dependency graph
// dump lists all 22 explicit dependencies of the pod target and not one of them
// is an SPM product:
//
//     Target 'MdocDataTransfer' in project 'Pods'
//         ➜ Explicit dependency on target 'ExpoModulesCore' in project 'Pods'
//         ➜ Explicit dependency on target 'RCTRequired' in project 'Pods'
//         ... 20 more, all ordinary pod targets ...
//
// while the *app* target's entry does carry them:
//
//     Target 'CDPIWallet' in project 'CDPIWallet'
//         ➜ Explicit dependency on target 'MdocSecurity18013' in project 'MdocSecurity18013'
//         ➜ Explicit dependency on target 'WalletStorage' in project 'WalletStorage'
//
// The reason is that the XCSwiftPackageProductDependency the pod's dependency
// pointed at belongs to an XCRemoteSwiftPackageReference owned by
// CDPIWallet.xcodeproj, while the dependency itself lives in Pods.xcodeproj.
// Xcode does not resolve a package product across project boundaries, so it
// drops the edge instead of reporting an error. WalletStorage happened to land
// 12s before the pod that run purely by luck, so only MdocSecurity18013 failed.
//
// ---------------------------------------------------------------------------
// The fix
// ---------------------------------------------------------------------------
// Give Pods.xcodeproj its *own* XCRemoteSwiftPackageReference for each package
// (same URL and version requirement as the app project's) and hang the pod's
// XCSwiftPackageProductDependency off that local reference. This is the shape
// CocoaPods/CocoaPods#11214 landed on for "No such module on using swift
// package in cocoapods generated targets": package reference in
// pods_project.root_object.package_references, product in the pod target's
// package_product_dependencies.
//
// Crucially we stop there. That issue's recipe has a third step — appending a
// PBXBuildFile to the target's Frameworks build phase — and we deliberately
// skip it. That build phase is the *linking* list, and it is what fed every SPM
// object into `libtool -static` twice and produced the 15,640 duplicate
// symbols. package_product_dependencies alone gives Xcode the ordering edge and
// the module search path; the objects are still linked exactly once, into the
// app, by withMdocSpmOnAppTarget.js.
//
// Two package references to the same URL do not double-build the package:
// Xcode resolves packages workspace-wide (the log's "Prepare packages" step
// lists each repo once) and both references bind to the same resolved target.
//
// This has to run as a Podfile post_install hook rather than a withXcodeProject
// mod because Pods.xcodeproj does not exist at prebuild time — CocoaPods
// generates it during `pod install`.
// ---------------------------------------------------------------------------

const POD_TARGET = 'MdocDataTransfer';

// The pod imports five SPM modules, but only these two need declaring. The
// other three (MdocDataModel18013, SwiftCBOR, Logging) are upstream of these
// two inside SPM's own package graph, so ordering after these orders after all
// of them — run 32284697230 confirms it, with Logging/SwiftCBOR/
// MdocDataModel18013 all finishing before MdocSecurity18013 and WalletStorage.
const PACKAGES = [
  {
    name: 'eudi-lib-ios-iso18013-security',
    url: 'https://github.com/eu-digital-identity-wallet/eudi-lib-ios-iso18013-security.git',
    minimumVersion: '0.8.2',
    products: ['MdocSecurity18013'],
  },
  {
    name: 'eudi-lib-ios-wallet-storage',
    url: 'https://github.com/eu-digital-identity-wallet/eudi-lib-ios-wallet-storage.git',
    minimumVersion: '0.8.4',
    products: ['WalletStorage'],
  },
];

// The hook must run AFTER react_native_post_install, not merely inside the
// post_install block. That helper calls SPM.apply_on_post_install, whose first
// action is clean_spm_dependencies_from_target:
//
//     project.root_object.package_references.delete_if { |pkg|
//       (pkg.class == Xcodeproj::Project::Object::XCRemoteSwiftPackageReference) }
//
// It deletes *every* remote package reference in the Pods project
// unconditionally, not just ones it created. Splicing before that call would
// have the reference added and then silently deleted on the same pod install.
// Anchor on the end of the react_native_post_install(...) call instead.
const ANCHOR = /(\n(\s*)react_native_post_install\([\s\S]*?\n\2\))/;

const HOOK = `
    # >>> withMdocSpmBuildOrder (managed by plugins/withMdocSpmBuildOrder.js)
    # Declare the EUDI Swift packages on the ${POD_TARGET} pod target so Xcode
    # builds them before it. The products are also on the app target
    # (plugins/withMdocSpmOnAppTarget.js), which is where they actually get
    # linked; the declaration here is purely for ordering and module lookup.
    #
    # The package reference has to be created in Pods.xcodeproj rather than
    # reused from the app project: in run 32284697230 a PBXTargetDependency in
    # Pods.xcodeproj pointing at the app project's package product was silently
    # dropped from the dependency graph, and the pod compiled 2.1s before
    # MdocSecurity18013 finished ("no such module 'MdocSecurity18013'").
    #
    # NOTE: nothing below touches the Frameworks build phase. That is the
    # linking list, and adding to it is what fed every SPM object to
    # 'libtool -static' twice and produced the 15,640 duplicate symbols.
    # package_product_dependencies alone gives ordering without linking.
    mdoc_packages = [
${PACKAGES.map(
  (p) =>
    `      { 'url' => '${p.url}', 'version' => '${p.minimumVersion}', 'products' => ${JSON.stringify(
      p.products
    ).replace(/"/g, "'")} },`
).join('\n')}
    ]

    mdoc_pods_project = installer.pods_project
    mdoc_pod_target = mdoc_pods_project && mdoc_pods_project.targets.find { |t| t.name == '${POD_TARGET}' }

    if mdoc_pod_target.nil?
      raise "[mdoc-spm-order] Pod target '${POD_TARGET}' not found in Pods.xcodeproj. " \\
            "Without it the pod compiles before its Swift packages exist, which is the " \\
            "\\"no such module\\" failure this hook prevents."
    end

    mdoc_packages.each do |pkg|
      package_ref = mdoc_pods_project.root_object.package_references.find do |r|
        r.is_a?(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference) && r.repositoryURL == pkg['url']
      end

      if package_ref.nil?
        package_ref = mdoc_pods_project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
        package_ref.repositoryURL = pkg['url']
        package_ref.requirement = { 'kind' => 'upToNextMinorVersion', 'minimumVersion' => pkg['version'] }
        mdoc_pods_project.root_object.package_references << package_ref
        Pod::UI.puts "[mdoc-spm-order] Added package reference #{pkg['url']} to Pods.xcodeproj."
      end

      pkg['products'].each do |product_name|
        existing = mdoc_pod_target.package_product_dependencies.find { |d| d.product_name == product_name }
        next if existing

        product_ref = mdoc_pods_project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
        product_ref.package = package_ref
        product_ref.product_name = product_name
        mdoc_pod_target.package_product_dependencies << product_ref
        Pod::UI.puts "[mdoc-spm-order] ${POD_TARGET} now depends on Swift package product '#{product_name}'."
      end
    end
    # <<< withMdocSpmBuildOrder
`;

module.exports = function withMdocSpmBuildOrder(config) {
  return withPodfile(config, (cfg) => {
    const contents = cfg.modResults.contents;

    if (contents.includes('withMdocSpmBuildOrder')) {
      return cfg;
    }

    if (!ANCHOR.test(contents)) {
      throw new Error(
        'withMdocSpmBuildOrder: could not find the react_native_post_install(...) call in the ' +
          'generated Podfile. CocoaPods rejects a second post_install hook ("Specifying multiple ' +
          'post_install hooks is unsupported"), so the code must be spliced into the existing one — ' +
          'and it must land AFTER react_native_post_install, which deletes every ' +
          'XCRemoteSwiftPackageReference in the Pods project. The Expo template changed — update ' +
          'the anchor.'
      );
    }

    cfg.modResults.contents = contents.replace(ANCHOR, `$1\n${HOOK}`);
    return cfg;
  });
};
