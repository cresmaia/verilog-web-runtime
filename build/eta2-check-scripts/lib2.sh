#!/usr/bin/env bash
# 2回目の台本(10〜15)が source する共通部分。1回目の lib.sh は変えず、その上に足す。
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SRC2DIR=$ROOT/src2                 # 10 が取る外の物(elkjs の tarball、LLVM の許諾の文)
RESULTS=$ROOT/results

# --- 取る物(事前登録 12.1)
ELK_NAME=elkjs; ELK_VER=0.12.0
LLVM_TAG=llvmorg-15.0.7
LLVM_LICENSE_PATHS=(libcxx/LICENSE.TXT libcxxabi/LICENSE.TXT compiler-rt/LICENSE.TXT)

# --- 2回目の一式
TREE_NAME2=$TREE_NAME                         # 最上位の名前は1回目と同じ(木の中身は当社の変更が重なる)
SET2_TAR=$SETDIR/eta2-source-set2.tar.gz
CRESMAIA_DATE=2026-10-18
NEW_VERSION_TAG=s20260301-476-g1a23d1ffd-wasm1
NEW_PREFIX=/src/iverilog                      # -ffile-prefix-map の置き換え先
# 元の wasm に入っている物(事前登録 12.1 B の「除く行」の元)
ORIG_VERSION_TAG=s20260301-476-g1a23d1ffd-dirty
ORIG_PATH=/tmp/claude-0/-home-claude/513d9414-a293-5bdf-9b4c-cec38be58a04/scratchpad/fresh2

# 線のビルドの2つの場所(深さの違う2つのパス)
BUILD_BASE_1=/work
BUILD_BASE_2=/build/a/b/c/d

# 元の dist の写し(13 が cp で作る。元の作業の置き場は読むだけ)
ORIG_DIST_COPY=$WORKDIR/orig-dist

# コンテナの中で、(a) の deb を全部、ネットワーク無しで入れるときの共通の注:
#   足す権限は CAPS_DPKG(lib.sh の注を参照)。イメージは records/ubuntu-digest.txt の digest(--pull=never)

# 2回目の一式が在り、records/set2.sha256 と一致することを確かめる
check_set2() {
  [ -s "$SET2_TAR" ] || die "2回目の一式が無い。11 を先に"
  [ -s "$REC/set2.sha256" ] || die "records/set2.sha256 が無い。11 を先に"
  [ "$(sha256sum "$SET2_TAR" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$REC/set2.sha256")" ] || die "2回目の一式が records/set2.sha256 と違う"
}

# --- elkjs の試し(14a・14b が使う) ---
SIGMA_VENDOR=/path/to/original/vendor     # 読むだけ(cp で写す)。replaced for publication
NSVG_COPY=$WORKDIR/netlistsvg-1.0.2
ELK03_COPY=$WORKDIR/elkjs-0.3.0
ELK12_DIR=$WORKDIR/elkjs-$ELK_VER                                    # 10 が展開した物

# 元の物を cp で写す(netlistsvg 1.0.2 と elkjs 0.3.0)。版を package.json で確かめる
prepare_elk_inputs() {
  local d
  for pair in "$SIGMA_VENDOR/netlistsvg:$NSVG_COPY" "$SIGMA_VENDOR/elkjs:$ELK03_COPY"; do
    case "${pair#*:}" in "$ROOT"/work/*) rm -rf "${pair#*:}";; *) die "作業場所が想定外";; esac
    cp -a "${pair%%:*}" "${pair#*:}"
  done
  grep -q '"version": "1.0.2"' "$NSVG_COPY/package.json" || die "netlistsvg の版が 1.0.2 でない"
  grep -q '"version": "0.3.0"' "$ELK03_COPY/package.json" || die "elkjs の版が 0.3.0 でない"
  for d in test/digital/generics.json test/digital/ports_splitjoin.json test/digital/up3down5.json test/digital/mux4.json test/digital/hyperedges.json lib/default.svg built/netlistsvg.bundle.js; do
    [ -f "$NSVG_COPY/$d" ] || die "netlistsvg に $d が無い"
  done
}

# run_elkjs <label> <elk の木> <出力> <mode の列(空白区切り)>
run_elkjs() {
  local label=$1 elkdir=$2 out=$3 modes=$4
  [ -f "$elkdir/lib/elk.bundled.js" ] || die "$elkdir/lib/elk.bundled.js が無い"
  load_image
  ls "$ROOT"/debs-a/archives/*.deb >/dev/null 2>&1 || die "debs-a が空"
  [ -z "$(docker ps -q -f name=eta2-)" ] || die "eta2- のコンテナがまだ動いている"
  if [ -n "$(ls -A "$out" 2>/dev/null)" ]; then mv "$out" "$out.prev-$(date -u +%Y%m%dT%H%M%SZ)"; fi
  mkdir -p "$out"
  drun "eta2-elk-$label" 1800 --network none "${CAPS_DPKG[@]}" \
    -e HOST_UID="$HOST_UID" -e HOST_GID="$HOST_GID" -e ELK_MODES="$modes" \
    -v "$NSVG_COPY:/netlistsvg:ro" -v "$elkdir:/elk:ro" \
    -v "$ROOT/scripts/in-container/14-elkjs.mjs:/opt/14-elkjs.mjs:ro" \
    -v "$ROOT/debs-a/archives:/debs:ro" -v "$out:/out" "$IMG" \
    bash -euo pipefail -c "$(<"$ROOT/scripts/in-container/14-elkjs.sh")" elk
}

# mode ごとの結果の表(python -I で、コンテナが書いた json を読むだけ)
show_elk_results() {
  local out=$1 m
  for m in $(cut -d' ' -f1 "$out/modes-rc.txt"); do
    echo "-- mode=$m(node の終了コード $(grep "^$m " "$out/modes-rc.txt" | cut -d' ' -f2))"
    [ -f "$out/$m/results.json" ] || { echo "  results.json が無い"; continue; }
    python3 -I -c '
import json,sys
r=json.load(open(sys.argv[1]))
if r.get("loadError"): print("  読み込みの失敗:", r["loadError"]["message"][:300])
for t in r["tests"]:
    print("  %-16s %s  svg=%7d bytes  入力の部品=%s  %s" % (t["name"], "OK  " if t["ok"] else "失敗", t["svgBytes"], t["netlistCells"], (t["error"] or {}).get("message","")[:200]))
' "$out/$m/results.json"
  done
}
