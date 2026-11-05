/*
 * Added by Cresmaia Inc. (株式会社クレスマイア) on 2026-10-18, as required by GPLv2 section 2(a).
 * This file is new (it is not part of upstream Icarus Verilog commit 1a23d1ffd). Makefile.in uses it for VERSION_TAG
 * when the source tree has no .git directory, in place of git-describe. It fixes the version string of the
 * WebAssembly build, so that the output does not depend on whether a git history was present at build time.
 * The change is recorded in cresmaia-reproducible.patch.
 */
#define VERSION_TAG "s20260301-476-g1a23d1ffd-wasm1"
