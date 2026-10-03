#!/usr/bin/env bash
# Builds plugin/Core and plugin/Tests as one SwiftPM test target and runs the XCTests.
# Works with any Swift 5.9+ toolchain on Linux or macOS. Uses swift-corelibs-foundation on Linux,
# so a pass here does not prove the same code behaves identically on Apple's Foundation.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/Tests/ClogicCoreTests"
for file in "$here"/Core/*.swift "$here"/Tests/*.swift; do
  ln -s "$file" "$work/Tests/ClogicCoreTests/"
done
ln -s "$here/Tests/Vectors" "$work/Tests/ClogicCoreTests/Vectors"

cat > "$work/Package.swift" <<'SWIFT'
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "ClogicCore",
    targets: [
        .testTarget(
            name: "ClogicCoreTests",
            path: "Tests/ClogicCoreTests",
            exclude: ["Vectors"],
            swiftSettings: [.unsafeFlags(["-swift-version", "5"])]
        ),
    ]
)
SWIFT

cd "$work"
swift test "$@"
