#!/usr/bin/env bash
# 在 VPS 上更新到 GitHub 最新版：./deploy.sh
# 退回上一版：./deploy.sh rollback（GitHub 自動部署健康檢查失敗時會自動執行）
set -e
cd "$(dirname "$0")"
restart() { pm2 restart companion; }
reinstall_if_needed() { if git diff --name-only "$1" "$2" | grep -q '^package'; then npm install --omit=dev; git checkout -- package-lock.json 2>/dev/null || true; fi; }

if [ "$1" = "rollback" ]; then
  [ -f .deploy-prev ] || { echo "沒有上一版的紀錄"; exit 1; }
  prev=$(cat .deploy-prev); cur=$(git rev-parse HEAD)
  git checkout -- package-lock.json 2>/dev/null || true
  git reset --hard "$prev"
  reinstall_if_needed "$cur" "$prev"
  restart
  echo "已退回：$(git log -1 --format='%h %s')"
  exit 0
fi

# npm 可能改過 package-lock.json：先還原，避免拉新版時衝突
git checkout -- package-lock.json 2>/dev/null || true
before=$(git rev-parse HEAD)
git pull --ff-only
after=$(git rev-parse HEAD)
if [ "$before" = "$after" ]; then echo "已經是最新版"; exit 0; fi
echo "$before" > .deploy-prev
# 套件有變動才重新安裝
reinstall_if_needed "$before" "$after"
restart
echo "更新完成：$(git log -1 --format='%h %s')"
