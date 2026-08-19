# iOS: mDL (expo-mdoc-data-transfer) and Swift Package linking

Status: **unresolved for device builds.** Not an Xcode-version problem, and
not fixed by upgrading the toolchain.

Two hypotheses were tested and ruled out:

- **Newer Xcode.** The workflow was pinned to 16.2; the `macos-15` runner
  also offers 16.3, 16.4 and several 26.x. Moving to **16.4 changed
  nothing**: run 32300947471 failed with 16,088 duplicate symbols (vs 15,628
  on 16.2), same mechanism — `-ObjC` present, and the pod's `libtool` still
  fed the same 23 SPM objects twice.
- **EAS Build.** The same commit *does* build cleanly on EAS
  (`600b58de-e5b3-4f04-bf04-a86e5409f7ff`, 7m21s, artifact produced). That
  looked like toolchain evidence, but the distinguishing variable was
  **simulator vs device**, not Xcode: that EAS run used the unsigned
  *simulator* profile, while this workflow links `Release-iphoneos` for a
  real device. Simulator and device links differ in architecture and in how
  `-ObjC` pulls archive members, which is exactly the documented trigger.

So the bug reproduces on device builds regardless of Xcode version, and a
passing simulator build is not evidence that it is fixed. Any future claim
that it is resolved needs a **device** build to back it up.

Everything below documents the mechanism and the seven approaches tried
against it. It remains accurate.

Last verified (failing): run 32300947471 (commit `5014783`), Xcode 16.4,
RN 0.81.5, expo-mdoc-data-transfer 0.2.0-alpha.5. Previously: run
32292108405 (`ff5340a`) on Xcode 16.2.

## Symptom

`Compilar Aplicación` fails at the final link with ~15,628 duplicate symbols.
Everything before the link is healthy: `pod install` succeeds, all five modules
the pod imports resolve (`grep -c "no such module"` = 0), and the whole
dependency tree compiles (~94k log lines).

## Root cause

Xcode adds the resolved Swift-package object files to the pod's static archive
**twice**. In the pod's `libtool` invocation:

```
libtool -static -arch_only arm64 -D -syslibroot ... \
  -L .../Release-iphoneos/MdocDataTransfer \
  -filelist .../MdocDataTransfer.LinkFileList \   <- copy 1: 23 SPM objects
  .../Release-iphoneos/WalletStorage.o \          <- copy 2: the same 23,
  .../Release-iphoneos/Logging.o \                   passed again explicitly
  ... 21 more ...
  -o .../libMdocDataTransfer.a
```

The resulting archive holds the same 23 objects at member indices 12–34 and
again at 35–57 — every reported duplicate pair has an index delta of exactly
-23.

The archive alone would be harmless; a normal link pulls only the members it
needs. The app link uses **`-ObjC`** (required by React Native so ObjC
categories load), which forces the linker to pull in *every* member of *every*
static archive. Both copies get loaded, so every symbol collides.

This is a long-standing Xcode bug, not a project misconfiguration. Apple
engineers describe the exact mechanism in
<https://forums.swift.org/t/objc-flag-causes-duplicate-symbols-with-swift-packages/27926>:

> Xcode is adding some object files to the static library twice — if you look
> at the build log when it runs `libtool`, the object file is in the file passed
> to `-filelist`, and then it's also passed again on the command line
> separately.

React Native knows about it and warns during `pod install`:

```
[SPM] WARNING!!! Pod MdocDataTransfer is using swift package(s)
MdocSecurity18013, WalletStorage with static linking, this might cause linker
errors. Consider using USE_FRAMEWORKS=dynamic
```

The referenced PR (facebook/react-native#44627) offers no workaround other than
`USE_FRAMEWORKS=dynamic`.

## Approaches tried, and why each failed

| # | Approach | Outcome |
|---|---|---|
| 1 | Patch `spm.rb` UUID collision | Correct and still applied (`patches/react-native+0.81.5.patch`); unrelated to this bug — without it `pod install` crashes outright |
| 2 | `useFrameworks: dynamic` (global) | Undefined `_RCTRegisterModule` / `facebook::jsi::*` across unrelated pods. Does not converge (firebase#8657, #8883) |
| 3 | `useFrameworks: static` (global) | The baseline; produces this duplicate-symbol failure |
| 4 | Force only this pod dynamic (`pre_install`) | CocoaPods refuses: a dynamic pod needs its whole transitive subgraph dynamic, and this pod depends on `ExpoModulesCore` → the entire RN graph |
| 5 | Move SPM to the app target | Fixed the duplicates but broke module visibility, then build ordering. Both were solvable, but the app-target copy then collided with the pod's |
| 6 | `ios.buildStatic` (pod → static library) | Eliminated the *framework* self-duplication (intra-archive collisions dropped ~7,800 → 2) but not the `-filelist`/explicit double-feed |
| 7 | Unlink SPM products from the pod's Frameworks phase | No-op: the products were never in that phase. The duplicate arrives through Xcode's generated `libtool` arguments, which no build setting controls |

## Where it stands

`app.json` keeps `ios.buildStatic: ["MdocDataTransfer"]` — it is the package's
own supported option, it strictly reduces the duplication, and it costs
nothing. The podspec is otherwise pristine upstream (`spm_dependency` intact),
which is what makes module resolution and build ordering work on their own.

## Options from here

1. **Wait for / push upstream.** The bug is Apple's. `expo-mdoc-data-transfer`
   is at `0.2.0-alpha.5`; a later release may vendor the EUDI libraries as pods
   or XCFrameworks instead of SPM, which sidesteps it entirely.
2. **Vendor the EUDI libraries as XCFrameworks** and drop the SPM dependency
   from the podspec. Most likely to work, but means owning the build of
   `MdocSecurity18013`, `WalletStorage` and their closure.
3. **Get the RN graph onto dynamic frameworks** so `USE_FRAMEWORKS=dynamic`
   becomes viable (approach 2). That is a large migration and hit real,
   independently-reported breakage.
4. **Drop `-ObjC` from the app link.** Removes the trigger, but RN relies on it
   for category loading; expect missing selectors at runtime. Not recommended
   without a full audit — and note 3,421 of the duplicates are C/ObjC-style
   symbols, so the archive genuinely does carry ObjC content.

## Reproducing the diagnosis

```bash
gh run view --job <jobId> --log > run.log
grep -c "duplicate symbol" run.log                       # ~15628
grep -c "no such module" run.log                         # 0
grep -o "libtool -static.*libMdocDataTransfer.a" run.log \
  | head -1 | tr ' ' '\n' | grep -c "Release-iphoneos/[A-Za-z_0-9]*\.o$"   # 23
```
