#!/usr/bin/env bash
#
# One-time setup for running `eas build --local` for iOS on this machine.
#
# EAS's local iOS build creates an isolated temporary keychain, imports only the
# leaf distribution certificate into it, then validates the cert with
# `security find-identity -v`. That validation needs to build a trust chain
# leaf -> Apple WWDR intermediate -> Apple root. The Apple root is always in the
# System Roots, but the WWDR *intermediate* must be present in a keychain on the
# login search list, or validation fails with CSSMERR_TP_NOT_TRUSTED and the
# build aborts at "Distribution certificate ... hasn't been imported successfully".
#
# macOS often ships only the long-expired original WWDR cert (expired 2023-02),
# which cannot sign today's G3/G6-issued distribution certs. This script installs
# the current Apple WWDR intermediates (G2-G6) into the login keychain.
#
# It also checks the other prerequisites for local iOS builds:
#   - Homebrew-installed fastlane and yarn (EAS shells out to both)
#   - the iOS device platform (Xcode 26 downloads this separately from the SDK)
#
# Safe to re-run; every step is idempotent.

set -euo pipefail

LOGIN_KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

echo "==> Installing Apple WWDR intermediate certificates into the login keychain"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
for g in G2 G3 G4 G5 G6; do
  url="https://www.apple.com/certificateauthority/AppleWWDRCA${g}.cer"
  if curl -fsSL -o "${tmpdir}/AppleWWDRCA${g}.cer" "$url"; then
    # -A imports and (importantly) does not prompt; re-import of an existing cert is a no-op.
    if security import "${tmpdir}/AppleWWDRCA${g}.cer" -k "$LOGIN_KEYCHAIN" -A 2>/dev/null; then
      echo "    installed WWDR ${g}"
    else
      echo "    WWDR ${g} already present (skipped)"
    fi
  else
    echo "    WARN: could not download WWDR ${g} from $url"
  fi
done

echo "==> Checking build tooling (fastlane, yarn)"
if ! command -v fastlane >/dev/null 2>&1; then
  echo "    fastlane not found. Install it with:  brew install fastlane"
else
  echo "    fastlane: $(command -v fastlane)"
fi
if ! command -v yarn >/dev/null 2>&1; then
  echo "    yarn not found (EAS local build defaults to yarn when no lockfile is committed). Install with:  brew install yarn"
else
  echo "    yarn: $(command -v yarn)"
fi

echo "==> Checking iOS device platform"
if xcodebuild -showsdks 2>/dev/null | grep -q "iphoneos"; then
  echo "    iOS device SDK present."
  echo "    If a build still errors with 'iOS <ver> is not installed', run: xcodebuild -downloadPlatform iOS"
else
  echo "    iOS device SDK NOT found. Run: xcodebuild -downloadPlatform iOS"
fi

echo
echo "Done. You can now run a local iOS build, e.g.:"
echo '  LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx eas-cli build --platform ios --profile testflight --local --output ~/Desktop/loaded.ipa'
