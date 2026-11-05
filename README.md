# verilog-web-runtime

A WebAssembly build of [Icarus Verilog](https://github.com/steveicarus/iverilog) (ivlpp, ivl, vvp), a JavaScript driver, and the
Web Worker files to run it in a browser, published by Cresmaia Inc. (株式会社クレスマイア).

> **Status: pre-release.** The versions are `0.1.0-pre.N`; the files of a version do not change, and the message format may change between
> versions (`docs/protocol.md`, section 7).

## What is here

| Path | What | License |
|---|---|---|
| `iverilog/` | The source tree of Icarus Verilog at upstream commit `1a23d1ffdbff2192b5d43c57711a0e9e67b7bbbc`, with the WebAssembly patch and Cresmaia's changes applied (including `build-wasm/deps/src/` with zlib 1.3.1 and bzip2 1.0.8) | GPL-2.0-or-later and the licenses named in the files (`NOTICE`) |
| `patches/` | `iverilog-wasm.patch` (the WebAssembly patch), `cresmaia-reproducible.patch` (build paths and the version string), `cresmaia-notices.patch` (the notices of change in six upstream files) | as the files they change |
| `dist/` | The built files that are distributed (`ivlpp`, `ivl`, `vvp`: `.wasm` and `.js`; the JS driver) and `SHA256SUMS` | as `iverilog/` |
| `emscripten-runtime/` | The files of the Ubuntu package `emscripten 3.1.6~dfsg-7` (the tool that built the WebAssembly files), without the pre-built libraries (`usr/share/emscripten/cache/`, about 743 MB) | as in `LICENSES/Emscripten-3.1.6-dfsg-7-debian-copyright.txt` |
| `build/` | The scripts that made the distributed WebAssembly files (`build/eta2-check-scripts/`: copies, with the paths of the machine where they ran replaced; `build/README.md`), the notes on how to repeat the build (`build/README.md`) and two check scripts | MIT |
| `records/` | The records that `NOTICE`, this file, `build/README.md` and `tools/build-site.mjs` name: the sha256 of the distributed files, of the source tree, of the tool packages and of the two builds, and the lists that the notices cite | - |
| `glue/` | The Web Worker files, the start-up Workers, the start-up notice component | MIT (`LICENSES/MIT-cresmaia-glue.txt`) |
| `demo/` | The demo page. It works without any course | MIT |
| `docs/` | The public specification of the messages (`protocol.md`), a note on the EPL wording (`notes-epl.md`) | - |
| `tools/build-site.mjs` | Makes the output directory of a release (static files), including the source | MIT |
| `tools/fill-boot-template.mjs` | Fills the placeholder of a start-up Worker template (a course's build uses it) | MIT |
| `tools/r8-notices/extract_epl10.py` | Makes `LICENSES/EPL-1.0-eclipse-epl-v10.txt` from the page of the license | MIT |
| `tools/publish-list.txt` | The list of the files that are published; `tools/build-site.mjs` makes the source tar from it | - |
| `NOTICE`, `LICENSES/`, `notices/` | Notices and license texts (the circuit diagram parts are in `NOTICE` sections 3.6 and 3.7; `LICENSES/MANIFEST-schematic.tsv` says where their texts come from). `notices/NOTICE-yosys-bundle.txt` and `LICENSES/yosys/` are the notice and the license texts of the Yosys bundle, which a release has only if it was built with `--with-yosys` | - |

The repository as a whole is **not** under one license. Each part is under the license named above; see `NOTICE`.
The WebAssembly files are GPL-2.0-or-later; the Worker files in `glue/` run in the same Worker as they, and are published here under the MIT license.

## The three points that keep a course apart from the inside of Icarus Verilog (decision W1)

1. **The runtime works without a course.** `demo/` runs a testbench with nothing but the release directory.
2. **The exchange is a public specification.** `docs/protocol.md` is the only thing a page may rely on: the messages to and from the Worker, `RUNTIME_BASE`, and the files that a release has.
3. **A course does not depend on the inside.** It does not call the functions of `iverilog-wasm.js`, does not read the `.wasm` exports or memory, and does not load GPL-licensed files as its own scripts. The demo page is the example that uses nothing else.

## Building a release directory (static output)

```
node tools/build-site.mjs --schematic-src <dir> [--with-yosys <dir>]    # needs Node.js 18+, tar and gzip; writes site-out/<VERSION>/
```

`--schematic-src` (or the environment variable `SCHEMATIC_SRC`) is the directory with the fetched archives of the circuit diagram parts (elkjs 0.12.0 and netlistsvg 1.0.2 as npm tarballs, the sources of elkjs and ELK from GitHub,
the sources jars of emf-gwt, of org.eclipse.xtext.xbase.lib 2.36.0 and of org.eclipse.xtend.lib 2.36.0 from Maven Central); the layout is in the head of `tools/build-site.mjs` and the places they come from are in `records/schematic-sources.tsv`. There is no default. The archives are not in git: the build checks their sha256
(`records/schematic-archives.sha256`), takes the two bundles out of the tarballs and checks them again (`records/schematic.sha256`). `--with-yosys` is the directory of the Yosys bundle.

It checks the sha256 of the `.wasm` and `.js` files against `records/`, copies the runtime, the Worker files, the circuit diagram parts (`elkjs/`, `netlistsvg/`), the demo, `NOTICE` and `LICENSES/`,
and makes `source/` with the complete corresponding source (`runtime-source-<version>.tar.gz`, `SHA256SUMS`, the patches, and `third-party/`: the sources of elkjs, ELK, the EMF classes and the Xtext library (org.eclipse.xtext.xbase.lib) classes inside elkjs) and index pages.
The output is static. Nothing is uploaded.

## Reproducing the build

The distributed `.wasm` files are the first of two builds that were made in Docker containers
without a network, in two different directories (`/work` and `/build/a/b/c/d`), and gave the same sha256 (ivlpp.wasm 1ed0161b466557809c1619d61c898b48f27e2ca3699136de3006e7022e9a73ef, ivl.wasm fb17b84aa40f5921179bedc9694487de5591d8ffaca57aac8ff1acd63d7c2de3, vvp.wasm b1cf0232e143b21ea1ea1ab0c3d39e3e04888eb7668140be1d058e55d854aabb; `records/dist-wasm.sha256`). The procedure and what was not done again
are in `build/README.md`. Short version: the container installs the `.deb` packages listed in `records/debs-a.sha256`, extracts the source, and runs `wasm/build.sh`
with no arguments.

## The notices and the build

The six upstream files that the WebAssembly patch changed carry a notice of change at their top (GPL-2.0 section 2(a)). The notice is a comment and a line `#line 1`
that restores the line numbers of the rest of the file, so that `__LINE__` and assert messages in the compiled code do not change.
**The distributed `.wasm` files were built from the tree without these notices; a rebuild from the tree with them gave the same files.** The tree as built is recorded in `records/set2-tree.sha256`; the tree in `iverilog/` is that tree plus
`patches/cresmaia-notices.patch` (`records/tree.sha256`). That the compiled result does not change was checked only by comparing the output of the C preprocessor of the six files
(`build/check-notices-neutral.sh`), and by rebuilds: the tree with the notices was built again under the conditions of the recorded builds (Docker, no network, the same packages; `build/stage2a-rebuild/run.sh`), in `/work` and in `/build/a/b/c/d`, and once more in `/work` after the date in the notices was changed to its present wording; each time the three `.wasm` files had the sha256 of `records/dist-wasm.sha256` (for the tree in `iverilog/`: `records/stage2a-rebuild/A1-date/wasm.sha256`).
