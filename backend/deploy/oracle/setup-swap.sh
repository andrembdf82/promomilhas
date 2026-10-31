#!/usr/bin/env bash
# Optional 2 GiB swap for the 1 GiB VM; never overwrites existing swap.
set -euo pipefail
if [[ -n "$(swapon --show --noheadings)" ]]; then
  echo 'Ja existe swap ativo. Nenhuma alteracao realizada.'
  swapon --show
  exit 0
fi
swap_path=/swapfile-airlert
if sudo test -e "$swap_path"; then
  echo 'O arquivo /swapfile-airlert ja existe; confira antes de prosseguir.' >&2
  exit 1
fi
sudo sh -c 'umask 077; fallocate -l 2G /swapfile-airlert'
sudo chmod 600 "$swap_path"
sudo mkswap "$swap_path"
sudo swapon "$swap_path"
if ! awk '$1 == "/swapfile-airlert" {found=1} END {exit !found}' /etc/fstab; then
  printf '%s\n' '/swapfile-airlert none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h
