# Changelog

## 2026-06-08 (fix)

### 本機 LaunchAgent 排程修復（每日 09:00）

**問題：**
- GitHub Actions IP 被 TIPO Cloudflare WAF 封鎖，session init 失敗（34 個關鍵字全部 error）
- 爬蟲完全無法從 GitHub Actions 連接 tiponet.tipo.gov.tw

**根本原因：**
- TIPO 的 Cloudflare WAF 封鎖 GitHub Actions IP range，和之前封鎖 Vercel 的原因相同
- `getPage` 不送 Accept-Encoding，TIPO 回傳明文（無壓縮問題）
- `lib/patents.js` 的表單欄位（`_5_5_T` 等）本身是正確的，無需修改

**修復：**
- 新增 `~/Library/LaunchAgents/com.edtech.refresh-patents.plist`，每日 09:00 從本機執行 `refresh-patents.sh`
- 本機 IP 不在 TIPO Cloudflare 封鎖名單，爬蟲可正常執行
- 驗證：手動觸發成功，找到 1 筆新專利（M682873 護理學習電子裝置），total 330→331

**六月專利現況（2026-06-08）：**
- 六月一日公告批次：0 筆 EdTech 相關（14 個教育關鍵字全部無符合條件）
- TIPO 每週公告，下批 6/8 已納入本次爬取

## 2026-06-04 (fix)

### 專利爬蟲改由 GitHub Actions 排程

**問題：**
- Vercel IP 自 2026-04-20 起被 TIPO Cloudflare 封鎖（403），Vercel Cron 爬取永遠失敗
- 2026-05-25 誤將 `/api/cron/patents` 加回 vercel.json，導致每週假性更新 updatedAt 但實際無新資料，下次 cron 因 age < 6d 直接 skip，形成無限迴圈
- `refreshPatents()` 在 0 筆結果時仍無條件呼叫 `writeCache()`，偽造 updatedAt

**修正：**
- 新增 `.github/workflows/refresh-patents.yml`：每週一 02:00 UTC 以 GitHub IP 爬 TIPO，commit cache → Vercel 部署 → sync Blob；支援 `workflow_dispatch` 手動觸發
- `lib/patents.js`：`refreshPatents()` 在 `newItems.length === 0 && existing.length > 0` 時直接 return cached，不觸發 `writeCache()`
- `vercel.json`：移除 `/api/cron/patents` cron 條目

**需要設定的 GitHub Secrets：**
- `VERCEL_TOKEN`
- `GROQ_API_KEY`

## 2026-05-25 (fix)

### lib/patents.js — 修正 TIPO 爬蟲缺分頁 + 新增 vercel.json cron

**問題：**
- `fetchTIPOExpanded` 每個關鍵字只抓第一頁（10 筆），導致 99 筆後無法成長
- TIPO 對「數位學習」有 422 筆，但只抓到前 10 筆
- `vercel.json` 缺少 `/api/cron/patents` 排程，Vercel 從未自動更新

**修正：**
- `fetchTIPOExpanded(keyword, existingIds)` 加分頁：以 `JPAGE` + `BUTTON: 'GO'` 翻頁
- 每個關鍵字最多抓 5 頁（50 筆），若整頁全是 cache 已有資料則提早停止
- `fetchTIPO` 呼叫端傳入 `existingIds` 讓分頁提早終止邏輯正確運作
- `vercel.json` 新增 `"/api/cron/patents"` 每週二 10:00 自動執行

## 2026-05-05 (fix-2)

### patents.html — 修正卡片顯示 [object Object] + section label 白色

**問題：** 專利卡片顯示「[object Object]」，因 `insight` 欄位由字串改物件後卡片渲染未更新。

**修正：**
- 卡片預覽改用 `report.what` 第一句（新格式），fallback 舊字串 `insight`
- 分析 section label 字色改為白色（`#fff`）

## 2026-05-05 (feat-2)

### patents.html — 完整情資報告 UI（對標簡報分析架構）

**新增：**
- Dialog 全面升級，結構對標 2026 五月專利情資.pptx：
  - **做什麼** — 一句核心說明 + 要點列表
  - **為什麼重要** — 藍色標題 + 市場意義說明
  - **技術領先功能** — 綠色標籤膠囊
  - **系統架構圖（依專利說明書）** — monospace 文字流程圖
  - **市場 Insight 訊號** — 4 張色碼卡片（橘/紫/綠/金），各含 TAG、標題、說明
- `scripts/generate-all-analysis.js`：完整情資 bulk 生成腳本，自動跳過已生成筆數

**說明：**
- Groq free tier 限制：llama-3.3-70b 每日 100k token，llama-3.1-8b 每分鐘 6k token
- 需 16s delay 以符合 TPM 限制，96 筆分兩批跑完（約 30 分鐘）

## 2026-05-05 (feat)

### patents.html — 加入四維情資報告 + 完整摘要顯示

**新增：**
- Dialog 新增「專利摘要」section（帶 label 的深色框，完整顯示）
- Dialog 新增「情資報告」四卡片區塊：競爭者/市場訊號（橘）、技術成熟度（藍）、商業趨勢（綠）、護城河分析（金）
- `lib/patents.js`：`generateInsights` 改為四維 JSON 格式，每筆 insight 存為 `{competitor, maturity, trend, moat}` 物件
- `scripts/generate-all-insights.js`：一次性為全部既有專利 bulk 生成情資，96/96 成功

**說明：**
- Blob 更新需呼叫兩次 `/api/patents/import-bundled`（首次 Vercel 可能 hit module cache 舊資料）

## 2026-05-05 (fix)

### patents.html — 修正簡介內容重複顯示

**問題：** 卡片已顯示 `abstract`，點開「詳細資料」dialog 又再顯示一次，造成重複。

**修正：** 移除卡片中的 `abstractHtml`，摘要只在 detail dialog 呈現；卡片只保留 `insight` 作為預覽。

### patents.js + cache — 修正 dialog 摘要重複 12 次

**問題：** 點開「詳細資料」後，摘要文字重複顯示 12 次（Playwright 驗證發現）。

**根因：** `lib/patents.js` 的 `td.sumtd2_AB` 未加 `.first()`，TIPO 展開視圖同一 `<tr>` 有多個同名 cell，cheerio `.text()` 串接全部，導致 abstract 重複 N 次寫入 cache。與 PM-031（status/inventors 同根因）相同，當時漏修 abstract。

**修正：**
- `lib/patents.js`：`row.find('td.sumtd2_AB').first().text()` 防止未來再發生
- `data/patents-cache.json`：直接修復既有 91 筆重複資料（BOM 分割去重）
- Blob sync：`/api/patents/import-bundled` 重新同步至 Vercel Blob

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
