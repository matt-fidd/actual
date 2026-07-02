#!/bin/sh
# Builds rollup's native bindings for the current host and installs them as
# rollup.sunos-x64.node next to this script, where the @rollup/rollup-sunos-x64
# portal package (see the repo root package.json) exposes them to rollup's
# patched native.js. Must be run on the sunos host itself, after yarn install.
# The binding is version-locked to rollup: re-run this after rollup upgrades.
set -eu

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../.."

if [ "$(node -p 'process.platform')" != "sunos" ]; then
	echo "error: this script must run on the sunos host" >&2
	exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
	echo "error: cargo not found; install Rust first (e.g. rustup, or pkgin/pkg install rust)" >&2
	exit 1
fi

VERSION="$(node -p "require('$ROOT/node_modules/rollup/package.json').version")"
BUILD_DIR="${TMPDIR:-/tmp}/rollup-native-build-$VERSION"

if [ ! -d "$BUILD_DIR" ]; then
	git clone --depth 1 --branch "v$VERSION" https://github.com/rollup/rollup "$BUILD_DIR"
fi

cd "$BUILD_DIR/rust/bindings_napi"
cargo build --release

cp "$BUILD_DIR/rust/target/release/libbindings_napi.so" "$DIR/rollup.sunos-x64.node"

node -e "
const binding = require('$DIR/rollup.sunos-x64.node');
const ast = binding.parse('const answer = 42;', false, false);
if (!Buffer.isBuffer(ast) || ast.length === 0) throw new Error('parse smoke test failed');
if (binding.xxhashBase16(Buffer.from('rollup')).length === 0) throw new Error('xxhash smoke test failed');
console.log('OK: rollup.sunos-x64.node built and working for rollup $VERSION');
"
