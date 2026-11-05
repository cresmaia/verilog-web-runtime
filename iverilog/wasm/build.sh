#!/usr/bin/env bash
#
# Modified by Cresmaia Inc. (株式会社クレスマイア) on 2026-10-18, as required by GPLv2 section 2(a):
#   added -ffile-prefix-map to EMCC_CFLAGS (see the "Cresmaia" block below) so that the .wasm output
#   does not depend on the paths of the source tree and the build directory.
#   The change is also recorded in cresmaia-reproducible.patch.
#
# Build Icarus Verilog's three programs (ivlpp, ivl, vvp) to WebAssembly.
#
#   source /path/to/emsdk/emsdk_env.sh      # or any emcc on PATH
#   wasm/build.sh [build-dir]
#
# Output: <build-dir>/dist/{ivlpp,ivl,vvp}.{js,wasm} plus the JS driver.
# With NODE_CLI=1 it also builds <build-dir>/node-cli/, a set of
# NODERAWFS builds with iverilog-style wrapper scripts, used to run the
# ivtest regression suite against the WebAssembly binaries.
#
# How the port works (see wasm/README.md):
#  - configure cross-compiles for wasm32-unknown-emscripten; the host C
#    compiler (CC_FOR_BUILD) builds the draw_tt helper that makes tables.cc.
#  - There is no dlopen() in the browser, so tgt-vvp is linked into ivl and
#    the VPI modules into vvp (and into ivl, which runs their startup
#    routines to learn system function return types). ivl_dlfcn.h looks
#    names up in a static table (wasm/static_modules_*.c) instead.
#  - There are no child processes either, so the iverilog driver is
#    replaced by wasm/iverilog-wasm.js, which runs ivlpp -> ivl -> vvp.
#
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BUILD=$(mkdir -p "${1:-$SRC/build-wasm}" && cd "${1:-$SRC/build-wasm}" && pwd)
DIST="$BUILD/dist"
JOBS=${JOBS:-$(nproc 2>/dev/null || echo 2)}
OPT=${OPT:--O2}
MK="$SRC/wasm/vpi-static.mk"

command -v emcc >/dev/null || { echo "emcc not found: source emsdk_env.sh first" >&2; exit 1; }
EMVER=$(emcc -dumpversion)
echo "== emcc $EMVER, source $SRC, build $BUILD"

# --- Cresmaia Inc. (株式会社クレスマイア), 2026-10-18: reproducible paths (GPLv2 section 2(a): changed file) ---
# Replace the path of the source tree (and of the build directory, when it is outside the source tree) with
# fixed short paths in everything the compiler embeds (__FILE__ and debug info). Emscripten's emcc.py appends
# EMCC_CFLAGS to the arguments of every emcc/em++ call (zlib, bzip2, configure, make, static module tables, link).
export EMCC_CFLAGS="${EMCC_CFLAGS:+$EMCC_CFLAGS }-ffile-prefix-map=$SRC=/src/iverilog"
case "$BUILD/" in "$SRC"/*) ;; *) export EMCC_CFLAGS="$EMCC_CFLAGS -ffile-prefix-map=$BUILD=/build/iverilog" ;; esac
# --- end of Cresmaia change ---

# Emscripten renamed TOTAL_STACK to STACK_SIZE in 3.1.25.
ver_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }
if ver_ge "$EMVER" 3.1.25; then STACK=STACK_SIZE; else STACK=TOTAL_STACK; fi

# 0. zlib and bzip2, for the FST/LXT2/LXT waveform writers (VCD needs neither).
#    Built from source so that it works the same with any Emscripten version.
#    WITH_ZLIB=0 skips this.
DEPS="$BUILD/deps"
CONF_DEPS=()
LINK_DEPS=""
if [ "${WITH_ZLIB:-1}" = 1 ]; then
    if [ ! -f "$DEPS/lib/libz.a" ] || [ ! -f "$DEPS/lib/libbz2.a" ]; then
        echo "== building zlib and bzip2"
        mkdir -p "$DEPS/src" "$DEPS/include" "$DEPS/lib"
        [ -d "$DEPS/src/zlib" ] || git clone -q --depth 1 --branch v1.3.1 \
            https://github.com/madler/zlib.git "$DEPS/src/zlib"
        [ -d "$DEPS/src/bzip2" ] || git clone -q --depth 1 --branch bzip2-1.0.8 \
            https://github.com/libarchive/bzip2.git "$DEPS/src/bzip2"
        (cd "$DEPS/src/zlib" &&
         for f in adler32 compress crc32 deflate gzclose gzlib gzread gzwrite \
                  infback inffast inflate inftrees trees uncompr zutil; do
             emcc $OPT -DHAVE_UNISTD_H -DHAVE_STDARG_H -c $f.c -o $f.o; done &&
         emar rcs "$DEPS/lib/libz.a" *.o && cp zlib.h zconf.h "$DEPS/include/")
        (cd "$DEPS/src/bzip2" &&
         for f in blocksort huffman crctable randtable compress decompress bzlib; do
             emcc $OPT -c $f.c -o $f.o; done &&
         emar rcs "$DEPS/lib/libbz2.a" *.o && cp bzlib.h "$DEPS/include/")
    fi
    CONF_DEPS=(CPPFLAGS="-I$DEPS/include" LDFLAGS="-L$DEPS/lib")
    LINK_DEPS="-L$DEPS/lib -lz -lbz2"
fi

# 1. configure
if [ ! -x "$SRC/configure" ]; then (cd "$SRC" && sh autoconf.sh); fi
cd "$BUILD"
if [ ! -f Makefile ]; then
    emconfigure "$SRC/configure" \
        --host=wasm32-unknown-emscripten --build="$(sh "$SRC/config.guess")" \
        CC_FOR_BUILD="${CC_FOR_BUILD:-cc}" CFLAGS="$OPT" CXXFLAGS="$OPT" ${CONF_DEPS[@]+"${CONF_DEPS[@]}"} \
        > configure.log 2>&1 || { tail -30 configure.log; exit 1; }
fi
grep -q "gzwrite in -lz... yes" configure.log && echo "== zlib found: FST/LXT2 enabled" || true

# print the value of a make variable in directory $1
mkvar() { make -s -C "$1" -f Makefile -f "$MK" "print-$2"; }
prefixed() { local d=$1; shift; for o in "$@"; do printf '%s/%s ' "$d" "$o"; done; }

# 2. compile objects (only objects: the Makefiles' own link steps assume dlopen)
echo "== compiling (make -j$JOBS)"
emmake make -j"$JOBS" version_tag.h $(mkvar . O) > make.log 2>&1 || { tail -30 make.log; exit 1; }
for d in ivlpp tgt-vvp vvp; do
    emmake make -C $d -j"$JOBS" $(mkvar $d O) $( [ $d = vvp ] && mkvar vvp VVP_OBJ ) \
        >> make.log 2>&1 || { tail -30 make.log; exit 1; }
done
VPI_SETS="O OPP V2005 VA_MATH V2009 VHDL_SYS VHDL_TEXTIO"
uniq_words() { tr ' ' '\n' | awk 'NF && !seen[$0]++' | tr '\n' ' '; }
VPI_IVL=$(for v in $VPI_SETS; do mkvar vpi $v; done | uniq_words)
VPI_VVP=$(for v in $VPI_SETS VPI_DEBUG; do mkvar vpi $v; done | uniq_words)
emmake make -C vpi -f Makefile -f "$MK" -j"$JOBS" $VPI_VVP >> make.log 2>&1 \
    || { tail -30 make.log; exit 1; }

# 3. static module tables, and (for old Emscripten only) a main() export shim
mkdir -p "$DIST" obj-wasm
emcc $OPT -I. -I"$SRC" -DHAVE_CONFIG_H -c "$SRC/wasm/static_modules_ivl.c" -o obj-wasm/static_modules_ivl.o
emcc $OPT -I. -I"$SRC" -DHAVE_CONFIG_H -c "$SRC/wasm/static_modules_vvp.c" -o obj-wasm/static_modules_vvp.o
emcc $OPT -c "$SRC/wasm/dup_offset.c" -o obj-wasm/dup_offset.o      # see the file

# LLVM names main(argc, argv) "__main_argc_argv"; Emscripten releases that
# predate this (e.g. Debian/Ubuntu's 3.1.6 with LLVM 15) then find no main.
SHIM=""
printf 'int main(int c, char**v){(void)v; return c;}\n' > obj-wasm/probe.c
emcc obj-wasm/probe.c -o obj-wasm/probe.js 2>/dev/null
if ! grep -q '__main_argc_argv' obj-wasm/probe.js && ! node -e \
     "process.exit(WebAssembly.Module.exports(new WebAssembly.Module(require('fs').readFileSync('obj-wasm/probe.wasm'))).some(e=>e.name==='main')?0:1)"; then
    echo "== old Emscripten: adding main() export shim"
    emcc $OPT -c "$SRC/wasm/main_export_shim.c" -o obj-wasm/main_export_shim.o
    SHIM=obj-wasm/main_export_shim.o
fi

IVL_OBJS="$(mkvar . O) $(prefixed tgt-vvp $(mkvar tgt-vvp O)) $(prefixed vpi $VPI_IVL) obj-wasm/static_modules_ivl.o $SHIM $LINK_DEPS"
VVP_OBJS="$(prefixed vvp $(mkvar vvp VVP_OBJ)) $(prefixed vpi $VPI_VVP) obj-wasm/static_modules_vvp.o obj-wasm/dup_offset.o $SHIM $LINK_DEPS"
IVLPP_OBJS="$(prefixed ivlpp $(mkvar ivlpp O)) $SHIM"

COMMON="$OPT -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -s$STACK=8388608 -sEXIT_RUNTIME=1"

# 4. link: browser/Node modules (factory functions createIvlpp/createIvl/createVvp)
LIB="$COMMON -sMODULARIZE=1 -sINVOKE_RUN=0 -sFORCE_FILESYSTEM=1 -sENVIRONMENT=web,worker,node"
LIB="$LIB -sEXPORTED_RUNTIME_METHODS=[FS,callMain]"
# As a library in Node, do not install process-wide exit/rejection handlers
# (settings that older Emscripten versions default to on).
if emcc obj-wasm/probe.c -sNODEJS_CATCH_EXIT=0 -sNODEJS_CATCH_REJECTION=0 -o obj-wasm/probe2.js 2>/dev/null; then
    LIB="$LIB -sNODEJS_CATCH_EXIT=0 -sNODEJS_CATCH_REJECTION=0"
fi
echo "== linking dist/"
emcc $LIB -sEXPORT_NAME=createIvlpp -o "$DIST/ivlpp.js" $IVLPP_OBJS
em++ $LIB -sEXPORT_NAME=createIvl   -o "$DIST/ivl.js"   $IVL_OBJS
em++ $LIB -sEXPORT_NAME=createVvp   -o "$DIST/vvp.js"   $VVP_OBJS
cp "$SRC/wasm/iverilog-wasm.js" "$SRC/wasm/iverilog-node.js" "$DIST/"
[ -d "$SRC/wasm/demo" ] && cp "$SRC/wasm/demo/"* "$DIST/"

# The .wasm files are GPL object code: put the corresponding source next to
# them (the upstream commit plus every local change, as one patch), so that
# publishing dist/ also publishes its source.
if git -C "$SRC" rev-parse HEAD >/dev/null 2>&1; then
    {
        echo "Icarus Verilog, https://github.com/steveicarus/iverilog"
        echo "commit $(git -C "$SRC" rev-parse HEAD), plus the changes below."
        echo "Apply with: git checkout <commit> && git apply SOURCE.patch; build with wasm/build.sh"
        echo
        git -C "$SRC" diff HEAD
        for f in $(git -C "$SRC" ls-files --others --exclude-standard -- wasm); do
            (cd "$SRC" && git diff --no-index -- /dev/null "$f") || true
        done
    } > "$DIST/SOURCE.patch"
fi

# 5. optional: command line builds on the real file system, for ivtest
if [ "${NODE_CLI:-0}" = 1 ]; then
    echo "== linking node-cli/"
    CLI="$BUILD/node-cli"; mkdir -p "$CLI/lib/ivl/include"
    RAW="$COMMON -sNODERAWFS=1 -sENVIRONMENT=node"
    emcc $RAW -o "$CLI/ivlpp.js" $IVLPP_OBJS
    em++ $RAW -o "$CLI/ivl.js"   $IVL_OBJS
    em++ $RAW -o "$CLI/vvp.js"   $VVP_OBJS
    # Old Emscripten glue tries fetch() on a file path under Node >= 18.
    NODE="node --stack-size=4000"
    ver_ge "$EMVER" 3.1.30 || NODE="$NODE --no-experimental-fetch"
    for p in ivlpp ivl; do
        printf '#!/bin/sh\nexec %s "%s/%s.js" "$@"\n' "$NODE" "$CLI" $p > "$CLI/lib/ivl/$p"
    done
    printf '#!/bin/sh\nexec %s "%s/vvp.js" "$@"\n' "$NODE" "$CLI" > "$CLI/vvp"
    make -s -C tgt-vvp vvp.conf vvp-s.conf && cp tgt-vvp/vvp.conf tgt-vvp/vvp-s.conf "$CLI/lib/ivl/"
    cp "$SRC/constants.vams" "$SRC/disciplines.vams" "$CLI/lib/ivl/include/"
    # The native driver checks that a module given with -m exists as a file;
    # the modules themselves are linked into vvp.
    for m in system vhdl_sys vhdl_textio v2005_math va_math v2009 vpi_debug; do
        : > "$CLI/lib/ivl/$m.vpi"
    done
    chmod +x "$CLI/vvp" "$CLI/lib/ivl/ivlpp" "$CLI/lib/ivl/ivl"
    echo "   use with a native driver: iverilog -B$CLI/lib/ivl ...; $CLI/vvp a.out"
fi

ls -l "$DIST"
