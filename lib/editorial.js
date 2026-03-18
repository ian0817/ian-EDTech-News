const fs = require('fs');
const path = require('path');
const { searchNews } = require('./news');
const { isVercel, blobPut, blobGet } = require('./blob');
const { callGroq } = require('./groq');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'editorial-cache.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'editorial-history.json');
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_HISTORY = 50;

const BLOB_CACHE_KEY = 'editorial-cache.json';
const BLOB_HISTORY_KEY = 'editorial-history.json';

// --- Storage abstraction ---

async function readCacheStore() {
  if (isVercel()) {
    const data = await blobGet(BLOB_CACHE_KEY);
    if (!data || !data.generatedAt) return null;
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL) return data;
    return null;
  }
  // Local file fallback
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL) return data;
  } catch {}
  return null;
}

async function readCacheRaw() {
  if (isVercel()) {
    return await blobGet(BLOB_CACHE_KEY);
  }
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch { return null; }
}

async function writeCacheStore(data) {
  if (isVercel()) {
    await blobPut(BLOB_CACHE_KEY, data);
    return;
  }
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

async function readHistoryStore() {
  if (isVercel()) {
    const data = await blobGet(BLOB_HISTORY_KEY);
    return Array.isArray(data) ? data : [];
  }
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch { return []; }
}

async function appendToHistoryStore(editorial) {
  try {
    const history = await readHistoryStore();
    history.unshift(editorial);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    if (isVercel()) {
      await blobPut(BLOB_HISTORY_KEY, history);
    } else {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    }
  } catch {}
}

const EDITORIAL_SYSTEM_PROMPT = `你是「Ian」，一位教育科技領域的主編與觀察者。你的寫作風格：
- 觀點犀利但不偏激，能看見趨勢背後的結構性意義
- 善於將科技新聞與教育現場連結，讓讀者理解「這跟我有什麼關係」
- 文字簡潔有力，不用華麗辭藻，像跟朋友分享見解
- 偶爾帶一點幽默感
- 使用繁體中文`;

async function generateEditorial(forceRefresh = false) {
  // Check cache first (skip if forced)
  if (!forceRefresh) {
    const cached = await readCacheStore();
    if (cached) return cached;
  }

  // Fetch latest news
  const queries = ['教育科技 EdTech', 'AI 教育', '數位學習'];
  const picked = queries[Math.floor(Math.random() * queries.length)];
  let articles;
  try {
    articles = await searchNews(picked);
  } catch {
    articles = [];
  }

  if (!articles.length) {
    throw new Error('無法取得最新新聞來生成評論');
  }

  // Pick top 5 headlines
  const headlines = articles.slice(0, 5).map((a, i) =>
    `${i + 1}. ${a.title}（${a.source || '未知來源'}，${a.pubDate ? new Date(a.pubDate).toLocaleDateString('zh-TW') : '日期不明'}）`
  ).join('\n');

  const prompt = `以下是今天教育科技領域的最新新聞標題：

${headlines}

請根據這些新聞，撰寫一篇「主編評論」：

嚴格要求：
1. 標題：一句話，15 字以內，直接點出具體事件或現象
2. 正文**嚴格控制在 300～350 字**，超過就刪減
3. 必須**直接引用至少 2 則新聞的具體內容**（人物、機構、數據、事件），不可空泛
4. 禁止寫「隨著...的發展」「在這個時代」「值得關注」等空話套話
5. 用具體案例帶出觀點，像在跟朋友說「你看這件事很有意思」
6. 結尾一句話給出明確的行動建議，不要模糊的「我們應該思考」
7. 最後另起一行，提出一個「反思提問」——一個跟這些時事直接相關的開放式問題，不給答案，讓讀者自己想。問題要具體、有刺激性，不要泛泛的「你怎麼看」

請用以下格式回覆：
標題：（一句話標題）
正文：（評論內容）
反思：（一個開放式問題）`;

  const result = await callGroq(EDITORIAL_SYSTEM_PROMPT, prompt);

  // Parse title, body, reflection
  let title = '';
  let body = result;
  let reflection = '';
  const titleMatch = result.match(/標題[：:]\s*(.+)/);
  const bodyMatch = result.match(/正文[：:]\s*([\s\S]+?)(?=反思[：:]|$)/);
  const reflectionMatch = result.match(/反思[：:]\s*(.+)/);
  if (titleMatch) title = titleMatch[1].trim();
  if (bodyMatch) body = bodyMatch[1].trim();
  if (reflectionMatch) reflection = reflectionMatch[1].trim();
  if (!title) {
    const lines = result.split('\n').filter(l => l.trim());
    title = lines[0] || '本週觀察';
    body = lines.slice(1).join('\n').trim() || result;
  }

  const editorial = {
    title,
    body,
    reflection,
    headlines: articles.slice(0, 5).map(a => ({ title: a.title, source: a.source, link: a.link })),
    generatedAt: new Date().toISOString(),
    query: picked
  };

  // Save previous editorial to history before overwriting
  try {
    const raw = await readCacheRaw();
    if (raw && raw.generatedAt) await appendToHistoryStore(raw);
  } catch {}

  await writeCacheStore(editorial);
  return editorial;
}

module.exports = { generateEditorial, readHistory: readHistoryStore };
