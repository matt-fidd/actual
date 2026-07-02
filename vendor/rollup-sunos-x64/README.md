# @rollup/rollup-sunos-x64

Rollup 4 loads a platform-specific native binding and aborts on platforms it
doesn't publish one for, such as sunos-x64 (illumos / Solaris). This directory
makes the native (non-WASM) build work there. Three pieces cooperate:

1. `.yarn/patches/rollup-npm-*.patch` teaches rollup's `native.js` that
   `sunos`/`x64` maps to the binding package `@rollup/rollup-sunos-x64`.
2. The root `package.json` wires this directory in as that package via an
   optional `portal:` dependency. Its `os`/`cpu` fields mean it is only ever
   linked on sunos hosts; other platforms keep using the published bindings.
3. `build.sh` (run on the sunos host, after `yarn install`) compiles the
   binding from rollup's own Rust sources and drops `rollup.sunos-x64.node`
   here. The binary is gitignored.

## Building

```sh
./vendor/rollup-sunos-x64/build.sh
```

Requirements on the host: `git`, `node`, and a Rust toolchain (`rustup`, or
`pkgin install rust` on pkgsrc systems, or `pkg install developer/rust`).
Rollup pins a nightly toolchain in its `rust-toolchain.toml`; with rustup
installed that exact toolchain is fetched automatically, while a plain system
cargo ignores the pin and recent stable is expected to work too.

## Caveats

- The binding must match the installed rollup version (`native.js` and the
  binding's AST buffer format move in lockstep). `build.sh` always builds the
  version currently in `node_modules`, so re-run it after a rollup upgrade.
- Release builds use the mimalloc allocator on this platform. If mimalloc's C
  sources fail to compile on your host, remove `mimalloc-safe` from
  `rust/bindings_napi/Cargo.toml` and the `#[global_allocator]` block from
  `rust/bindings_napi/src/lib.rs` in the build directory and re-run; the
  binding then uses the system allocator.
- Only rollup itself is covered here. rolldown (Vite 8's bundler) and the oxc
  tooling still use their wasm32-wasi fallback bindings on sunos (see
  `supportedArchitectures` in `.yarnrc.yml`), and CSS minification uses
  esbuild instead of lightningcss (see the desktop-client vite config).
