#!/usr/bin/env bash
# 12: 2回目の線のビルド(合否に使う)。--network none のコンテナを2つ(順に走らせる)
# - 2回目の一式の tar.gz を、1つ目は /work、2つ目は /build/a/b/c/d に展開し、それぞれ wasm/build.sh を既定のまま走らせる
#   (引数なし・JOBS/OPT の上書きなし・EMCC_DEBUG を付けない)。道具は (a) の deb(1回目と同じ、ネットワーク無しで導入)
# - 出力は別々の置き場(out-r2-1, out-r2-2)。終わったら、3つの wasm の sha256 を2つの間で比べ、表と「合格/不合格」を出す
#   JS(ivlpp.js・ivl.js・vvp.js)の sha256 も、参考として比べて出す(合否に使わない)
# - 中で、wasm・js の中の版の文字列とパスの件数を調べて記録する(strings 相当。grep -a で数える)
# - 合格なら 1つ目の wasm を「配る wasm」とし、records/dist-wasm.sha256 に書く
# - 見せる物: 2回目の一式(ro)・(a) の deb(ro)・出力の置き場(rw)だけ。足した権限は CAPS_DPKG(導入用)。ネットワーク無し
# - 環境で止まったときの走らせ直しは3回まで(事前登録)。置き場は走らせ直しごとに .prev-<時刻> へ退避する
source "$(dirname "$0")/lib2.sh"

build_one() { # 番号 展開先
  local n=$1 base=$2 out=$ROOT/out-r2-$1
  if [ -n "$(ls -A "$out" 2>/dev/null)" ]; then mv "$out" "$out.prev-$(date -u +%Y%m%dT%H%M%SZ)"; fi
  mkdir -p "$out"
  drun "eta2-line2-$n" 4500 --network none "${CAPS_DPKG[@]}" \
    -e BASE="$base" -e TREE_NAME="$TREE_NAME2" -e HOST_UID="$HOST_UID" -e HOST_GID="$HOST_GID" \
    -e NEW_VERSION_TAG="$NEW_VERSION_TAG" -e NEW_PREFIX="$NEW_PREFIX" \
    -e ORIG_VERSION_TAG="$ORIG_VERSION_TAG" -e ORIG_PATH="$ORIG_PATH" \
    -v "$SETDIR:/set:ro" -v "$ROOT/debs-a/archives:/debs:ro" -v "$out:/out" "$IMG" \
    bash -euo pipefail -c "$(<"$ROOT/scripts/in-container/12-line2.sh")" line2
}

step() {
  need_cmds docker timeout sha256sum realpath
  load_image; check_set2
  ls "$ROOT"/debs-a/archives/*.deb >/dev/null 2>&1 || die "debs-a が空"
  [ -z "$(docker ps -q -f name=eta2-)" ] || die "eta2- のコンテナがまだ動いている"
  build_one 1 "$BUILD_BASE_1"
  build_one 2 "$BUILD_BASE_2"

  # --- 比べる
  local f d verdict=PASS
  for d in 1 2; do for f in ivlpp.wasm ivl.wasm vvp.wasm; do
    local w=$ROOT/out-r2-$d/dist/$f
    [ -f "$w" ] && [ ! -L "$w" ] || die "$w が通常のファイルでない"
    case "$(realpath "$w")" in "$ROOT/out-r2-$d/"*) ;; *) die "$w の実体が out-r2-$d の外";; esac
  done; done
  for d in 1 2; do
    [ "$(cut -d' ' -f1 "$ROOT/out-r2-$d/set-used.sha256")" = "$(cut -d' ' -f1 "$REC/set2.sha256")" ] || die "build $d が使った一式が records/set2.sha256 と違う"
  done
  echo "== wasm の sha256(合否に使う)"
  printf '%-12s | %-6s\n' file 結果
  for f in ivlpp.wasm ivl.wasm vvp.wasm; do
    local a b; a=$(sha256sum "$ROOT/out-r2-1/dist/$f" | cut -d' ' -f1); b=$(sha256sum "$ROOT/out-r2-2/dist/$f" | cut -d' ' -f1)
    if [ "$a" = "$b" ]; then printf '%-12s | %s\n' "$f" 一致; else printf '%-12s | %s\n' "$f" 不一致; verdict=FAIL; fi
    echo "    build1($BUILD_BASE_1)         $a"; echo "    build2($BUILD_BASE_2) $b"
  done
  echo "== JS の sha256(参考。合否に使わない)"
  for f in ivlpp.js ivl.js vvp.js; do
    local a b; a=$(sha256sum "$ROOT/out-r2-1/dist/$f" | cut -d' ' -f1); b=$(sha256sum "$ROOT/out-r2-2/dist/$f" | cut -d' ' -f1)
    if [ "$a" = "$b" ]; then printf '%-12s | %s\n' "$f" 一致; else printf '%-12s | %s  (build1 %s / build2 %s)\n' "$f" 不一致 "$a" "$b"; fi
  done
  echo "== 版の文字列とパスの件数(wasm・js ごと。build1 と build2)"
  for d in 1 2; do echo "-- build$d"; cat "$ROOT/out-r2-$d/strings-counts.tsv"; done
  echo "== wasm の中の iverilog/build-wasm を含むパス(build1)"; sed -n 1,60p "$ROOT/out-r2-1/paths-in-wasm.txt"
  echo "2回のビルドの合否: $verdict"
  if [ "$verdict" = PASS ]; then
    ( cd "$ROOT/out-r2-1/dist" && sha256sum ivlpp.wasm ivl.wasm vvp.wasm ) > "$REC/dist-wasm.sha256"
    echo "配る wasm = out-r2-1/dist の3つ(records/dist-wasm.sha256)"
  fi
  mkdir -p "$RESULTS"; cp "$ROOT/out-r2-1/wasm.sha256" "$RESULTS/round2-build1-wasm.sha256"; cp "$ROOT/out-r2-2/wasm.sha256" "$RESULTS/round2-build2-wasm.sha256"
  echo "$verdict" > "$RESULTS/round2-build-verdict.txt"
}
run_step 12-line-build2 step
