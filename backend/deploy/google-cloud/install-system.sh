#!/usr/bin/env bash
# Run on Ubuntu 26.04 x86_64 as the bot user with sudo access.
set -euo pipefail
. /etc/os-release
if [[ "$ID" != ubuntu || "$VERSION_ID" != 26.04 || "$(uname -m)" != x86_64 ]]; then
  echo 'Este instalador requer Ubuntu 26.04 x86_64 (Google Cloud).' >&2
  exit 1
fi
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  ca-certificates curl xz-utils fonts-liberation \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 \
  libcups2t64 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0t64 libnspr4 libnss3 \
  libx11-xcb1 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 \
  libxkbcommon0 libxrandr2 libxrender1 libxss1 libxtst6

# Install an official Node 22 binary, verifying its published checksum.
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
cd "$work_dir"
curl -fsSLO https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt
archive=$(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ {print $2}' SHASUMS256.txt)
[[ "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]]
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$archive"
awk -v archive="$archive" '$2 == archive' SHASUMS256.txt | sha256sum -c -
sudo mkdir -p /opt/airlert-node
sudo tar -xJf "$archive" -C /opt/airlert-node
node_dir="/opt/airlert-node/${archive%.tar.xz}"
sudo ln -sfn "$node_dir/bin/node" /usr/local/bin/node
sudo ln -sfn "$node_dir/bin/npm" /usr/local/bin/npm
sudo ln -sfn "$node_dir/bin/npx" /usr/local/bin/npx
/usr/local/bin/node --version
/usr/local/bin/npm --version
