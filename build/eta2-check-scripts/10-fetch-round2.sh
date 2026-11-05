#!/usr/bin/env bash
# 10: 2回目の物の取得(この機械。ネットワークあり。コンテナ無し)
#  - elkjs@0.12.0 の npm の tarball: レジストリの dist.integrity(sha512)と照らし、sha256 を記録する
#    (考え方は元の作業の置き場の tools/lib/fetch-npm-tarball.sh。読むだけで、使わない)
#    限界: 期待する integrity もレジストリ自身が出す物で、事前に固定した値ではない。取得物が配信経路で壊れていないことの確認であり、
#    レジストリが差し替えられていないことの確認ではない。sha256 は、後の照合のために記録する
#  - LLVM llvmorg-15.0.7 の libcxx・libcxxabi・compiler-rt の LICENSE.TXT: raw.githubusercontent.com から取り、sha256 を記録する
#  - 取った物は実行しない。tarball の展開は tar で、専用のディレクトリ(work/elkjs-0.12.0/)にだけ行う
source "$(dirname "$0")/lib2.sh"

CURL=(curl -fsS --proto '=https' --tlsv1.2 -L --max-time 300 --retry 2)

step() {
  need_cmds curl sha256sum tar python3 grep
  umask 022
  mkdir -p "$SRC2DIR/llvm" "$SRC2DIR/npm" "$RESULTS"
  local rec=$REC/round2-fetch.txt
  { echo "取得日時(UTC): $(date -u +%FT%TZ)"; } > "$rec"

  # --- elkjs
  local meta=$SRC2DIR/npm/$ELK_NAME-$ELK_VER.registry.json
  "${CURL[@]}" -o "$meta" "https://registry.npmjs.org/$ELK_NAME/$ELK_VER"
  # レジストリの JSON は、python -I で読むだけ(中のコードは無い。値を取り出す)
  local integrity tarball shasum license
  integrity=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["dist"]["integrity"])' "$meta")
  tarball=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["dist"]["tarball"])' "$meta")
  shasum=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["dist"]["shasum"])' "$meta")
  license=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1])).get("license"))' "$meta")
  echo "レジストリ: integrity=$integrity shasum(sha1)=$shasum license=$license tarball=$tarball"
  case "$integrity" in sha512-*) ;; *) die "integrity が sha512 でない: $integrity";; esac
  case "$tarball" in https://registry.npmjs.org/*) ;; *) die "tarball の URL が registry.npmjs.org でない: $tarball";; esac
  local tgz=$SRC2DIR/npm/$ELK_NAME-$ELK_VER.tgz
  "${CURL[@]}" -o "$tgz.tmp" "$tarball"
  mv "$tgz.tmp" "$tgz"
  local got; got=$(python3 -I -c 'import hashlib,base64,sys;print("sha512-"+base64.b64encode(hashlib.sha512(open(sys.argv[1],"rb").read()).digest()).decode())' "$tgz")
  [ "$got" = "$integrity" ] || die "tarball の sha512 がレジストリの integrity と違う: $got"
  echo "sha512 一致"
  local s256; s256=$(sha256sum "$tgz" | cut -d' ' -f1)
  {
    echo "elkjs@$ELK_VER  license(レジストリ)=$license"
    echo "  tarball $tarball"
    echo "  integrity $integrity(一致)"
    echo "  sha1 $shasum"
    echo "  sha256 $s256"
  } >> "$rec"

  # 展開(専用のディレクトリ。先頭の package/ は剥がす。.. や絶対パスの要素は tar が拒む・剥がす)
  local X=$WORKDIR/elkjs-$ELK_VER
  case "$X" in "$ROOT"/work/*) rm -rf "$X";; *) die "作業場所が想定外";; esac
  mkdir -p "$X"
  tar -tzf "$tgz" > "$SRC2DIR/npm/$ELK_NAME-$ELK_VER.list"
  if grep -qE '(^|/)\.\.(/|$)|^/' "$SRC2DIR/npm/$ELK_NAME-$ELK_VER.list"; then die "tarball に .. か絶対パスの要素がある"; fi
  tar -xzf "$tgz" -C "$X" --strip-components=1 --no-same-owner --no-same-permissions
  [ -f "$X/lib/elk.bundled.js" ] || die "lib/elk.bundled.js が無い"
  echo "展開: $X  elk.bundled.js sha256=$(sha256sum "$X/lib/elk.bundled.js" | cut -d' ' -f1)" | tee -a "$rec"
  grep -E '"(name|version|license)"' "$X/package.json" | tee -a "$rec"

  # --- LLVM の許諾の文
  local p dst
  for p in "${LLVM_LICENSE_PATHS[@]}"; do
    dst=$SRC2DIR/llvm/$(echo "$p" | tr '/' '-')
    "${CURL[@]}" -o "$dst" "https://raw.githubusercontent.com/llvm/llvm-project/$LLVM_TAG/$p"
    [ -s "$dst" ] || die "$p が空"
    grep -q 'Apache License' "$dst" || die "$p に Apache License の文が無い(別の物が返った恐れ)"
    echo "$LLVM_TAG $p sha256=$(sha256sum "$dst" | cut -d' ' -f1) bytes=$(wc -c < "$dst")" | tee -a "$rec"
  done
}
run_step 10-fetch-round2 step
