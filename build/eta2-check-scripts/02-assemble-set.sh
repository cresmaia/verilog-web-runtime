#!/usr/bin/env bash
# 02: 事前登録の一式を組む(この機械。コンテナ無し。外のコードは実行せず、展開と複写だけ)
# 一式(tar.gz)の中身:
#   iverilog-wasm-1a23d1ffd/   上流 1a23d1ffd の git archive + パッチ(patch -p1)
#     build-wasm/deps/src/zlib, .../bzip2   タグの git archive(build.sh が既にあれば取得を飛ばす場所)
#   emscripten-runtime/        (a) の emscripten の deb の中身(dpkg-deb -x)。実行時ライブラリのソース・許諾の文の
#                              置き場所が未確認なので、deb の中身を全部、パッケージ内の相対パスのまま入れる
# ビルドの道具・パス・git の状態など「記録に無いこと」は一式に書き足さない(事前登録 5.2 の1-4)
source "$(dirname "$0")/lib.sh"

step() {
  need_cmds git tar gzip patch dpkg-deb sha256sum find
  umask 022; export LC_ALL=C
  for r in iverilog zlib bzip2; do [ -d "$SRCDIR/$r/.git" ] || die "src/$r が無い。00 を先に"; done
  ls "$ROOT"/debs-a/archives/emscripten_*.deb >/dev/null 2>&1 || die "debs-a に emscripten の deb が無い。01 を先に"

  local W=$WORKDIR/set-build
  case "$W" in "$ROOT"/work/*) rm -rf "$W";; *) die "作業場所が想定外: $W";; esac
  mkdir -p "$W/$TREE_NAME" "$W/emscripten-runtime" "$SETDIR"

  # --- パッチ(cp で写し、sha256 を確かめる)
  cp "$PATCH_SRC" "$REC/iverilog-wasm.patch"
  local psha; psha=$(sha256sum "$REC/iverilog-wasm.patch" | cut -d' ' -f1)
  echo "パッチ sha256 = $psha"
  case "$psha" in "$PATCH_SHA_PREFIX"*) ;; *) die "パッチの sha256 が事前登録($PATCH_SHA_PREFIX…)と違う";; esac

  # --- 1. iverilog
  git -C "$SRCDIR/iverilog" archive --format=tar "$IV_COMMIT" | tar -x -C "$W/$TREE_NAME"
  # git apply は、この機械では作業木が git の中(eta2-check)なので相対位置がずれる恐れがある。patch を使う
  patch -p1 -F0 -d "$W/$TREE_NAME" --no-backup-if-mismatch --forward < "$REC/iverilog-wasm.patch"
  [ -z "$(find "$W/$TREE_NAME" \( -name '*.orig' -o -name '*.rej' \) -print -quit)" ] || die "patch の .orig/.rej が出た"
  [ -x "$W/$TREE_NAME/wasm/build.sh" ] || { echo "警告: wasm/build.sh に実行権が付かなかった(patch が mode を反映しない)。chmod +x する"; chmod +x "$W/$TREE_NAME/wasm/build.sh"; }
  cmp "$W/$TREE_NAME/wasm/build.sh" "$ORIG_TOOL/wasm/build.sh" && echo "build.sh は元の物と同一" || echo "警告: build.sh が元の物と違う"

  # --- 2. zlib / bzip2(git archive。木の build-wasm/deps/src/ の下)
  local name tag
  for pair in "zlib:$ZLIB_TAG" "bzip2:$BZIP2_TAG"; do
    name=${pair%%:*}; tag=${pair#*:}
    local dst=$W/$TREE_NAME/build-wasm/deps/src/$name
    mkdir -p "$dst"
    git -C "$SRCDIR/$name" archive --format=tar "$tag" | tar -x -C "$dst"
    # git archive は export-ignore を守り、clone(build.sh の git clone)の作業木は守らない。落ちた物を数える
    git -C "$SRCDIR/$name" ls-tree -r -z --name-only "$tag^{commit}" | tr '\0' '\n' | sort > "$W/$name.tree.txt"
    ( cd "$dst" && find . \( -type f -o -type l \) -printf '%P\n' | sort ) > "$W/$name.archive.txt"
    if diff "$W/$name.tree.txt" "$W/$name.archive.txt" > "$REC/$name-archive-vs-tree.diff"; then
      echo "$name: git archive と clone の作業木のファイルが同じ"
    else
      echo "警告: $name の git archive が clone の作業木と違う(export-ignore か)。差は records/$name-archive-vs-tree.diff"
    fi
  done
  # build.sh が実際に要るソース(build.sh 52〜62行)が在るか
  for f in adler32 compress crc32 deflate gzclose gzlib gzread gzwrite infback inffast inflate inftrees trees uncompr zutil; do
    [ -f "$W/$TREE_NAME/build-wasm/deps/src/zlib/$f.c" ] || echo "警告: zlib/$f.c が一式に無い"; done
  for f in blocksort huffman crctable randtable compress decompress bzlib; do
    [ -f "$W/$TREE_NAME/build-wasm/deps/src/bzip2/$f.c" ] || echo "警告: bzip2/$f.c が一式に無い"; done

  # --- 3. Emscripten の deb(パッケージの台本は走らせない。dpkg-deb -x はファイルを展開するだけ)
  local deb; deb=$(ls "$ROOT"/debs-a/archives/emscripten_*.deb); [ "$(echo "$deb" | wc -l)" = 1 ] || die "emscripten の deb が複数ある"
  dpkg-deb -f "$deb" Package Version Depends Architecture > "$REC/emscripten-deb-control.txt"; cat "$REC/emscripten-deb-control.txt"
  grep -q '^Version: 3\.1\.6' "$REC/emscripten-deb-control.txt" || echo "警告: emscripten の版が 3.1.6 でない(事前登録は 3.1.6)"
  dpkg-deb -c "$deb" > "$REC/emscripten-deb-contents.txt"
  dpkg-deb -x "$deb" "$W/emscripten-runtime"
  echo "deb の中の .c/.cc/.cpp/.S の数: $(find "$W/emscripten-runtime" -type f \( -name '*.c' -o -name '*.cc' -o -name '*.cpp' -o -name '*.S' \) | wc -l)"
  find "$W/emscripten-runtime" -type f \( -name 'dlmalloc.c' -o -name 'copyright' -o -name 'LICENSE*' -o -name 'COPYING*' \) | sed "s|$W/||" | sort | tee "$REC/emscripten-license-and-key-files.txt"
  [ -n "$(find "$W/emscripten-runtime/usr/share/doc" -name copyright -print -quit 2>/dev/null)" ] || echo "警告: 許諾の文(usr/share/doc/*/copyright)が deb に無い"
  echo "deb の中の作り置きライブラリ(*.a): $(find "$W/emscripten-runtime" -name '*.a' | wc -l) 個"
  find "$W/emscripten-runtime" -name '*.a' | sed "s|$W/||" | sort > "$REC/emscripten-deb-prebuilt-libs.txt"
  echo "実行時ライブラリのソースの場所(未確認の点)。deb の中で system/lib と名の付く所:"
  find "$W/emscripten-runtime" -maxdepth 6 -type d -path '*system/lib*' | sed "s|$W/||" | sort | sed -n 1,40p | tee "$REC/emscripten-system-lib-dirs.txt" || true

  # --- tar.gz(再現できる形)
  local epoch; epoch=$(git -C "$SRCDIR/iverilog" show -s --format=%ct "$IV_COMMIT")
  mk() { ( cd "$W" && tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner --format=gnu \
             -cf - "$TREE_NAME" emscripten-runtime ) | gzip -n -9 > "$1"; }
  mk "$SET_TAR"; mk "$W/second.tar.gz"
  local s1 s2; s1=$(sha256sum "$SET_TAR" | cut -d' ' -f1); s2=$(sha256sum "$W/second.tar.gz" | cut -d' ' -f1)
  echo "一式 sha256(1回目) $s1"; echo "一式 sha256(2回目) $s2"
  [ "$s1" = "$s2" ] || die "tar.gz が再現できない(同じ入力から2回作って違う)"
  echo "$s1  eta2-source-set.tar.gz" > "$REC/set.sha256"
  ls -l "$SET_TAR"
  tar -tzf "$SET_TAR" > "$REC/set-file-list.txt"
}
run_step 02-assemble-set step
