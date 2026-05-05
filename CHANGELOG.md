# Changelog

## 2026-05-04

### 專利追蹤 — Cron 逾時修復 + 手動更新

**問題根因：**
- TIPO 爬取 24 個關鍵字需 ~84 秒，超過 Vercel 預設 60 秒函數上限，每次 Cron 都在完成前被砍掉
- `/api/cron/patents` 用 `getPatents()` 做新鮮度判斷，當 cache 過期時會觸發雙重 refresh 並回報 "skipped"

**修正：**
- `vercel.json` 加入 `functions.server.js.maxDuration: 300`，允許函數跑最多 5 分鐘
- `server.js` `/api/cron/patents` 改用 `readCache()` 判斷 cache 新鮮度，避免雙重 refresh
- `lib/patents.js` export `readCache` 供 server.js 使用
- 本地執行 `refreshPatents()` 更新 `data/patents-cache.json`（updatedAt: 2026-05-04）

**說明：**
- 四/五月無新專利是 TIPO 資料問題（申請到公告有數月延遲），非系統 bug
- Cron 每週一 12:00 UTC 自動執行，現在可正常在 timeout 內完成
- `functions` key 與 `builds` 互斥（PM-028），maxDuration 須改放 `builds[].config` 內
- Vercel 優先讀 Blob，手動更新須打 `/api/patents/refresh?token=` 才能寫入 Blob 生效，光 redeploy 無效

## 2026-04-20

### conferences.js — 新增學術活動爬蟲來源

**新增爬蟲：**
- **CCU**（中正大學-成人及繼續教育學系）：`cyiaace.ccu.edu.tw/p/403-1243-4617-{N}.php`，最多 5 頁，article link: `div.mtitle > a[href*="406-1243-"]`，標題取 link 文字（title 屬性為「原頁面開啟」不可用）
- **CACET/ICEET**（數位學習與教育科技國際研討會）：`cacet.org/iceet-zh`，單一年會網站，以年份建 stable ID 防重複觸發

**新增機制：**
- `deduplicateByTitle()` — 跨來源標題去重，移除年份/第N屆後 normalize，相同研討會只保留第一筆
- `EXCLUDE_KEYWORDS` 加入 `'徵稿'`、`'徵求論文'`、`'Call for Papers'`、`'CFP'`，確保徵稿公告不混入研討會列表

**說明：**
- 台東大學研究發展處（NTTU）為原有來源，使用者確認此次不需重複新增
- `refreshConferences()` 改為 `Promise.allSettled` 同時跑四個 scraper，`sources` 欄位新增 `ccu`、`cacet` 計數

### 追加（同日）— TIPO 爬蟲架構重建

**新發現的根本原因：**
1. TIPO session INFO token 硬編碼過期 → 爬蟲回傳 session timeout，0 筆
2. Vercel IP 被 TIPO Cloudflare 封鎖（403）→ Vercel Cron 永遠無法爬 TIPO

**修正：**
- `lib/patents.js`：加 Step 0 `getTIPOSession()` 先 GET 首頁取得有效 INFO token
- `lib/patents.js`：新增關鍵字（元宇宙教育、人工智慧教學/學習、自適應學習、考題生成）
- `server.js`：新增 `/api/patents/import-bundled`（本機爬完 deploy 後呼叫，寫 bundled cache → Blob）
- `server.js`：移除 patents Cron endpoint（Vercel 永遠連不到 TIPO）
- `vercel.json`：移除 patents cron schedule
- `scripts/refresh-patents.sh`：本機一鍵更新腳本（爬取→commit→deploy→sync Blob）

**結果：** 99 筆專利，月份更新至 2026-05

### 追加（同日）— 發明人/狀態重複修正

**問題：** 展開欄位後 `td.sumtd2_IN`、`td.sumtd2_LS` 在同一 `<tr>` 內有多個 cell，cheerio `.text()` 串接全部導致重複顯示

**修正：**
- `status`：改用 `.first().text().split('\n')[0]` 只取第一個非空值
- `inventors`：加 `[...new Set(...)]` 去重

**結果：** 95 筆，發明人/狀態各只顯示一次，四月五月資料正確
