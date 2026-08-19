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
// That search path works — but it is only half the problem. Run 32274046079
// proved it: the pod's compile line resolved to
//
//     -I .../Build/Products/Release-iphoneos          <- the shared root
//
// exactly as intended, and three of the five modules imported cleanly through
// it. The build still failed with one error:
//
//     .../eudi/BLETransfer/MdocGATTServer.swift:22:8:
//     error: no such module 'MdocSecurity18013'
//
// The timestamps in that run show this is a *scheduling race*, not a lookup
// failure. When each module's .swiftmodule landed in the shared products dir,
// versus when the pod started compiling at 16:22:00.174:
//
//     Logging             16:16:07.523   ready  (7m early)
//     SwiftCBOR           16:21:26.893   ready
//     MdocDataModel18013  16:21:27.108   ready
//     WalletStorage       16:22:02.293   2.1s TOO LATE
//     MdocSecurity18013   16:22:02.316   2.1s TOO LATE
//
// Only MdocSecurity18013 is named in the error because it is the earlier
// `import` line of the two; WalletStorage would have failed next.
//
// The cause is structural. Xcode derives build order from the target
// dependency graph. Because the package products are declared on the app
// target, the graph says "app depends on MdocSecurity18013" and "app depends
// on MdocDataTransfer" — but there is no edge at all between the pod and the
// SPM targets. Xcode is therefore free to schedule them concurrently, and on a
// parallel CI machine it does. The three modules that worked were not
// correctly ordered, merely lucky: they finished early enough because other
// packages depend on them, so they sit deeper in the graph.
//
// Note this is also why React Native's own spm.rb gets away with the same bare
// SWIFT_INCLUDE_PATHS workaround: there the products stay attached to the pod
// target, which gives Xcode the implicit ordering edge for free. We removed
// that attachment on purpose, so we have to restore the edge by hand.
//
// ---------------------------------------------------------------------------
// The fix
// ---------------------------------------------------------------------------
// Add a PBXTargetDependency from the pod target to each SPM product, using the
// `product_ref` attribute (xcodeproj supports it since 1.13.0, "Add support for
// productRef attribute for PBXTargetDependency", CocoaPods/Xcodeproj#715).
//
// This is deliberately NOT the same as re-adding the products to the pod's
// `package_product_dependencies`. Xcode keeps two separate lists:
//
//   * Build Phases -> Dependencies       -> PBXTargetDependency  (ORDER only)
//   * Build Phases -> Link Binary With…  -> PBXBuildFile         (LINKING)
//
// We touch only the first. The pod gains "wait for this package to finish
// building" without absorbing a single SPM object file, so nothing gets fed to
// `libtool -static` and the duplicate symbols stay gone. The objects are still
// linked exactly once, into the app, by withMdocSpmOnAppTarget.js.
//
// This has to run as a Podfile post_install hook rather than a withXcodeProject
// mod because the pod target lives in Pods.xcodeproj, which does not exist yet
// at prebuild time — CocoaPods generates it during `pod install`.
// ---------------------------------------------------------------------------

const POD_TARGET = 'MdocDataTransfer';

// The pod imports five SPM modules, but only these two need an explicit edge.
// The other three (MdocDataModel18013, SwiftCBOR, Logging) are *upstream*
// dependencies of these two inside SPM's own package graph, so ordering after
// MdocSecurity18013 and WalletStorage already orders after all of them. Run
// 32274046079 shows the graph resolving in exactly that order:
//
//     Logging             16:16:07
//     SwiftCBOR           16:21:26   } upstream of MdocSecurity18013,
//     MdocDataModel18013  16:21:27   } which links them
//     WalletStorage       16:22:02.293
//     MdocSecurity18013   16:22:02.316   <- last to finish
//
// These are also the only two products declared on the app target, so they are
// the only two we can reference: the transitive ones have no
// XCSwiftPackageProductDependency object to point a product_ref at.
const SPM_PRODUCTS = ['MdocSecurity18013', 'WalletStorage'];

const ANCHOR = 'post_install do |installer|';

const HOOK = `
    # >>> withMdocSpmBuildOrder (managed by plugins/withMdocSpmBuildOrder.js)
    # Give the ${POD_TARGET} pod target an explicit build-order dependency on
    # the Swift package products it imports. Those products are attached to the
    # app target (plugins/withMdocSpmOnAppTarget.js) to avoid duplicate symbols,
    # which leaves no edge between the pod and the packages — so Xcode schedules
    # them in parallel and the pod can compile before MdocSecurity18013 and
    # WalletStorage have written their .swiftmodule. That is the
    # "no such module 'MdocSecurity18013'" failure in run 32274046079.
    #
    # PBXTargetDependency#product_ref adds the package to the target's
    # Dependencies list only. It does NOT add it to Link Binary With Libraries,
    # so no SPM object is pulled into the pod's static archive and the 15,640
    # duplicate symbols do not come back.
    mdoc_spm_products = ${JSON.stringify(SPM_PRODUCTS)}
    mdoc_pod_target = installer.pods_project.targets.find { |t| t.name == '${POD_TARGET}' }

    if mdoc_pod_target.nil?
      Pod::UI.warn "[mdoc-spm-order] Pod target '${POD_TARGET}' not found; skipping build-order fix."
    else
      # The package references live on the *app* project, not the Pods project,
      # so resolve the product dependency objects from there.
      app_project = installer.aggregate_targets
        .map(&:user_project)
        .compact
        .uniq { |p| p.path.to_s }
        .first

      if app_project.nil?
        Pod::UI.warn "[mdoc-spm-order] Could not resolve the app project; skipping build-order fix."
      else
        app_target = app_project.targets.find { |t| t.respond_to?(:product_type) && t.product_type == 'com.apple.product-type.application' }

        if app_target.nil?
          Pod::UI.warn "[mdoc-spm-order] Could not find the application target; skipping build-order fix."
        else
          mdoc_spm_products.each do |product_name|
            product_ref = app_target.package_product_dependencies.find { |d| d.product_name == product_name }

            if product_ref.nil?
              # Both products are put on the app target by
              # plugins/withMdocSpmOnAppTarget.js, which runs during prebuild —
              # long before this hook. If one is missing, that plugin silently
              # did not apply, and continuing would rebuild the exact race this
              # fix exists to close. Fail loudly instead of shipping a build
              # that only works when the scheduler happens to cooperate.
              raise "[mdoc-spm-order] Swift package product '#{product_name}' is not declared on " \\
                    "app target '#{app_target.name}'. withMdocSpmOnAppTarget.js should have added it " \\
                    "during prebuild. Without it the ${POD_TARGET} pod can compile before the module " \\
                    "exists, which is the 'no such module' failure this hook prevents."
            end

            already = mdoc_pod_target.dependencies.any? do |d|
              d.respond_to?(:product_ref) && d.product_ref && d.product_ref.product_name == product_name
            end
            next if already

            dependency = mdoc_pod_target.project.new(Xcodeproj::Project::Object::PBXTargetDependency)
            dependency.product_ref = product_ref
            mdoc_pod_target.dependencies << dependency
            Pod::UI.puts "[mdoc-spm-order] ${POD_TARGET} now waits for Swift package product '#{product_name}'."
          end
        end
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

    if (!contents.includes(ANCHOR)) {
      throw new Error(
        `withMdocSpmBuildOrder: could not find "${ANCHOR}" in the generated Podfile. ` +
          'CocoaPods rejects a second post_install hook ("Specifying multiple post_install ' +
          'hooks is unsupported"), so the code must be spliced into the existing one. ' +
          'The Expo template changed — update the anchor.'
      );
    }

    cfg.modResults.contents = contents.replace(ANCHOR, `${ANCHOR}\n${HOOK}`);
    return cfg;
  });
};
