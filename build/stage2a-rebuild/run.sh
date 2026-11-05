#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Cresmaia Inc. See LICENSES/MIT-cresmaia-glue.txt.
# The rebuild of 2026-10-19 (stage 2A): the same conditions as the second round's builds (build/eta2-check-scripts/12-line-build2.sh, lib.sh, lib2.sh),
# on the source tar.gz of this repository (made from a git commit by tools/build-site.mjs). --network none.
# usage: run.sh <label> <base dir in the container> <in-container script> <workdir>
#   <workdir> has: set/eta2-source-set2.tar.gz (the source tar.gz under that name, because the script expects it), debs/ (the .deb files of records/debs-a.sha256), out/
set -euo pipefail
label=$1; base=$2; script=$3; W=$4
IMG=ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac     # records/ubuntu-digest.txt
mkdir -p "$W/out/$label"
docker rm -f "eta2r-$label" >/dev/null 2>&1 || true
timeout -k 60 4500 docker run --name "eta2r-$label" --rm --init --platform linux/amd64 --pull=never \
  --security-opt no-new-privileges --cap-drop=ALL --pids-limit 4096 --memory 10g --network none \
  --cap-add=CHOWN --cap-add=DAC_OVERRIDE --cap-add=FOWNER --cap-add=FSETID --cap-add=SETUID --cap-add=SETGID --cap-add=KILL \
  -e BASE="$base" -e TREE_NAME=iverilog-wasm-1a23d1ffd -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e NEW_VERSION_TAG=s20260301-476-g1a23d1ffd-wasm1 -e NEW_PREFIX=/src/iverilog \
  -e ORIG_VERSION_TAG=s20260301-476-g1a23d1ffd-dirty -e ORIG_PATH=/tmp/claude-0/-home-claude/513d9414-a293-5bdf-9b4c-cec38be58a04/scratchpad/fresh2 \
  -v "$W/set:/set:ro" -v "$W/debs:/debs:ro" -v "$W/out/$label:/out" "$IMG" \
  bash -euo pipefail -c "$(<"$script")" line2
