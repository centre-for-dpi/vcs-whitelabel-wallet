const { withXcodeProject } = require('@expo/config-plugins');

// ---------------------------------------------------------------------------
// Why this plugin exists
// ---------------------------------------------------------------------------
// expo-mdoc-data-transfer's MdocDataTransfer.podspec declares its two Swift
// Package Manager dependencies through React Native's `spm_dependency` helper
// (node_modules/react-native/scripts/cocoapods/spm.rb):
//
//     spm_dependency(s, url: '...eudi-lib-ios-iso18013-security.git',
//                       products: ['MdocSecurity18013'])
//     spm_dependency(s, url: '...eudi-lib-ios-wallet-storage.git',
//                       products: ['WalletStorage'])
//
// That helper attaches XCSwiftPackageProductDependency objects to the *pod*
// target. The pod is a static framework (s.static_framework = true, hardcoded
// upstream), so Xcode assembles it with `libtool -static`. Reading the real CI
// log of the failing build (run 32265528175) shows exactly what goes wrong:
//
//   libtool -static ... \
//     -filelist .../MdocDataTransfer.LinkFileList \
//     .../Release-iphoneos/WalletStorage.o \
//     .../Release-iphoneos/Logging.o \
//     .../Release-iphoneos/MdocDataModel18013.o \
//     ... 23 SPM objects in total ... \
//     -o .../MdocDataTransfer.framework/MdocDataTransfer
//
// Every SPM object is handed to libtool TWICE: once because Xcode already put
// it into MdocDataTransfer.LinkFileList (it is a resolved package product of
// the target), and once again as an explicit argument. The resulting static
// archive therefore contains two full copies of the shared dependency closure
// — visible in the linker error as consecutive archive member indices offset
// by exactly 23:
//
//   duplicate symbol 'nominal type descriptor for SwiftCBOR.CBORDecoder' in:
//       .../MdocDataTransfer.framework/MdocDataTransfer[39](SwiftCBOR.o)
//       .../MdocDataTransfer.framework/MdocDataTransfer[16](SwiftCBOR.o)
//
// => ld: 15640 duplicate symbols, at the final app link.
//
// Note what this is NOT: SPM itself deduplicated correctly. Each package was
// compiled exactly once (one `Ld .../SwiftCBOR.o` line per module in the log),
// and the Pods project holds exactly two XCRemoteSwiftPackageReference objects.
// The duplication is purely an artifact of a *static* pod target absorbing SPM
// products into its own archive.
//
// ---------------------------------------------------------------------------
// The fix
// ---------------------------------------------------------------------------
// Move the SPM package references off the pod target and onto the *app* target
// (CDPIWallet), where Xcode links them natively — once — into the executable.
// The pod stops embedding them entirely, so libtool has nothing to duplicate.
//
// The pod's Swift sources still `import MdocSecurity18013` / `WalletStorage` /
// `MdocDataModel18013` / `SwiftCBOR` / `Logging`. Those imports keep resolving
// because Xcode writes every SPM-built .swiftmodule into the shared per-
// configuration build products directory, and React Native's own spm.rb already
// adds that directory to SWIFT_INCLUDE_PATHS for the pod target ("Adding
// workaround for Swift package not found issue"). Importing a module and
// linking its object code are separate concerns: the pod only needs the former,
// the app provides the latter. Undefined symbols in the pod's archive are
// resolved at app link time against the same SPM objects.
//
// Products declared below cover every module the pod's Swift files import, not
// just the two top-level ones the podspec named — MdocDataModel18013, SwiftCBOR
// and Logging arrive transitively but must be linked into the app explicitly.
// ---------------------------------------------------------------------------

const PACKAGES = [
  {
    name: 'eudi-lib-ios-iso18013-security',
    url: 'https://github.com/eu-digital-identity-wallet/eudi-lib-ios-iso18013-security.git',
    requirement: { kind: 'upToNextMinorVersion', minimumVersion: '0.8.2' },
    products: ['MdocSecurity18013'],
  },
  {
    name: 'eudi-lib-ios-wallet-storage',
    url: 'https://github.com/eu-digital-identity-wallet/eudi-lib-ios-wallet-storage.git',
    requirement: { kind: 'upToNextMinorVersion', minimumVersion: '0.8.4' },
    products: ['WalletStorage'],
  },
];

module.exports = function withMdocSpmOnAppTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults;
    const objects = proj.hash.project.objects;

    objects.XCRemoteSwiftPackageReference =
      objects.XCRemoteSwiftPackageReference || {};
    objects.XCSwiftPackageProductDependency =
      objects.XCSwiftPackageProductDependency || {};

    const firstProject = proj.getFirstProject();
    const projectUuid = firstProject.uuid;
    const projectObj = firstProject.firstProject;

    // The app target — the one that produces the .app. Pod targets live in a
    // separate Pods.xcodeproj, so everything here is scoped to the app project.
    // Select by productType rather than getFirstTarget(): that helper just
    // takes targets[0], which happens to be the app in an Expo-generated
    // project but would silently attach the packages to the wrong target if
    // another plugin ever prepends one.
    // NB: getTarget() returns { uuid, target } while getFirstTarget() returns
    // { uuid, firstTarget } — normalise the two shapes before using them.
    const appTarget = proj.getTarget('com.apple.product-type.application');
    const target = appTarget || proj.getFirstTarget();
    const targetUuid = target.uuid;
    const targetObj = appTarget ? appTarget.target : target.firstTarget;

    if (!targetObj) {
      throw new Error(
        'withMdocSpmOnAppTarget: could not find the application target in the Xcode project'
      );
    }

    projectObj.packageReferences = projectObj.packageReferences || [];
    targetObj.packageProductDependencies =
      targetObj.packageProductDependencies || [];

    for (const pkg of PACKAGES) {
      const quotedUrl = `"${pkg.url}"`;

      // Reuse an existing reference if a previous run (or another plugin)
      // already added this package, so repeated prebuilds stay idempotent.
      let pkgUuid = Object.keys(objects.XCRemoteSwiftPackageReference).find(
        (uuid) =>
          !uuid.endsWith('_comment') &&
          objects.XCRemoteSwiftPackageReference[uuid] &&
          objects.XCRemoteSwiftPackageReference[uuid].repositoryURL === quotedUrl
      );

      if (!pkgUuid) {
        pkgUuid = proj.generateUuid();
        objects.XCRemoteSwiftPackageReference[pkgUuid] = {
          isa: 'XCRemoteSwiftPackageReference',
          repositoryURL: quotedUrl,
          requirement: {
            kind: pkg.requirement.kind,
            minimumVersion: pkg.requirement.minimumVersion,
          },
        };
        objects.XCRemoteSwiftPackageReference[`${pkgUuid}_comment`] =
          `XCRemoteSwiftPackageReference "${pkg.name}"`;

        projectObj.packageReferences.push({
          value: pkgUuid,
          comment: `XCRemoteSwiftPackageReference "${pkg.name}"`,
        });
      }

      for (const product of pkg.products) {
        const already = targetObj.packageProductDependencies.some((entry) => {
          const uuid = typeof entry === 'string' ? entry : entry.value;
          const dep = objects.XCSwiftPackageProductDependency[uuid];
          return dep && dep.productName === product;
        });
        if (already) continue;

        const productUuid = proj.generateUuid();
        objects.XCSwiftPackageProductDependency[productUuid] = {
          isa: 'XCSwiftPackageProductDependency',
          package: pkgUuid,
          package_comment: `XCRemoteSwiftPackageReference "${pkg.name}"`,
          productName: product,
        };
        objects.XCSwiftPackageProductDependency[`${productUuid}_comment`] =
          product;

        targetObj.packageProductDependencies.push({
          value: productUuid,
          comment: product,
        });

        // Link the product into the app binary: a PBXBuildFile that points at
        // the product dependency, referenced from the target's frameworks phase.
        const buildFileUuid = proj.generateUuid();
        objects.PBXBuildFile[buildFileUuid] = {
          isa: 'PBXBuildFile',
          productRef: productUuid,
          productRef_comment: product,
        };
        objects.PBXBuildFile[`${buildFileUuid}_comment`] =
          `${product} in Frameworks`;

        const frameworksPhase = proj.pbxFrameworksBuildPhaseObj(targetUuid);
        frameworksPhase.files.push({
          value: buildFileUuid,
          comment: `${product} in Frameworks`,
        });
      }
    }

    return cfg;
  });
};
