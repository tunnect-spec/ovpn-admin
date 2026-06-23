#!/usr/bin/env bash
set -euo pipefail

# OpenVPN XOR v2.7.3 final installer
# Ubuntu 22.04 / 24.04
# Source: OpenVPN 2.7.3 + luzrain/openvpn-xorpatch patches/v2.7.3

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

OPENVPN_VERSION="2.7.3"
OPENVPN_TAG="v2.7.3"
