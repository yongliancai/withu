#!/usr/bin/env bash
# 在 VPS 上更新到 GitHub 最新版：./deploy.sh
set -e
cd "$(dirname "$0")"
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then echo "已經是最新版"; exit 0; fi
# 套件有變動才重新安裝
if git diff --name-only "$before" "$after" | grep -q '^package'; then npm install --omit=dev; fi
pm2 restart companion
echo "更新完成：$(git log -1 --format='%h %s')"
