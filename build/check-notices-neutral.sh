#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Cresmaia Inc. See LICENSES/MIT-cresmaia-glue.txt.
#
# Checks that the notices of patches/cresmaia-notices.patch do not change the C preprocessor output of the six files
# (so that __LINE__ and assert messages in the compiled code are the same). This is a proxy of "the build output does not change":
# it does not build the WebAssembly files.
#
# Run it in a container without a network, with the two trees mounted read-only:
#   <before> = the tree as built (iverilog/ with `patch -R -p1 < patches/cresmaia-notices.patch`; check records/set2-tree.sha256)
#   <after>  = iverilog/
#   docker run --rm --network none --cap-drop=ALL -v <dir-with-before-and-after>:/w:ro node:22-bookworm bash /w/check.sh
# where <dir-with-before-and-after> holds the directories "before" and "after" and a copy of this script as "check.sh".
# It uses native gcc/g++ with empty stand-ins for the generated headers (config.h, vpi_config.h) and the defines
# IVL_STATIC_MODULES and __EMSCRIPTEN__. It is not the Emscripten compiler.
set -u
cd /w
mkdir -p /stub && : > /stub/config.h && : > /stub/vpi_config.h
sed -e 's/@[A-Za-z_]*@/int/g' before/_pli_types.h.in > /stub/_pli_types.h 2>/dev/null || true
fail=0
for f in ivl_dlfcn.h vpi/fstapi.c vpi/sys_lxt.c vpi/sys_lxt2.c vpi/vcd_priv2.cc vvp/vpi_modules.cc; do
  case $f in *.c) L=c; STD=;; *) L=c++; STD=-std=gnu++17;; esac
  bad=0
  for side in before after; do
    ( cd $side && g++ -x $L $STD -E -P -I/stub -I. -Ivpi -Ivvp -DIVL_STATIC_MODULES=1 -D__EMSCRIPTEN__ $f >/tmp/raw.$side 2>/tmp/err.$side ); rc=$?
    grep -v '^\s*$' /tmp/raw.$side > /tmp/pp.$side || true
    # the compiler has to exit with 0 and must not report an error; a stop half way is a failure, not a pass
    if [ "$rc" -ne 0 ] || grep -qiE 'error|fatal' /tmp/err.$side; then
      echo "COMPILER-FAILED $f ($side) rc=$rc: $(grep -iE 'error|fatal' /tmp/err.$side | head -2 | tr '\n' ' ')"; bad=1
    fi
  done
  nb=$(wc -l < /tmp/pp.before); na=$(wc -l < /tmp/pp.after)
  if [ "$bad" -ne 0 ]; then fail=1
  elif [ "$nb" -gt 0 ] && cmp -s /tmp/pp.before /tmp/pp.after; then echo "SAME $f lines=$nb (compiler rc=0, no error in stderr; warnings: $(grep -ci warning /tmp/err.before) / $(grep -ci warning /tmp/err.after))"
  else echo "DIFFERENT-OR-EMPTY $f before=$nb after=$na"; fail=1; fi
done
# a check of the principle: #line 1 restores the numbering
printf '/* a\n * b\n */\n#line 1\nint x = __LINE__;\nint y = __LINE__;\n' > /tmp/t.c
got=$(gcc -E -P /tmp/t.c | grep -v '^\s*$' | tr '\n' ' ')
echo "principle: $got"
[ "$got" = 'int x = 1; int y = 2; ' ] || { echo 'PRINCIPLE-CHECK-FAILED'; fail=1; }
exit $fail
