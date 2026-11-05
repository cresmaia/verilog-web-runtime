#!/usr/bin/env bash
# 11: 2回目の一式を組む(この機械。コンテナ無し。展開・複写・diff・patch だけ。外のコードは実行しない)
# 一式(tar.gz)の中身:
#   iverilog-wasm-1a23d1ffd/        1回目の一式の木(上流 1a23d1ffd の git archive + 代表者のパッチ + zlib・bzip2)に、当社の変更を patch で重ねた物
#   iverilog-wasm.patch             代表者のパッチ(そのまま。木には適用済み)
#   cresmaia-reproducible.patch     当社の変更(wasm/build.sh と、新しい release_tag.h)。木には適用済み
#   emscripten-runtime/             1回目と同じ deb の中身(1回目の一式から、そのまま)
#   LICENSES/                       10 で取った LLVM llvmorg-15.0.7 の LICENSE.TXT 3つ
# 「1回目の一式の木(02 と同じ作り方)」は、02 を再度走らせず、1回目の tar.gz(records/set.sha256 と照らす)から取り出す。
#   02 と同じ入力から同じ物ができることは、02 が tar.gz を2回作って確かめている。中身は同じである
# 当社の変更(事前登録 12.1 A):
#   1. wasm/build.sh に -ffile-prefix-map(EMCC_CFLAGS 経由。emcc.py の 1041〜1043 行が、すべての emcc/em++ の呼び出しの
#      引数に足す。11 が一式の中の emcc.py を grep して records/emcc-cflags-lines.txt に残す)
#      clang-15 が -ffile-prefix-map を __FILE__ に効かせるかは、未確かめ(12 の strings の件数で見る)
#   2. 木の直下に release_tag.h(VERSION_TAG を s20260301-476-g1a23d1ffd-wasm1 に固定)
#   変えたファイルの先頭に、変えたこと・日付・変えたのが株式会社クレスマイアであることを書く(GPLv2 第2条 (a))
source "$(dirname "$0")/lib2.sh"

step() {
  need_cmds tar gzip patch diff sha256sum find awk grep git
  umask 022; export LC_ALL=C
  [ -s "$SET_TAR" ] || die "1回目の一式が無い"
  [ "$(sha256sum "$SET_TAR" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$REC/set.sha256")" ] || die "1回目の一式が records/set.sha256 と違う"
  [ -s "$REC/iverilog-wasm.patch" ] || die "records/iverilog-wasm.patch が無い"
  local p
  for p in "${LLVM_LICENSE_PATHS[@]}"; do [ -s "$SRC2DIR/llvm/$(echo "$p" | tr '/' '-')" ] || die "10 が取った $p が無い"; done

  local W=$WORKDIR/set2-build
  case "$W" in "$ROOT"/work/*) rm -rf "$W";; *) die "作業場所が想定外: $W";; esac
  mkdir -p "$W" "$SETDIR"

  # --- 1回目の木と Emscripten の部分を取り出す
  tar -xzf "$SET_TAR" -C "$W" --no-same-owner "$TREE_NAME2" emscripten-runtime
  cp -a "$W/$TREE_NAME2" "$W/pre"                        # 当社の変更の前の木(patch の元)

  # --- emcc.py が EMCC_CFLAGS を全部の呼び出しに足すことの確認(読むだけ)
  local emcc; emcc=$(find "$W/emscripten-runtime" -name emcc.py -path '*/usr/share/emscripten/*' | sed -n 1p)
  [ -n "$emcc" ] || die "一式の中に emcc.py が無い"
  grep -n 'EMCC_CFLAGS' "$emcc" | sed "s|$W/||" | tee "$REC/emcc-cflags-lines.txt"
  grep -q 'args += shlex.split(EMCC_CFLAGS)' "$emcc" || die "emcc.py に args += shlex.split(EMCC_CFLAGS) が無い"

  # --- 当社の変更を作る(post の木で)
  cp -a "$W/pre" "$W/post"
  local B=$W/post/wasm/build.sh
  [ "$(grep -c '^echo "== emcc \$EMVER' "$B")" = 1 ] || die "build.sh の 'echo \"== emcc \$EMVER' の行が1つでない"
  cat > "$W/build-header.txt" <<'EOT'
#
# Modified by Cresmaia Inc. (株式会社クレスマイア) on 2026-10-18, as required by GPLv2 section 2(a):
#   added -ffile-prefix-map to EMCC_CFLAGS (see the "Cresmaia" block below) so that the .wasm output
#   does not depend on the paths of the source tree and the build directory.
#   The change is also recorded in cresmaia-reproducible.patch.
EOT
  cat > "$W/build-block.txt" <<'EOT'

# --- Cresmaia Inc. (株式会社クレスマイア), 2026-10-18: reproducible paths (GPLv2 section 2(a): changed file) ---
# Replace the path of the source tree (and of the build directory, when it is outside the source tree) with
# fixed short paths in everything the compiler embeds (__FILE__ and debug info). Emscripten's emcc.py appends
# EMCC_CFLAGS to the arguments of every emcc/em++ call (zlib, bzip2, configure, make, static module tables, link).
export EMCC_CFLAGS="${EMCC_CFLAGS:+$EMCC_CFLAGS }-ffile-prefix-map=$SRC=/src/iverilog"
case "$BUILD/" in "$SRC"/*) ;; *) export EMCC_CFLAGS="$EMCC_CFLAGS -ffile-prefix-map=$BUILD=/build/iverilog" ;; esac
# --- end of Cresmaia change ---
EOT
  # 先頭(shebang の次)に見出しを、'echo "== emcc ..."' の次(EMVER を取った後)に指定を足す
  awk -v hdr="$W/build-header.txt" -v blk="$W/build-block.txt" '
    NR==1 { print; while ((getline l < hdr) > 0) print l; next }
    { print }
    /^echo "== emcc \$EMVER/ { while ((getline l < blk) > 0) print l }
  ' "$W/pre/wasm/build.sh" > "$B.new"
  mv "$B.new" "$B"; chmod 755 "$B"
  bash -n "$B" || die "変えた build.sh の文法が壊れた"
  cat > "$W/post/release_tag.h" <<EOT
/*
 * Added by Cresmaia Inc. (株式会社クレスマイア) on $CRESMAIA_DATE, as required by GPLv2 section 2(a).
 * This file is new (it is not part of upstream Icarus Verilog commit 1a23d1ffd). Makefile.in uses it for VERSION_TAG
 * when the source tree has no .git directory, in place of git-describe. It fixes the version string of the
 * WebAssembly build, so that the output does not depend on whether a git history was present at build time.
 * The change is recorded in cresmaia-reproducible.patch.
 */
#define VERSION_TAG "$NEW_VERSION_TAG"
EOT

  # --- パッチにする(diff -u。ラベルで時刻を消す。新しいファイルは /dev/null から)
  local P=$W/cresmaia-reproducible.patch
  {
    diff -u --label a/wasm/build.sh --label b/wasm/build.sh "$W/pre/wasm/build.sh" "$W/post/wasm/build.sh" || [ $? -eq 1 ]
    diff -u --label /dev/null --label b/release_tag.h /dev/null "$W/post/release_tag.h" || [ $? -eq 1 ]
  } > "$P"
  [ -s "$P" ] || die "パッチが空"
  echo "cresmaia-reproducible.patch sha256 = $(sha256sum "$P" | cut -d' ' -f1)"
  # 一式の木は、pre にこのパッチを当てて作る(パッチと木が食い違わないことの確認も兼ねる)
  cp -a "$W/pre" "$W/$TREE_NAME2.new"
  patch -p1 -F0 -d "$W/$TREE_NAME2.new" --no-backup-if-mismatch --forward < "$P"
  [ -z "$(find "$W/$TREE_NAME2.new" \( -name '*.orig' -o -name '*.rej' \) -print -quit)" ] || die "patch の .orig/.rej が出た"
  diff -r "$W/$TREE_NAME2.new" "$W/post" || die "パッチを当てた木と、変更を作った木が違う"
  [ -x "$W/$TREE_NAME2.new/wasm/build.sh" ] || chmod +x "$W/$TREE_NAME2.new/wasm/build.sh"
  rm -rf "$W/$TREE_NAME2"; mv "$W/$TREE_NAME2.new" "$W/$TREE_NAME2"
  cp "$P" "$REC/cresmaia-reproducible.patch"

  # --- 一式のそのほかの物
  cp "$REC/iverilog-wasm.patch" "$W/iverilog-wasm.patch"
  mkdir -p "$W/LICENSES"
  for p in "${LLVM_LICENSE_PATHS[@]}"; do
    cp "$SRC2DIR/llvm/$(echo "$p" | tr '/' '-')" "$W/LICENSES/$LLVM_TAG-$(echo "$p" | tr '/' '-')"
  done
  # 木の変更は、当社の2ファイルだけであること(1回目の木との差)
  { diff -rq "$W/pre" "$W/$TREE_NAME2" || true; } | sed "s|$W/||g" | tee "$REC/set2-tree-diff-vs-set1.txt"
  [ "$(wc -l < "$REC/set2-tree-diff-vs-set1.txt")" = 2 ] || die "1回目の木との差が2ファイルでない"

  # --- tar.gz(再現できる形。1回目と同じ指定)
  local epoch; epoch=$(git -C "$SRCDIR/iverilog" show -s --format=%ct "$IV_COMMIT")
  mk() { ( cd "$W" && tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner --format=gnu \
             -cf - "$TREE_NAME2" emscripten-runtime LICENSES iverilog-wasm.patch cresmaia-reproducible.patch ) | gzip -n -9 > "$1"; }
  mk "$SET2_TAR"; mk "$W/second.tar.gz"
  local s1 s2; s1=$(sha256sum "$SET2_TAR" | cut -d' ' -f1); s2=$(sha256sum "$W/second.tar.gz" | cut -d' ' -f1)
  echo "2回目の一式 sha256(1回目の作成) $s1"; echo "2回目の一式 sha256(2回目の作成) $s2"
  [ "$s1" = "$s2" ] || die "tar.gz が再現できない"
  echo "$s1  eta2-source-set2.tar.gz" > "$REC/set2.sha256"
  tar -tzf "$SET2_TAR" > "$REC/set2-file-list.txt"
  ls -l "$SET2_TAR"
}
run_step 11-assemble-set2 step
