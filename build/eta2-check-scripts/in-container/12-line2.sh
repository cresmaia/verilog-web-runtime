# 12 のコンテナの中(bash -c の本文)。ネットワーク無し。$BASE に一式を展開して build.sh を既定のまま走らせる
# 終了コード: 90=導入 91=展開 92=ビルド 124=時間切れ
export DEBIAN_FRONTEND=noninteractive
unset EMCC_DEBUG                        # 事前登録: EMCC_DEBUG を付けない
collect() {
  local rc=$?
  set +e
  echo "== 段: 集め"
  local T="$BASE/$TREE_NAME"
  mkdir -p /out/buildlogs
  cp -a "$T"/build-wasm/*.log /out/buildlogs/ 2>/dev/null
  [ -d "$T/build-wasm/dist" ] && cp -a "$T/build-wasm/dist" /out/dist
  ( cd /out/dist 2>/dev/null && sha256sum ./*.wasm > /out/wasm.sha256 && sha256sum ./ivlpp.js ./ivl.js ./vvp.js > /out/js.sha256 )
  # 版の文字列とパスの件数(wasm・js ごと)。grep -a で数える(strings 相当)。数える物:
  #   新しい prefix・新しい版の文字列・元の版の文字列(-dirty)・元のパス・このビルドの木のパス($T)・$BASE
  : > /out/strings-counts.tsv
  printf 'file\tnew_prefix(%s)\tnew_ver(%s)\torig_ver(%s)\torig_path\tthis_tree(%s)\tbase(%s)\n' "$NEW_PREFIX" "$NEW_VERSION_TAG" "$ORIG_VERSION_TAG" "$T" "$BASE" >> /out/strings-counts.tsv
  for f in /out/dist/ivlpp.wasm /out/dist/ivl.wasm /out/dist/vvp.wasm /out/dist/ivlpp.js /out/dist/ivl.js /out/dist/vvp.js; do
    [ -f "$f" ] || continue
    c() { grep -aoF -- "$1" "$f" | wc -l; }
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(basename "$f")" "$(c "$NEW_PREFIX")" "$(c "$NEW_VERSION_TAG")" "$(c "$ORIG_VERSION_TAG")" "$(c "$ORIG_PATH")" "$(c "$T")" "$(c "$BASE")" >> /out/strings-counts.tsv
  done
  # wasm の中の、iverilog・build-wasm を含むパスの種類と件数
  cat /out/dist/*.wasm 2>/dev/null | grep -aoE '/[A-Za-z0-9_./+-]*(iverilog|build-wasm|/work|/build/)[A-Za-z0-9_./+-]*' | sort | uniq -c | sort -rn > /out/paths-in-wasm.txt
  # 元の build.sh が git の履歴を見ないこと(release_tag.h を使ったか)の記録
  grep -a 'VERSION_TAG' "$T/build-wasm/version_tag.h" > /out/version_tag-used.txt 2>/dev/null
  grep -a 'for VERSION_TAG' /out/buildlogs/make.log /out/build-stdout.log > /out/version-source-line.txt 2>/dev/null
  dpkg -l > /out/dpkg-list.txt 2>&1
  chown -R "$HOST_UID:$HOST_GID" /out
  exit $rc
}
trap collect EXIT

echo "== 段: 導入"
nproc
apt-get -o APT::Sandbox::User=root install -y --no-install-recommends /debs/*.deb || exit 90
sed -n 1p < <(emcc --version); node --version; sed -n 1p < <(gcc --version); git --version
emcc -dumpversion > /out/emcc-version.txt

echo "== 段: 展開"
mkdir -p "$BASE" && tar -xzf /set/eta2-source-set2.tar.gz -C "$BASE" || exit 91
sha256sum /set/eta2-source-set2.tar.gz > /out/set-used.sha256
cd "$BASE/$TREE_NAME" || exit 91
pwd > /out/build-path.txt
touch /tmp/marker

echo "== 段: ビルド"
# 既定のまま(引数も JOBS・OPT の上書きも無し)
set +e
timeout -k 60 4000 wasm/build.sh 2>&1 | tee /out/build-stdout.log
rc=${PIPESTATUS[0]}
set -e
if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then echo "ビルドが時間切れ(終了コード $rc)" >&2; exit 124
elif [ "$rc" -ne 0 ]; then echo "ビルドが失敗(終了コード $rc)" >&2; exit 92; fi
test -f build-wasm/dist/ivlpp.wasm -a -f build-wasm/dist/ivl.wasm -a -f build-wasm/dist/vvp.wasm || exit 92
