#!/bin/bash
# dsh-web-network-optimizer 构建:纯 ESM JavaScript,无需 tsc/tsdown。
# src/index.js       → lib/index.js   (host)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p lib
cp src/index.js lib/index.js

# 语法自检(不执行)
node --check lib/index.js

echo "=== dsh-web-network-optimizer host build complete ==="
