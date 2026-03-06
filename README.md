# ian's EdTech News

教育科技新聞聚合平台，即時搜尋台灣教育科技相關新聞，一站掌握數位學習最新動態。

**線上版本：** https://edtech-news.vercel.app

---

## 功能

- **關鍵字搜尋** — 輸入任意關鍵字，即時從 Bing News RSS 取得相關新聞
- **快捷標籤** — 預設 8 組教育科技主題（數位學習、EdTech、AI 教育、線上課程等），一鍵查詢
- **時效過濾** — 自動過濾超過 6 個月的舊聞，依發布時間由新到舊排列
- **來源顯示** — 每則新聞標示媒體來源，強化資訊可信度

## 架構總覽

```
edtech-news/
├── server.js          # Express 主程式（API + 靜態檔案）
├── vercel.json        # Vercel 部署設定
├── lib/
│   ├── news.js        # Bing News RSS 搜尋與解析
│   ├── scraper.js     # 網頁爬蟲（cheerio 擷取文章內文）
│   └── ollama.js      # Groq LLM API 串接（摘要生成）
├── public/
│   ├── index.html     # 前端頁面（單頁應用）
│   └── avatar.jpg     # 個人頭像
├── .env               # 環境變數（GROQ_API_KEY，不進版控）
└── package.json
```

## 資料流

```
使用者輸入關鍵字
    │
    ▼
GET /api/search?q=關鍵字
    │
    ▼
lib/news.js
    ├── 組合 Bing News RSS URL（含時效與排序參數）
    ├── HTTP GET 取得 XML
    ├── xml2js 解析為 JSON
    ├── 從 Bing 重導向 URL 提取真實文章連結
    ├── 過濾 > 6 個月的文章
    └── 依 pubDate 降冪排序，回傳前 20 筆
    │
    ▼
前端 index.html
    └── 渲染新聞卡片（來源、時間、標題、摘要）
```

## 技術選型與決策紀錄

### 為什麼用 Bing News 而非 Google News？

Google News RSS 回傳的文章 URL 是加密的 protobuf 編碼（`https://news.google.com/rss/articles/CBMi...`），無法直接解碼為原始連結。嘗試過 base64 解碼、protobuf 解析、curl -L 跟隨重導向等方式，均無法穩定取得真實 URL。

Bing News RSS 的 URL 格式為 `http://www.bing.com/news/apiclick.aspx?...&url=<encoded_real_url>&...`，可透過 query parameter 直接提取真實文章連結。

### 新聞時效控制

Bing RSS URL 加上 `qft=interval%3d"8"` 參數請求近期新聞，但 Bing 有時仍會回傳較舊的結果。因此在程式端額外做了兩層過濾：

1. **RSS 參數**：`qft=interval%3d"8"&sortby=date`（請求端）
2. **程式過濾**：`new Date(pubDate) >= sixMonthsAgo`（應用端）

### 部署架構

- **前端**：純 HTML/CSS/JS 單頁應用，由 Express 提供靜態檔案
- **後端**：Express 應用，透過 `vercel.json` 設定為 Vercel Serverless Function
- **LLM**：Groq 免費 API（llama-3.3-70b-versatile），用於文章摘要功能（後端保留，前端已移除按鈕）

### 為什麼用 Groq 而非本地 Ollama？

開發初期使用本地 Ollama（qwen3:8b），但部署到 Vercel 後無法使用本地模型。Groq 提供免費 API 額度，回應速度快，且 API 格式相容 OpenAI，遷移成本極低。

## 本地開發

### 環境需求

- Node.js >= 18

### 安裝與啟動

```bash
cd edtech-news
npm install

# 建立環境變數（摘要功能需要，純搜尋可省略）
echo "GROQ_API_KEY=your_key_here" > .env

# 啟動
node server.js
# 開啟 http://localhost:3000
```

### Groq API Key 取得

1. 前往 https://console.groq.com
2. 註冊帳號（免費）
3. 建立 API Key
4. 寫入 `.env` 檔案

## 部署到 Vercel

```bash
# 安裝 Vercel CLI
npm i -g vercel

# 首次部署（會引導登入與專案設定）
vercel

# 設定環境變數
vercel env add GROQ_API_KEY

# 正式部署
vercel --prod
```

之後每次 `git push` 到 GitHub，Vercel 會自動觸發重新部署。

## API 端點

| 方法 | 路徑 | 說明 | 參數 |
|------|------|------|------|
| GET | `/api/search` | 搜尋新聞 | `q` — 搜尋關鍵字（預設：數位學習 教育科技） |
| POST | `/api/summarize` | 擷取文章並生成摘要 | Body: `{ url, title }` |

### 回應範例

**GET /api/search?q=AI教育**

```json
{
  "ok": true,
  "articles": [
    {
      "title": "台南市推動AI教育",
      "link": "https://example.com/article",
      "source": "聯合新聞網",
      "pubDate": "Thu, 05 Mar 2026 19:45:00 GMT",
      "snippet": "台南市斥資24億推動生生有平板..."
    }
  ]
}
```

## 各模組說明

### `lib/news.js` — 新聞搜尋

- 使用 Bing News RSS API，市場設定為 `mkt=zh-TW`
- `extractRealUrl()` 從 Bing 重導向連結提取原始 URL
- 回傳結果經過 6 個月時效過濾 + 時間降冪排序

### `lib/scraper.js` — 網頁爬蟲

- 使用 cheerio 解析 HTML
- 依序嘗試常見文章選擇器（`article`、`[itemprop="articleBody"]`、`.article-content` 等）
- 移除廣告、導覽列、留言等雜訊元素
- 文章內文截斷至 3000 字以控制 LLM token 用量
- 支援 HTTP 重導向（最多 5 次）

### `lib/ollama.js` — LLM 摘要

- 串接 Groq API（OpenAI 相容格式）
- 使用 `llama-3.3-70b-versatile` 模型
- Prompt 設計：3~5 句概述、標出關鍵人物與數據、結尾給出教育科技啟示
- Temperature 0.3（偏保守，確保摘要準確）

### `public/index.html` — 前端介面

- 暗色主題，卡片式排版
- 歡迎畫面含個人頭像與引導提示
- 搜尋後頭像縮小移至右上角
- RWD 響應式設計（`grid-template-columns: repeat(auto-fill, minmax(340px, 1fr))`）
- 純 Vanilla JS，無框架依賴

## License

MIT
