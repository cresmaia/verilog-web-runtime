#!/usr/bin/env bash
# 01: パッケージの取得(ネットワーク付きのコンテナ。落とすだけで、導入しない)
# - イメージは ubuntu:24.04 を pull し、digest を records/ubuntu-digest.txt に書く。以後はその digest で指す
# - コンテナに見せるのは落とし先のディレクトリ(-v <dir>:/dl)だけ。--privileged・docker.sock・ホームは使わない
# - 足した権限: CHOWN(落とした物の持ち主を host の利用者に戻す)・DAC_OVERRIDE(apt が root で lists/cache に書く)・FOWNER
#   apt は APT::Sandbox::User=root で走らせる(_apt への降格に SETUID が要るのを避ける)
# - (a) いまの倉庫  (b) snapshot.ubuntu.com の $SNAP_TS
# - (b) は https。ubuntu:24.04 のイメージに ca-certificates が無いため、host の CA 束を /dl/ca-bundle.crt に写して渡す(データとして)
source "$(dirname "$0")/lib.sh"

step() {
  need_cmds docker timeout sha256sum
  [ -r /etc/ssl/certs/ca-certificates.crt ] || die "host の CA 束が無い"
  docker pull --platform "$PLATFORM" "$UBUNTU_REF"
  local dig; dig=$(docker image inspect --format '{{index .RepoDigests 0}}' "$UBUNTU_REF")
  case "$dig" in *@sha256:*) ;; *) die "digest が取れない: $dig";; esac
  echo "$dig" > "$REC/ubuntu-digest.txt"
  echo "ubuntu の digest: $dig"
  load_image

  local set
  for set in a b; do
    local d=$ROOT/debs-$set
    mkdir -p "$d/archives"
    cp /etc/ssl/certs/ca-certificates.crt "$d/ca-bundle.crt"
    drun "eta2-dl-$set" 2400 \
      --cap-add=CHOWN --cap-add=DAC_OVERRIDE --cap-add=FOWNER \
      -e SET="$set" -e SNAP_TS="$SNAP_TS" -e PKGS="${PKGS[*]}" -e HOST_UID="$HOST_UID" -e HOST_GID="$HOST_GID" \
      -v "$d:/dl" "$IMG" \
      bash -euo pipefail -c "$(<"$ROOT/scripts/in-container/01-dl.sh")" dl
    ( cd "$d/archives" && sha256sum ./*.deb > "$d/MANIFEST.sha256" )
    echo "(${set}) 落とした deb: $(wc -l < "$d/MANIFEST.sha256") 個"
    cp "$d/MANIFEST.sha256" "$REC/debs-$set.sha256"
    ls -l "$d/archives" | grep -E ' emscripten_' || echo "警告: emscripten の deb が見えない"
  done
}
run_step 01-download-debs step
