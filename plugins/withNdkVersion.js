const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

// Pins the Android NDK to exactly 27.1.12297006 — react-native 0.81.5's own
// default (react-native/ReactAndroid's libs.versions.toml), not an older or
// newer one this machine happened to resolve instead.
//
// expo-build-properties has no ndkVersion option (checked its shipped .d.ts —
// only minSdkVersion/compileSdkVersion/reactNativeArchitectures etc. exist),
// so this can't be a config-plugin option and has to write gradle.properties
// directly, the same way withCleartextTraffic.js edits the manifest directly
// for a setting expo-build-properties also doesn't expose.
//
// Two conflicting build failures led here, both traced to exact cause, not
// guessed:
//
// 1. Unpinned (whatever NDK Gradle happened to resolve): every autolinked C++
//    codegen library linked without ever passing libc++_shared.so to the
//    linker — "undefined symbol: __cxa_throw" and every other C++ runtime
//    symbol. Confirmed pre-existing, not a regression from this session's
//    other changes (reproduced identically against an unmodified `git stash`
//    of the whole repo before any of these edits).
// 2. Pinned to 26.1.10909125 (an older NDK, tried first as the documented fix
//    for facebook/react-native#54886 — RN 0.81-0.83 ship a libc++_shared.so
//    prebuilt against r27's ABI): fixed the linker error, but broke
//    *compilation* instead — react-native/ReactCommon/.../graphicsConversions.h
//    uses std::format (C++20), and NDK 26's libc++ <format> support is
//    incomplete relative to NDK 27's. So RN 0.81.5 needs r27 on both sides:
//    the prebuilt libc++_shared.so AND the compiler's std::format support.
//
// The real bug was never the NDK version — react-native's own default (27)
// was correct all along. It's that libc++_shared wasn't being linked in at
// all under this machine's default resolution. Pinning explicitly (rather
// than leaving it to whatever Gradle resolves, which is what produced
// failure #1) is the fix — matches RN's own declared default exactly.
// CMake pin, alongside the NDK pin above — same investigation.
//
// With the NDK correctly pinned to 27.1.12297006 (above), the build still
// failed the *link* step of every autolinked C++ codegen library
// (safeareacontext, rnsvg, rnscreens, ...) with dozens of "undefined symbol"
// errors for plain libc++ runtime symbols (std::string dtor, operator
// new/delete, __cxa_* exception ABI, typeinfo/vtable for standard exception
// types). Traced to the actual clang++ link command line CMake generates
// (visible with --max-workers=1 in the Gradle log): it never contains
// -lc++_shared or the .so path, despite CMakeCache.txt correctly recording
// ANDROID_STL=c++_shared.
//
// Root cause, confirmed by reading the NDK's own CMake toolchain files and
// CMake's own Android platform module (not guessed):
// - ndk/27.1.12297006/build/cmake/android.toolchain.cmake defaults
//   ANDROID_USE_LEGACY_TOOLCHAIN_FILE to true "to avoid changing the
//   behavior of CMAKE_CXX_FLAGS" (see https://github.com/android/ndk/issues/1693),
//   delegating to android-legacy.toolchain.cmake. That legacy file's
//   STL-handling branch for c++_shared is empty — it relies entirely on
//   clang's Android driver auto-linking libc++_shared from the --target
//   triple, which this NDK r27 + Windows + CMake setup does not do.
// - Forcing the non-legacy toolchain (-DANDROID_USE_LEGACY_TOOLCHAIN_FILE=OFF)
//   changes compilation (now correctly passes -stdlib=libc++, confirmed in
//   the clang invocation) but *still* doesn't add -lc++_shared to the link
//   line. Traced into CMake itself: Modules/Platform/Android-Common.cmake's
//   c++_shared branch (CMAKE_ANDROID_NDK_TOOLCHAIN_UNIFIED path) only ever
//   appends `-stdlib=libc++` to CMAKE_<LANG>_FLAGS_INIT — it never appends
//   `-lc++_shared` to CMAKE_<LANG>_STANDARD_LIBRARIES the way the
//   c++_static/system branches do for their libs. It's relying on the same
//   clang auto-link behavior as the legacy path, just one level up — and
//   that auto-link isn't happening here either.
//
// Fix: force the non-legacy toolchain via -DANDROID_USE_LEGACY_TOOLCHAIN_FILE=OFF
// (better STL include dirs / feature detection in general), AND explicitly
// append -lc++_shared to both CMAKE_SHARED_LINKER_FLAGS and
// CMAKE_EXE_LINKER_FLAGS, since nothing in this toolchain stack will add it
// on its own.
//
// Two side notes from the same investigation, kept because they're real and
// each cost a full build cycle to characterize:
// - CMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF is also forced below.
//   react-native/ReactAndroid/cmake-utils/ReactNative-application.cmake
//   unconditionally enables LTO for the app target (even Debug) whenever
//   check_ipo_supported() reports true. That check happens to fail silently
//   under CMake 3.22.1 on this NDK r27 + Windows toolchain (why the LTO bug
//   was latent), but succeeds under CMake 3.31.6 (pinned below), which
//   turned LTO on and reproduced this same undefined-symbol failure under
//   LTO bitcode (`lto.tmp:(...)` frames in the linker backtrace) — a second,
//   independent trigger for an identical-looking symptom. A patch-package
//   patch on react-native (patches/react-native+0.81.5.patch) comments out
//   that check_ipo_supported() block directly, since it's an unconditional
//   `set()` in the script (no CACHE) that overrides any -D passed here.
// - CMake 3.31.6 is pinned instead of relying on whichever of 3.22.1/3.31.6
//   Gradle/AGP happened to resolve (it was silently picking 3.22.1, the
//   older one, because build.gradle never pinned a version) — kept for the
//   LTO investigation above and because it's the more correct/current one
//   already installed on this machine, not a version chosen freely.
module.exports = function withNdkVersion(config) {
  config = withGradleProperties(config, (config) => {
    const key = 'ndkVersion';
    const existing = config.modResults.find((item) => item.type === 'property' && item.key === key);
    if (existing) {
      existing.value = '27.1.12297006';
    } else {
      config.modResults.push({ type: 'property', key, value: '27.1.12297006' });
    }
    return config;
  });

  return withAppBuildGradle(config, (config) => {
    // Two different DSL classes, both spelled `cmake { }`, live at two
    // different nesting levels — mixing them up (as an earlier version of
    // this plugin did) fails at Gradle configuration time, not build time:
    //   - android.externalNativeBuild.cmake        -> CmakeOptions
    //     (path, version, buildStagingDirectory only — no `arguments`)
    //   - android.defaultConfig.externalNativeBuild.cmake -> ExternalNativeCmakeOptions
    //     (arguments/cFlags/cppFlags/abiFilters/targets — no `version`)
    // Confirmed by decompiling gradle-8.11.0.jar's DSL classes (this
    // project's pinned AGP, from @react-native/gradle-plugin's
    // libs.versions.toml) with javap, not guessed from docs/examples.
    if (!config.modResults.contents.includes('externalNativeBuild {\n        cmake {\n            version')) {
      config.modResults.contents = config.modResults.contents.replace(
        /android\s*\{/,
        'android {\n    externalNativeBuild {\n        cmake {\n            version "3.31.6"\n        }\n    }\n'
      );
    }
    if (!config.modResults.contents.includes('ANDROID_USE_LEGACY_TOOLCHAIN_FILE')) {
      config.modResults.contents = config.modResults.contents.replace(
        /defaultConfig\s*\{/,
        'defaultConfig {\n' +
          '        externalNativeBuild {\n' +
          '            cmake {\n' +
          '                arguments.addAll("-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=OFF", "-DANDROID_USE_LEGACY_TOOLCHAIN_FILE=OFF", "-DCMAKE_SHARED_LINKER_FLAGS=-lc++_shared", "-DCMAKE_EXE_LINKER_FLAGS=-lc++_shared")\n' +
          '            }\n' +
          '        }\n'
      );
    }
    return config;
  });
};
