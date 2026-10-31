# 自動回報與修正程式問題

## 流程

```
使用者手機／伺服器出錯、功能檢查沒過
        ↓（自動）
後台「系統紀錄」記一筆
        ↓（每小時自動整理）
後台「系統紀錄 → 待修清單」：同一種問題歸成一項、計數
        ↓（有設定 GitHub 才會）
GitHub Issue（標籤 auto-bug），一種問題一個；之後變多會補留言
        ↓（排程的 Claude 任務，每天一次）
Claude 讀 Issue → 查程式 → 開修正 PR（不會直接改 main）
        ↓（你）
看 PR、按 Merge → 在主機上 ./deploy.sh
```

最後兩步一定要你確認，Claude 不會自己部署到正式網站。

## 修好之後

- 修正 PR 的說明會寫 `Fixes #N`，你按 Merge 之後 GitHub 會自動關掉那個 Issue。
- 後台每小時跟 GitHub 對一次：Issue 關掉的，「待修清單」會顯示「已修好」，相關的系統紀錄也會自動標成已處理。
- 修好後如果同一種問題又發生 3 次以上（關閉 6 小時後才開始算，留時間給你部署），會自動重新打開 Issue 並留言，隔天的排程任務會再看一次。
- 不是程式問題、或你自己處理掉的：在「待修清單」按「標記已處理」，有 Issue 的話也會一起關掉。

## 會自動抓到哪些問題

- 手機端的程式錯誤（含堆疊）、伺服器回 500 的 API。
- 功能檢查沒過：畫面上出現 `null`／`undefined`／`NaN`、圖片或語音載不出來、空白的提示訊息。
- 伺服器端的錯誤：AI 模型、語音、推播、主動訊息、照片生成失敗等。

不算程式問題、不會送出去的：使用者回報（另外處理）、安全警告、預算、系統已自動修正的。

## 設定 GitHub Issue（可選）

> 這個 repo 目前是**公開**的，Issue 任何人都看得到。Issue 裡只放錯誤訊息、程式堆疊、哪個畫面、次數和瀏覽器類型，**不放使用者資料或聊天內容**。如果還是不放心，可以把 repo 改成私人（GitHub → Settings → Danger Zone → Change visibility）。

1. GitHub 右上角頭像 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**。
2. Repository access 選 **Only select repositories → withu**；Permissions → Repository permissions → **Issues：Read and write**（其他都不用）。有效期限建議 90 天。
3. 在主機網站的 `.env` 加：
   ```
   GITHUB_REPO=yongliancai/withu
   GITHUB_ISSUES_TOKEN=剛剛產生的權杖
   ```
4. `pm2 restart companion`。後台「系統紀錄 → 待修清單」會顯示「已連接」，按「立刻整理並送到 GitHub」試一次。

權杖不要貼到聊天裡，直接填在主機上。

## 排程修正任務

在 Claude 建立一個每天跑一次的排程任務，內容大致是：讀 `yongliancai/withu` 標籤 `auto-bug` 且還開著的 Issue，一次挑 1–3 個，找出原因、修改、在本機測試模式跑過，開 PR 並在 Issue 留言 PR 連結；看不出原因的就在 Issue 留言寫目前的判斷，不要亂改。
