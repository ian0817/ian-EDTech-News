# Changelog

## 2026-04-20

### conferences.js — 新增學術活動爬蟲來源

**新增爬蟲：**
- **CCU**（中正大學-成人及繼續教育學系）：`cyiaace.ccu.edu.tw/p/403-1243-4617-{N}.php`，最多 5 頁，同 NTTU 模式（list page → article page 取日期），article link pattern: `a[href*="405-1243-"]`
- **CACET/ICEET**（數位學習與教育科技國際研討會）：`cacet.org/iceet-zh`，單一年會網站，以年份建 stable ID 防重複觸發

**新增機制：**
- `deduplicateByTitle()` — 跨來源標題去重，移除年份/第N屆後 normalize，相同研討會只保留第一筆
- `EXCLUDE_KEYWORDS` 加入 `'徵稿'`、`'徵求論文'`、`'Call for Papers'`、`'CFP'`，確保徵稿公告不混入研討會列表

**說明：**
- 台東大學研究發展處（NTTU）為原有來源，使用者確認此次不需重複新增
- `refreshConferences()` 改為 `Promise.allSettled` 同時跑四個 scraper，`sources` 欄位新增 `ccu`、`cacet` 計數
