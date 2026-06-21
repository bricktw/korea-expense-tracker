# 韓國旅遊家庭記帳（korea_trip）

主財務系統（Family_finance_manage）底下的獨立小模組。用途：兩趟韓國旅行**分開**即時記帳，
回國後再**統整匯入**主資料庫的 `transactions`。

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
- 正式打包：`npm run build` → 產出 `dist/`（靜態檔，可丟 Netlify / GitHub Pages / 任何靜態空間取得固定網址）。
  本機預覽打包結果：`npm run preview`（同樣 host 區網）。

## 部署 Google Sheet 後端（第一次設定）

1. 開啟試算表「韓國旅遊家庭記帳表」→「擴充功能」→「Apps Script」。
2. 把 `apps_script/Code.gs` 整段貼上、存檔。
3. 「部署」→「新增部署」→ 類型「網頁應用程式」：執行身分=**我**、存取權=**知道連結的任何人** → 部署 → 授權。
4. 複製「網頁應用程式 URL」，貼進 `src/App.jsx` 最上方的 `WEB_APP_URL`。
5. 改了 `Code.gs` 要重新部署：「管理部署 → 編輯 → 版本：新版本 → 部署」（URL 不變）。

> `WEB_APP_URL` 留空時，App 走純離線模式（只存手機 localStorage）。填入後即多人即時同步；
> 離線時記的帳會排入 queue，恢復連線（或按右上「同步」徽章）時自動補送。

## Google Sheet 欄位（「明細」分頁，由 Code.gs 自動建立表頭）

`id / 行程 / 日期(YYYY-MM-DD) / 時間 / 記錄人 / 金額(韓圜) / 匯率 / 台幣 / 付款方式 / 類別 / 備註`

- `記錄人` 直接存主系統 member_id：`dad` / `mom` / `amber`。
- `匯率` 逐筆固化（記帳當下的本趟匯率），統整時直接沿用 → 保留旅行當時的真實匯率。

## 統整匯入主資料庫（每趟結束後，待實作）

目標：把某一趟的 Sheet 資料寫進主系統 `transactions`。

**前置一次性 migration**：主系統 `currency_code` ENUM 目前只有 `TWD/USD/JPY`，需新增 `KRW`：

```sql
ALTER TYPE currency_code ADD VALUE IF NOT EXISTS 'KRW';
-- 若要存韓圜匯率歷史，另放寬 exchange_rates.currency_pair CHECK 加 'KRW/TWD'
```

**欄位映射**（Sheet → transactions）：

| Sheet | transactions | 備註 |
|-------|--------------|------|
| 金額(韓圜) | `original_amount` | `original_currency = 'KRW'` |
| 匯率 | `exchange_rate_snapshot` | 沿用逐筆固化匯率（非匯入當下匯率） |
| 台幣 | `base_amount_twd` | = 金額 × 匯率 |
| 記錄人 | `payer_id` / `created_by` | dad/mom/amber（全支付綁帳戶者亦同，可微調） |
| 付款方式 | `payment_method` | 現金 / Line Pay / 全支付（自由文字，直接帶入） |
| 行程 + 備註 | `item_name` | 例：`[韓國第一趟] 弘大炸雞` |
| 日期 + 時間 | `timestamp` | 旅行當下日期時間 |
| 類別 | `category_id` | 依下表對應 |

**類別對應**（App → 主系統）：餐飲→食、交通→行、住宿→住、景點→樂、其他→其他；
購物→其他（電子產品可改 3C），匯入時可調整。

**去重**：以 Sheet 的 `id` 為冪等鍵（沿用 einvoice 匯入的去重模式），重跑不會重複寫入。

> 注意：這偏離主系統「補登交易用補登當下即時匯率」的規則 —— 旅行外幣應鎖在消費當下的匯率，
> 故刻意沿用逐筆匯率。

## TODO

- [x] Google Sheet 同步（Apps Script doPost/doGet）+ 行程切換 + 記錄人 + 可編輯匯率
- [ ] 部署 Code.gs、填入 `WEB_APP_URL`（需使用者操作 Google 帳號）
- [ ] `app/services/travel_import.py`：讀 Sheet → 映射 → 寫 transactions（含 KRW migration）
- [ ] 匯出：CSV / 可貼群組的圖文摘要
- [ ] 分天顯示
- [ ] Google Sheet 自動統計分頁（QUERY / 樞紐）
