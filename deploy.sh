#!/usr/bin/env bash
# 在 VPS 上更新到 GitHub 最新版：./deploy.sh
set -e
cd "$(dirname "$0")"
# npm 可能改過 package-lock.json：先還原，避免拉新版時衝突
git checkout -- package-lock.json 2>/dev/null || true
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then echo "已經是最新版"; exit 0; fi
# 套件有變動才重新安裝
if git diff --name-only "$before" "$after" | grep -q '^package'; then npm install --omit=dev; git checkout -- package-lock.json 2>/dev/null || true; fi
pm2 restart companion
echo "更新完成：$(git log -1 --format='%h %s')"
