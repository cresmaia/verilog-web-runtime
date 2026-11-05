#!/usr/bin/env bash
# 各段が source する共通部分。単独では走らせない。
# 外のコード(clone の中身・deb・ビルドの出力)はデータとして扱う。この機械の側では実行しない。

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOGDIR=$ROOT/logs
REC=$ROOT/records
SRCDIR=$ROOT/src
SETDIR=$ROOT/set
WORKDIR=$ROOT/work

IV_URL=https://github.com/steveicarus/iverilog.git
IV_COMMIT=1a23d1ffdbff2192b5d43c57711a0e9e67b7bbbc
IV_DESCRIBE_EXPECT=s20260301-476-g1a23d1ffd          # 00 が確かめる(-dirty は04で確かめる)
ZLIB_URL=https://github.com/madler/zlib.git;          ZLIB_TAG=v1.3.1
BZIP2_URL=https://github.com/libarchive/bzip2.git;    BZIP2_TAG=bzip2-1.0.8

SNAP_TS=20260922T000000Z
UBUNTU_REF=ubuntu:24.04
PLATFORM=linux/amd64

# 元の物(元の作業の置き場は読むだけ)
ORIG_TOOL=/path/to/original/tools/iverilog-wasm   # replaced for publication: a path of the machine where the scripts ran
PATCH_SRC=$ORIG_TOOL/iverilog-wasm.patch
PATCH_SHA_PREFIX=939b48d1
ORIG_DIST=$ORIG_TOOL/dist
# 事前登録(a private document of Cresmaia Inc. 第5節の表)
declare -A ORIG_SHA=(
  [ivlpp.wasm]=b1cac31687ceb6aade3b62c86f938004a8fb14c4ea4a9b8eb36fdf09e816b97c
  [ivl.wasm]=9123b237263d66705b2e8c1eabadc6d01f03e3deaf171c5f646f4e8f5ba379b3
  [vvp.wasm]=18ae14367c26b07a233f4fb86a38dce49308f1e60b872765a3a813817c60becf
)

TREE_NAME=iverilog-wasm-1a23d1ffd        # 一式の tar.gz の最上位の名前
SET_TAR=$SETDIR/eta2-source-set.tar.gz
FRESH=/path/to/original/fresh2   # replaced for publication: a path of the machine where the scripts ran

# build.sh と iverilog の autoconf.sh・configure.ac(AC_CHECK_PROGS)から洗い出した物:
#   emcc 類=emscripten / node(build.sh が node -e を呼ぶ)=nodejs / autoconf.sh=autoconf, gperf
#   configure=bison, flex, make / CC_FOR_BUILD=cc=gcc / em++ の下請け=g++ / 版の文字列=git / emscripten の道具=python3
# --no-install-recommends で落とし、導入(03・04)も同じ指定にする
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null   # host の git に、利用者・システムの設定を読ませない
PKGS=(emscripten nodejs autoconf gperf bison flex make gcc g++ python3 git)

HOST_UID=$(id -u); HOST_GID=$(id -g)

# コンテナの基本形。--cap-drop=ALL から始め、段ごとに足す(足した物は各段の注に書く)
DOCKER_COMMON=(--rm --init --platform "$PLATFORM" --pull=never
  --security-opt no-new-privileges --cap-drop=ALL --pids-limit 4096 --memory 10g)
# dpkg の導入に要る権限(CHOWN/FOWNER/FSETID=ファイルの所有・権限の設定、DAC_OVERRIDE=他者所有の dir への書き込み、
# SETUID/SETGID=maintainer script の adduser など、KILL=maintainer script の後始末)。ネットワークは足さない
CAPS_DPKG=(--cap-add=CHOWN --cap-add=DAC_OVERRIDE --cap-add=FOWNER --cap-add=FSETID
  --cap-add=SETUID --cap-add=SETGID --cap-add=KILL)

die() { echo "致命: $*" >&2; exit 1; }
need_cmds() { for c in "$@"; do command -v "$c" >/dev/null || die "$c が無い"; done; }

# 在るべき digest 指定のイメージ名を IMG に入れる(01 が書く)
load_image() {
  [ -s "$REC/ubuntu-digest.txt" ] || die "records/ubuntu-digest.txt が無い。先に 01 を走らせる"
  IMG=$(cat "$REC/ubuntu-digest.txt")
  docker image inspect "$IMG" >/dev/null 2>&1 || die "イメージ $IMG がローカルに無い(--pull=never)。01 をやり直す"
}

# drun <name> <timeout> <docker run の引数...>: 時間切れ・中断・どの終わり方でもコンテナを必ず落とす
# (timeout は docker クライアントしか止めない。-k 60 で TERM の後に KILL も送り、trap で docker kill する)
drun() {
  local name=$1 tmo=$2 rc=0; shift 2
  docker rm -f "$name" >/dev/null 2>&1 || true
  # shellcheck disable=SC2064
  trap "docker kill '$name' >/dev/null 2>&1 || true" INT TERM EXIT
  timeout -k 60 "$tmo" docker run --name "$name" "${DOCKER_COMMON[@]}" "$@" || rc=$?
  docker kill "$name" >/dev/null 2>&1 || true
  trap - INT TERM EXIT
  return $rc
}

# 終了コードの読み方。90=導入 91=展開 92=ビルド 93=版の文字列 94=木の食い違い 95=パッチの sha256
# 124=timeout 125〜127=docker 自体の失敗 137=KILL → 「環境」(一式の中身ではない所)
explain_rc() {
  case "$1" in
    90) echo "導入の失敗(環境)";; 91) echo "展開の失敗";; 92) echo "ビルドの失敗(一式の中身かもしれない。ログで判断)";;
    93) echo "版の文字列が違う";; 94) echo "一式の木と fresh2 が違う";; 95) echo "パッチの sha256 が違う";;
    124|137) echo "環境(時間切れ・強制終了)";; 125|126|127) echo "環境(docker の起動の失敗)";;
    *) echo "";;
  esac
}

# run_step <段の名> <関数>: 命令(set -x)と出力を logs/ に残し、最後に1行で成否を出す
run_step() {
  local name=$1 fn=$2 rc
  mkdir -p "$LOGDIR" "$REC"
  local log="$LOGDIR/$name-$(date -u +%Y%m%dT%H%M%SZ).log"
  set +e
  ( set -euo pipefail; export PS4='+ [${BASH_SOURCE##*/}:${LINENO}] '; set -x; "$fn" ) 2>&1 | tee -a "$log"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" -eq 0 ]; then echo "[$name] 成功" | tee -a "$log"
  else echo "[$name] 失敗 (終了コード $rc: $(explain_rc "$rc"))" | tee -a "$log"; fi
  exit "$rc"
}
