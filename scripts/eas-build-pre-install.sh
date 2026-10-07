#!/bin/bash
set +e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ABI_DIR="$SCRIPT_DIR/../modules/rayneo/ios/ABI"
BUILD_DIR="$ABI_DIR/build"
mkdir -p "$BUILD_DIR/RayneoNet.swiftmodule"
SDK_PATH=$(xcrun --sdk iphoneos --show-sdk-path 2>/dev/null)
if [ -z "$SDK_PATH" ]; then
    echo "iphoneos SDK not found, skipping swiftmodule"
    exit 0
fi
xcrun swiftc -emit-module -parse-as-library -module-name RayneoNet -target arm64-apple-ios16.0 -sdk "$SDK_PATH" "$ABI_DIR/RayneoNet.swift" -emit-module-path "$BUILD_DIR/RayneoNet.swiftmodule/arm64-apple-ios.swiftmodule" 2>&1
echo "RayneoNet.swiftmodule emitted"
exit 0
