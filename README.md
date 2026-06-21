# 旅遊家庭記帳（korea_trip）

主財務系統（Family_finance_manage）底下的獨立小模組。用途：兩趟旅行**分開**即時記帳，
回國後再**統整匯入**主資料庫的 `transactions`。

兩趟各自幣別與付款方式（可在 `src/App.jsx` 的 `TRIPS` 調整）：
- **第一趟 釜山🇰🇷**：KRW ₩，付款＝現金 / Line Pay / 全支付
- **第二趟 福岡🇯🇵**：JPY ¥，付款＝現金 / 西瓜卡 / 信用卡

## 架構（三階段）

```
旅行中（即時）            趟別分隔            回國後（統整）
React App  ──POST──▶  Google Sheet  ──讀取──▶  travel_import.py ──▶ Postgres transactions
（手機）    ◀─GET──   「明細」單一分頁              （主系統 CLI）        （台幣本位）
                       靠「行程」欄區分兩趟
```

- **捕捉**：手機開 React App，多人即時寫入同一張 Google Sheet。
- **分隔**：單一「明細」分頁，用 `行程` 欄區分第一趟 / 第二趟（App 上方可切換）。
- **統整**：每趟結束後跑一次匯入腳本，把該趟資料映射成主系統交易。

## 檔案（Vite + React 專案）

| 檔案 | 說明 |
|------|------|
| `src/App.jsx` | App 主體（記帳 / 明細 / 統計，含行程切換、記錄人、可編輯匯率、Sheet 同步）。`WEB_APP_URL` 在此檔最上方。 |
| `src/main.jsx` | React 進入點 |
| `index.html` / `vite.config.js` / `package.json` | Vite 設定 |
| `public/manifest.webmanifest` / `public/icon.svg` | PWA 設定（可「加入主畫面」當 App 用） |
| `apps_script/Code.gs` | Google Apps Script Web App 後端（`doPost` 寫入、`doGet` 讀取、`delete`） |

## 執行（本機開發 / 手機區網）

```bash
cd korea_trip
npm install          # 第一次
npm run dev          # 開發伺服器，會印出 Local 與 Network 兩個網址
```

- 電腦瀏覽器開 `http://localhost:5173`。
- **手機**（與電腦同一 Wi-Fi）開 Network 網址，例如 `http://192.168.1.123:5173`，
  再「加入主畫面」即像 App。
- 正式打包：`npm run build` → 產出 `dist/`（靜態檔）。本機預覽：`npm run preview`（同樣 host 區網）。

## 線上版（GitHub Pages，已上線）

固定網址：**https://bricktw.github.io/korea-expense-tracker/**
（手機直接開→「加入主畫面」即可，不需電腦開機、不限區網。）

- 託管在**獨立的公開 repo** `bricktw/korea-expense-tracker`（主財務 repo 為私有，不對外）。
- 開發仍在本資料夾 `korea_trip/`（私有主 repo 內）。每次改完要更新線上版：

  ```bash
  # 在主 repo 根目錄
  git add korea_trip && git commit -m "update korea_trip"
  git subtree push --prefix=korea_trip pages main   # remote「pages」= 公開 repo
  ```

  推上去後，公開 repo 的 GitHub Actions（`.github/workflows/deploy.yml`）會自動 build + 部署，約 1 分鐘後生效。
- 若 `pages` remote 不存在：`git remote add pages https://github.com/bricktw/korea-expense-tracker.git`

> ⚠️ 安全提醒：線上版是**公開**的。填入 `WEB_APP_URL` 後 build 出去，等於把 Apps Script 端點公開
> （Apps Script 本就設「知道連結的任何人」可存取）。若擔心被亂寫，可在 `Code.gs` 與 App 加一個共用
> token 比對（需要時再做）。

## 部署 Google Sheet 後端（第一次設定）

1. 開啟試算表「韓國旅遊家庭記帳表」→「擴充功能」→「Apps Script」。
2. 把 `apps_script/Code.gs` 整段貼上、存檔。
3. 「部署」→「新增部署」→ 類型「網頁應用程式」：執行身分=**我**、存取權=**知道連結的任何人** → 部署 → 授權。
4. 複製「網頁應用程式 URL」，貼進 `src/App.jsx` 最上方的 `WEB_APP_URL`。
5. 改了 `Code.gs` 要重新部署：「管理部署 → 編輯 → 版本：新版本 → 部署」（URL 不變）。

> `WEB_APP_URL` 留空時，App 走純離線模式（只存手機 localStorage）。填入後即多人即時同步；
> 離線時記的帳會排入 queue，恢復連線（或按右上「同步」徽章）時自動補送。

## Google Sheet 欄位（「明細」分頁，由 Code.gs 自動建立 / 升級表頭）

`id / 行程 / 日期(YYYY-MM-DD) / 時間 / 記錄人 / 金額(原幣) / 匯率 / 台幣 / 付款方式 / 類別 / 備註 / 幣別`

- `記錄人` 直接存主系統 member_id：`dad` / `mom` / `amber`。
- `金額(原幣)` 依該趟幣別；`幣別` 記該筆原幣代碼（`KRW` / `JPY`）。
- `匯率` 逐筆固化（記帳當下的本趟匯率），統整時直接沿用 → 保留旅行當時的真實匯率。
- 表頭會自動升級：舊試算表（無「幣別」欄）下次被存取時，Code.gs 會就地補上尾端欄位，不動既有資料。

## 統整匯入主資料庫（每趟結束後）

回國後由**私有主財務系統**讀取本趟 Sheet 資料、換算後匯入。詳細欄位映射、幣別 migration 與去重邏輯
記在私有 repo 文件，不放在此公開 repo。

## TODO

- [x] Google Sheet 同步（Apps Script doPost/doGet）+ 行程切換 + 記錄人 + 可編輯匯率
- [x] GitHub Pages 上線
- [ ] 部署 Code.gs、填入 `WEB_APP_URL`（需使用者操作 Google 帳號）
- [ ] 匯出：CSV / 可貼群組的圖文摘要
- [ ] 分天顯示
- [ ] Google Sheet 自動統計分頁（QUERY / 樞紐）
