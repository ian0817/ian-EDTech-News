const https = require('https');
const fs = require('fs');
const path = require('path');
const { searchNews } = require('./news');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const CACHE_FILE = path.join(__dirname, '..', 'data', 'editorial-cache.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'editorial-history.json');
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const MAX_HISTORY = 50;

function getApiKey() {
  return process.env.GROQ_API_KEY || '';
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL) return data;
  } catch {}
  return null;
}

function writeCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch { return []; }
}

function appendToHistory(editorial) {
  try {
    const history = readHistory();
    history.unshift(editorial);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch {}
}

async function callGroq(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `你是「Ian」，一位教育科技領域的主編與觀察者。你的寫作風格：
- 觀點犀利但不偏激，能看見趨勢背後的結構性意義
- 善於將科技新聞與教育現場連結，讓讀者理解「這跟我有什麼關係」
- 文字簡潔有力，不用華麗辭藻，像跟朋友分享見解
- 偶爾帶一點幽默感
- 使用繁體中文`
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 600,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(GROQ_API_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (data.choices && data.choices[0]) {
            resolve(data.choices[0].message.content);
          } else if (data.error) {
            reject(new Error(data.error.message));
          } else {
            reject(new Error('Unexpected Groq response'));
          }
        } catch (e) {
          reject(new Error('Groq response parse error'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(body);
    req.end();
  });
}

async function generateEditorial() {
  // Check cache first
  const cached = readCache();
  if (cached) return cached;

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

  const result = await callGroq(prompt);

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
    const raw = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) : null;
    if (raw && raw.generatedAt) appendToHistory(raw);
  } catch {}

  writeCache(editorial);
  return editorial;
}

module.exports = { generateEditorial, readHistory };
