#!/bin/bash
# EAS pre-install hook — emit declaration-only .swiftmodule for RayneoNet
# This MUST run on the macOS build server before Xcode compiles the Swift sources.
# It creates a .swiftmodule from the placeholder type declarations so that
# `import RayneoNet` resolves at compile time, while the real symbols come
# from the embedded binary framework at link time.

set -e

MODULE_DIR="$(dirname "$0")/../modules/rayneo/ios/ABI"
SWIFTMODULE_DIR="$(dirname "$0")/../modules/rayneo/ios/ABI/build"

mkdir -p "$SWIFTMODULE_DIR/RayneoNet.swiftmodule"

# Emit the declaration-only swiftmodule
# The placeholder types in RayneoNet.swift have the same class/protocol names
# as the real framework, but with private init / fatalError bodies.
# This gives the compiler the type metadata it needs to mangle @_silgen_name
# symbols correctly, without duplicating the real class symbols.
xcrun swiftc \
  -emit-module \
  -parse-as-library \
  -module-name RayneoNet \
  -target arm64-apple-ios16.0 \
  -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" \
  "$MODULE_DIR/RayneoNet.swift" \
  -emit-module-path "$SWIFTMODULE_DIR/RayneoNet.swiftmodule/arm64-apple-ios.swiftmodule"

echo "✅ RayneoNet.swiftmodule emitted at $SWIFTMODULE_DIR"
