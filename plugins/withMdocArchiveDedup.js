const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Works around an Xcode bug that makes the iOS Release build unlinkable.
 *
 * When a pod pulls in Swift packages via React Native's `spm_dependency`
 * helper, Xcode feeds the resolved package object files to `libtool` twice —
 * once through `-filelist` and again as explicit command-line arguments. The
 * pod's static archive ends up holding the same 23 objects at two different
 * member indices (every duplicate pair is exactly 23 apart). Apple engineers
 * describe the mechanism here:
 * https://forums.swift.org/t/objc-flag-causes-duplicate-symbols-with-swift-packages/27926
 *
 * The archive on its own would be harmless — a normal link only pulls the
 * members it needs. But CocoaPods adds `-ObjC` to the app's link (so ObjC
 * categories load), and that forces the linker to pull in *every* member of
 * *every* static archive. Both copies load, and every symbol collides:
 * ~16,000 duplicate symbol errors. See docs/ios-mdl-spm-linking.md.
 *
 * This rebuilds the pod's archive with each member kept once, right after the
 * pod is compiled and before the app links. Two reasons this approach was
 * chosen over dropping `-ObjC` and force-loading the other archives instead:
 * it leaves every other target's linking untouched, and it fails at build
 * time rather than as missing selectors at runtime.
 *
 * Safe because the duplicates are byte-identical — they are literally the same
 * object files passed twice — so collapsing them loses nothing. `ar x` already
 * collapses same-named members when extracting, which is what makes this work.
 *
 * Remove this once the upstream bug is fixed (either Xcode's double-feed, or
 * expo-mdoc-data-transfer moving off SPM); the build should then link on its
 * own.
 */

const POD_NAME = 'MdocDataTransfer';

const RUBY_SNIPPET = `
  # --- ${POD_NAME} archive dedup (see plugins/withMdocArchiveDedup.js) ---
  installer.pods_project.targets.each do |target|
    next unless target.name == '${POD_NAME}'
    next if target.shell_script_build_phases.any? { |p| p.name == 'Dedup ${POD_NAME} archive members' }
    phase = target.new_shell_script_build_phase('Dedup ${POD_NAME} archive members')
    phase.shell_script = <<~'DEDUP_SH'
      set -euo pipefail
      LIB="\${CONFIGURATION_BUILD_DIR}/lib${POD_NAME}.a"
      if [ ! -f "$LIB" ]; then
        echo "note: $LIB not found; nothing to dedup."
        exit 0
      fi
      # __.SYMDEF is the archive's own symbol index, not an object file —
      # ar lists it but libtool rejects it as input ("not an object file
      # (not allowed in a library)"). libtool regenerates it for the new
      # archive, so filter it out everywhere members are counted or fed back.
      members() { xcrun ar t "$1" | grep -v '^__\.SYMDEF'; }
      TOTAL=$(members "$LIB" | wc -l | tr -d ' ')
      UNIQUE=$(members "$LIB" | sort -u | wc -l | tr -d ' ')
      if [ "$TOTAL" -eq "$UNIQUE" ]; then
        echo "note: $TOTAL members, no duplicates; leaving archive untouched."
        exit 0
      fi
      echo "note: $TOTAL members, $UNIQUE unique; rebuilding archive without duplicates."
      WORK=$(mktemp -d)
      trap 'rm -rf "$WORK"' EXIT
      cd "$WORK"
      # ar x collapses same-named members, which is exactly the dedup we want.
      xcrun ar x "$LIB"
      members "$LIB" | sort -u > members.txt
      # BSD xargs (macOS) has no -a; feed the list on stdin instead.
      xargs xcrun libtool -static -o "$LIB.dedup" < members.txt
      mv "$LIB.dedup" "$LIB"
      echo "note: archive rebuilt with $(members "$LIB" | wc -l | tr -d ' ') members."
    DEDUP_SH
  end
  # --- end ${POD_NAME} archive dedup ---
`;

module.exports = function withMdocArchiveDedup(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes(`${POD_NAME} archive dedup`)) return config;

      const postInstall = /post_install do \|installer\|/;
      if (!postInstall.test(contents)) {
        throw new Error(
          'withMdocArchiveDedup: no `post_install do |installer|` block found in the ' +
            'generated Podfile, so the dedup phase has nowhere to attach. Expo normally ' +
            'emits one; if that changed, this plugin needs updating.',
        );
      }

      contents = contents.replace(postInstall, (match) => `${match}\n${RUBY_SNIPPET}`);
      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
};
