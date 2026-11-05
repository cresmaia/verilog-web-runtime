# How the distributed WebAssembly files were built

This directory holds the scripts that made the WebAssembly files in `dist/`, copied from the working directory
where the two builds were made (`build/eta2-check-scripts/`; the paths of the machine where they ran are replaced, see below), and the notes on how to repeat the build.
The first version of this repository only placed the existing files and the recorded procedure. Later on 2026-10-19 the build was run again on the source tar.gz of this repository; see `records/stage2a-rebuild/A1-date/wasm.sha256` and `stage2a-rebuild/run.sh` in this directory.
The scripts are records. In these copies the paths of the machine where they ran are replaced (`lib.sh` lines 23 and 36, `lib2.sh` line 41); the names of private places and documents of Cresmaia Inc. were also replaced in comments and in one echo line (`lib.sh` lines 22 and 27, `lib2.sh` line 27, `02-assemble-set.sh` line 33, `10-fetch-round2.sh` line 4); the value of `ORIG_PATH` (`lib2.sh` line 21) is kept, because it is the string that the build looked for in the original files. They expect files that are not in this repository (the downloaded `.deb` packages, the git clones). Do not run them as they are.

## The chain that made the distributed files

| Step | Script | What it did |
|---|---|---|
| 00 | `00-fetch-src.sh` | Cloned upstream iverilog, zlib and bzip2 (iverilog `1a23d1ffd...`, zlib tag v1.3.1 (commit `51b7f2ab...`), bzip2 tag bzip2-1.0.8 (commit `6a8690fc...`), fetched 2026-10-18) |
| 01 | `01-download-debs.sh`, `in-container/01-dl.sh` | Downloaded the tool packages (113 `.deb` files; the list and sha256: `records/debs-a.sha256`; when: 2026-10-18T00:39:34Z) in an `ubuntu:24.04` container (`ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`) |
| 02 | `02-assemble-set.sh` | Made the first source set: `git archive` of the iverilog commit + `patches/iverilog-wasm.patch` (`patch -p1`) + zlib and bzip2 into `build-wasm/deps/src/` + the files of the emscripten package. Set sha256: `f657e1afce1f3362afb508c4f9d9cd638ae7daacb574329e93cda4a30fe186e9` |
| 10 | `10-fetch-round2.sh` | Fetched the LLVM `LICENSE.TXT` files (llvmorg-15.0.7) that are in `LICENSES/` (and elkjs 0.12.0, which is not in this repository) |
| 11 | `11-assemble-set2.sh` | Made the second source set: the first set + `patches/cresmaia-reproducible.patch` (`-ffile-prefix-map` in `wasm/build.sh`, and `release_tag.h`) + `LICENSES/`. Set sha256: `1056e06edeeb12df131a79c14741722de3ff53c1ffb933acba4f3f89a4c19c86` |
| 12 | `12-line-build2.sh`, `in-container/12-line2.sh` | Built twice, in two containers without a network, with the source set extracted in `/work` and in `/build/a/b/c/d`; `wasm/build.sh` with no arguments, no `EMCC_DEBUG`. Compared the three `.wasm` files. Result PASS. The first build's files are in `dist/` |

`lib.sh` and `lib2.sh` are the common settings of the steps.

What the records say about the result:

- `records/dist-wasm.sha256`: the sha256 of the three distributed `.wasm` files (checked again when this repository was made: they match the files in `dist/`).
- The two builds gave the same three `.wasm` files and the same three `.js` files (the sha256 of `records/dist-wasm.sha256` and of `records/build1/js.sha256`), in `/work` and in `/build/a/b/c/d`.
- `records/set2-tree.sha256`: the sha256 of every file of the source tree that the builds used (7,153 files).
  `records/tree.sha256`: the same for `iverilog/` of this repository, which has the notices of `patches/cresmaia-notices.patch` in six files (see `README.md`, "The notices and the build").

## To get the tree that was built from `iverilog/`

```
cd iverilog
patch -R -p1 < ../patches/cresmaia-notices.patch      # undoes the notices (six files)
sha256sum -c ../records/set2-tree.sha256              # all lines should say OK
```

Then `wasm/build.sh` of that tree is what `in-container/12-line2.sh` ran (as `wasm/build.sh` from the root of the extracted tree).

## To repeat the build (a recipe; not run for this repository)

1. In a container made from the image `ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`, install the `.deb` packages of `records/debs-a.sha256` without a network
   (`apt-get install --no-install-recommends /debs/*.deb`). The packages are Ubuntu 24.04 packages of 2026-10-18 (downloaded 2026-10-18T00:39:34Z from http://archive.ubuntu.com/ubuntu (noble, noble-updates) and http://security.ubuntu.com/ubuntu (noble-security)). If the package archive no longer has them, the packages have to come from a snapshot of the archive; the sha256 in the list is the check.
2. Extract the tree (as built, see above) so that its directory name is `iverilog-wasm-1a23d1ffd` in a directory such as `/work`.
3. Run `wasm/build.sh` in it with no arguments and no `EMCC_DEBUG` (what `in-container/12-line2.sh` does). The output is in `build-wasm/dist/`.
4. Compare the sha256 of `ivlpp.wasm`, `ivl.wasm`, `vvp.wasm` with `records/dist-wasm.sha256`.

Known differences from the recorded builds when this recipe is used with the tree of this repository: the six notices (they do not change the
preprocessor output, `build/check-notices-neutral.sh`, and a rebuild of the tree with them gave the same three `.wasm` files, `records/stage2a-rebuild/A1-date/wasm.sha256`).

## What is not here

- The `.deb` packages, the git clones of the upstream repositories, the logs of the runs. They were in the working directory of the builds.
- The pre-built libraries of the emscripten package (`usr/share/emscripten/cache/`, 743 MB, binary). They are in the `.deb` of `records/debs-a.sha256`.
- The second round's other results (the test of 2,775 cases of the upstream test suite against the original build; the elkjs test) are in a
  decision document of Cresmaia Inc. that is not published; they are not copied here.
