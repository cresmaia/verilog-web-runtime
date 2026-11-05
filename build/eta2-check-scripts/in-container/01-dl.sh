# 01 のコンテナの中(bash -c の本文。$SET=a|b, $SNAP_TS, $PKGS, $HOST_UID, $HOST_GID)
export DEBIAN_FRONTEND=noninteractive
trap 'chown -R "$HOST_UID:$HOST_GID" /dl 2>/dev/null' EXIT
APT=(apt-get -o APT::Sandbox::User=root -o Dir::Cache::archives=/dl/archives -o APT::Keep-Downloaded-Packages=true)
EXTRA=()
mkdir -p /dl/archives/partial
dpkg-query -W -f='${Package} ${Version}\n' > /dl/base-packages.txt
cp /etc/apt/sources.list.d/ubuntu.sources /dl/sources-original.txt 2>/dev/null || true

if [ "$SET" = b ]; then
  # 未確認: snapshot.ubuntu.com の URL の形。Ubuntu の案内にある形 https://snapshot.ubuntu.com/ubuntu/<UTC時刻> を使う
  cat > /etc/apt/sources.list.d/ubuntu.sources <<EOT
Types: deb
URIs: https://snapshot.ubuntu.com/ubuntu/$SNAP_TS
Suites: noble noble-updates noble-backports noble-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOT
  # 統括の決定(B): イメージは今日の ubuntu:24.04 のまま揃えない。snapshot の Release の期限は見ない
  EXTRA=(-o Acquire::https::CaInfo=/dl/ca-bundle.crt -o Acquire::Check-Valid-Until=false)
fi
cp /etc/apt/sources.list.d/ubuntu.sources /dl/sources-used.txt

date -u +%FT%TZ > /dl/downloaded-at.txt
"${APT[@]}" "${EXTRA[@]}" update
echo "== 段: 落とす"
# shellcheck disable=SC2086
if ! "${APT[@]}" "${EXTRA[@]}" install --download-only -y --no-install-recommends $PKGS; then
  if [ "$SET" = b ]; then
    # 統括の決定(B): 基本パッケージが snapshot より新しくて依存がぶつかったときだけ、--allow-downgrades で再試行する。
    # apt は、解くのに要る物しか下げない。下げた物は DOWNGRADED の一覧として /dl/downgraded.txt に残す
    echo "== (b) 依存がぶつかった。--allow-downgrades で1回だけ再試行する"
    # shellcheck disable=SC2086
    "${APT[@]}" "${EXTRA[@]}" install --download-only -y --no-install-recommends --allow-downgrades $PKGS \
      2>&1 | tee /dl/downgrade-retry.log || { echo "(b) は --allow-downgrades でも解けない。止めて報告する" >&2; exit 1; }
    sed -n '/will be DOWNGRADED/,/^[^ ]/p' /dl/downgrade-retry.log > /dl/downgraded.txt || true
  else
    exit 1
  fi
fi
# shellcheck disable=SC2086
apt-cache policy $PKGS > /dl/policy.txt
chown -R "$HOST_UID:$HOST_GID" /dl
echo "deb: $(ls /dl/archives/*.deb | wc -l) 個"
