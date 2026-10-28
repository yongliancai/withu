# 伴旅 WithU 安全設定

## 程式裡已經做好的（更新後自動生效）

- **防暴力猜測**：登入碼 15 分鐘內最多試 10 次、註冊 1 小時 20 次、邀請碼查詢 15 分鐘 30 次（以 IP 計算）；後台權杖錯 10 次會擋 15 分鐘。被擋下時後台「系統紀錄」會出現「安全」來源的警告。
- **後台權杖比對**：用固定時間比對，不會因為回應時間洩漏權杖。
- **安全標頭**：禁止別的網站把伴旅嵌進去（防點擊劫持）、只能載入自己網站的程式（CSP）、HTTPS 強制（HSTS）、只有自己網站能用麥克風和相機。
- **上傳檢查**：照片、語音都會檢查檔案開頭，確定真的是圖片或聲音，大小上限 10 MB。
- **私人檔案**：聊天照片、語音只有本人拿得到；角色人像依關係進度只給模糊或清楚的版本（模糊版是伺服器做好的，拿不到原圖）。
- **紀錄不存祕密**：系統紀錄會自動遮掉金鑰、權杖、密碼、cookie。
- **預算上限**：見後台「系統設定 → 預算」。

## 需要你在主機上做的

以下用 root 登入 VPS 執行。

### 1. 後台只讓你的網路進來（建議）

先查你家或辦公室的 IP（用手機或電腦打開 https://ifconfig.me ），然後在網站的 `.env` 加一行（多個用逗號隔開）：

```
ADMIN_IPS=你的IP,另一個IP
```

存檔後 `pm2 restart companion`。之後只有這些 IP 能進後台；換網路（例如在外面用手機熱點）就進不去，要再加上去。

### 2. SSH 只用金鑰登入

如果你已經用金鑰登入（不用打密碼），再關掉密碼登入：

```bash
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh
```

> 執行前**一定要先確認金鑰登入是成功的**，不然會把自己鎖在外面。Hostinger 後台有「瀏覽器終端機」可以救回來。

### 3. 防火牆

CloudPanel 自己有防火牆：CloudPanel 後台 → **Admin Area → Security → Firewall**。只留下：

| 連接埠 | 用途 |
|---|---|
| 22 | SSH（可以只允許你的 IP） |
| 80、443 | 網站 |
| 8443 | CloudPanel 後台（建議只允許你的 IP） |

App 的 5001 埠**不要**對外開放（CloudPanel 的 Nginx 會在內部轉過去）。

### 4. 擋掉一直猜密碼的機器人

```bash
apt update && apt install -y fail2ban
systemctl enable --now fail2ban
```

預設就會保護 SSH。

### 5. 自動安全更新

```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades   # 選 Yes
```

### 6. CloudPanel 後台加上兩步驟驗證

CloudPanel 右上角你的帳號 → **Two-Factor Authentication**，用手機的驗證 App 掃描。

## 每日自動備份

用網站使用者設定排程（不要用 root）：

```bash
su - liancai
crontab -e
```

加入這一行（每天凌晨 4 點備份，保留 14 天）：

```
0 4 * * * cd ~/htdocs/liancai.fun && /usr/bin/env node scripts/backup.js >> ~/backup.log 2>&1
```

先手動跑一次確認：`cd ~/htdocs/liancai.fun && node scripts/backup.js`

備份放在 `data/backups/`。**這還是在同一台主機上**，主機壞掉會一起不見，所以建議再放一份到別的地方：

- **Google Drive**：在主機上安裝 rclone（`curl https://rclone.org/install.sh | sudo bash`），用 `rclone config` 連上你的 Google Drive（取名 `gdrive`），然後把排程改成：
  ```
  0 4 * * * cd ~/htdocs/liancai.fun && BACKUP_RCLONE=gdrive:withu-backup /usr/bin/env node scripts/backup.js >> ~/backup.log 2>&1
  ```
- 或是 Hostinger 的 VPS 快照（Hostinger 後台 → VPS → Snapshots），每週手動做一次。

**還原**：把 `pm2 stop companion`，用備份的 `companion-日期.db` 取代 `data/companion.db`，把 `files-日期.tar.gz` 解壓縮回 `data/`（`tar -xzf files-日期.tar.gz -C data`），再 `pm2 start companion`。

## 定期要做的

- **每 3 個月**換一次 `ADMIN_TOKEN`（`.env` 改完 `pm2 restart companion`）和 OpenAI 金鑰（OpenAI 後台建立新的、換上、再刪掉舊的）。
- **每個月**看一次後台「系統紀錄」篩選「安全」，有沒有異常的大量嘗試。
- 有人回報帳號被別人登入：後台「測試者」→ 重發登入碼（舊的會失效）。
- 發生資料外洩：照 `docs/incident-response.md` 的 72 小時流程處理。
