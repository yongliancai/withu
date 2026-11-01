#!/usr/bin/env bash
# 部署專用 SSH 金鑰只能做這兩件事（在 authorized_keys 用 command= 綁住這個檔案）：
#   deploy   → ./deploy.sh
#   rollback → ./deploy.sh rollback
# 其他指令一律拒絕，就算金鑰外流，也只能把網站更新成 GitHub 上 main 的版本。
set -e
# 非互動的 SSH 不會讀登入設定，node／pm2 可能找不到：補上常見路徑
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
case "$SSH_ORIGINAL_COMMAND" in
  deploy) exec ./deploy.sh ;;
  rollback) exec ./deploy.sh rollback ;;
  *) echo "這把金鑰只能執行 deploy 或 rollback"; exit 1 ;;
esac
