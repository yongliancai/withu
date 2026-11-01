# 合併後自動部署

設定好之後的流程：

```
Claude 開修正 PR → CI 自動檢查（語法＋測試模式開機）
        ↓（你：手機上看一眼，按 Merge）
main 的 CI 通過 → GitHub 連到主機執行 ./deploy.sh
        ↓
健康檢查 https://你的網域/api/health
        ├─ 正常：完成
        └─ 失敗：自動 ./deploy.sh rollback 退回上一版
```

部署用的 SSH 金鑰在主機上被 `scripts/deploy-gate.sh` 綁住，只能執行「部署」和「退回」，不能登入、不能下其他指令。

## 一次性設定（約 10 分鐘）

以下指令都在 **主機上**、用跑網站的那個帳號（例如 `liancai`）執行。`網站資料夾` 換成有 `deploy.sh` 的那個資料夾。

1. 先手動部署一次這個版本（之後才有 `scripts/deploy-gate.sh`）：
   ```bash
   cd 網站資料夾 && ./deploy.sh
   ```
2. 產生部署專用的金鑰（不設密碼）：
   ```bash
   ssh-keygen -t ed25519 -N "" -C withu-deploy -f ~/.ssh/withu_deploy
   ```
3. 把公鑰加進 `authorized_keys`，並綁住只能跑 deploy-gate：
   ```bash
   echo "command=\"$(cd 網站資料夾 && pwd)/scripts/deploy-gate.sh\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $(cat ~/.ssh/withu_deploy.pub)" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```
4. 在主機上試一次（應該印出「已經是最新版」）：
   ```bash
   ssh -i ~/.ssh/withu_deploy localhost deploy
   ```
   如果出現 `pm2: command not found`，用 `which pm2` 查路徑，把那個資料夾加進 `scripts/deploy-gate.sh` 的 `PATH` 那一行。
5. 印出私鑰，等一下貼到 GitHub（貼完就可以把主機上的私鑰刪掉：`rm ~/.ssh/withu_deploy`）：
   ```bash
   cat ~/.ssh/withu_deploy
   ```
6. 在 **你自己的電腦** 取得主機指紋：
   ```bash
   ssh-keyscan -p 22 liancai.fun
   ```

## 在 GitHub 填 Secrets

repo → **Settings → Secrets and variables → Actions → New repository secret**，逐一新增：

| 名稱 | 內容 |
|---|---|
| `DEPLOY_HOST` | 主機網域或 IP，例如 `liancai.fun` |
| `DEPLOY_USER` | 跑網站的帳號，例如 `liancai` |
| `DEPLOY_KEY` | 第 5 步印出的整段私鑰（含 BEGIN／END 那兩行） |
| `DEPLOY_KNOWN_HOSTS` | 第 6 步印出的全部內容 |
| `HEALTH_URL` | `https://liancai.fun/api/health` |
| `DEPLOY_PORT` | SSH 不是 22 才需要填 |

私鑰只貼在 GitHub Secrets，不要貼到聊天或 Issue 裡。

## 測試

repo → **Actions → Deploy → Run workflow**，手動跑一次。綠色就代表設定完成，之後每次合併都會自動部署。

## 想連 Merge 都自動（可選）

1. repo → **Settings → General** 勾 **Allow auto-merge**。
2. **Settings → Branches → Add branch ruleset**（或 Branch protection rule）保護 `main`：勾「Require status checks to pass」，選 `check`（CI）。
3. 之後在 PR 頁面按 **Enable auto-merge**，CI 一通過就會自己合併、接著自動部署。

建議：排程修 bug 的 PR 還是由你按 Merge。錯誤回報的內容來自網站，理論上任何人都能送假的錯誤進來；讓人看一眼再上線比較安全。
