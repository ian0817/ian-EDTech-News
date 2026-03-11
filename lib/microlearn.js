const https = require('https');
const fs = require('fs');
const path = require('path');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const CACHE_FILE = path.join(__dirname, '..', 'data', 'microlearn-cache.json');
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'microlearn-history.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_HISTORY = 30;

// Blob storage keys
const BLOB_CACHE_KEY = 'microlearn-cache.json';
const BLOB_HISTORY_KEY = 'microlearn-history.json';

function isVercel() {
  return !!process.env.VERCEL;
}

function getBlobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN || '';
}

// --- Blob helpers ---

async function blobPut(key, data) {
  const { put } = require('@vercel/blob');
  const json = JSON.stringify(data, null, 2);
  await put(key, json, { access: 'public', addRandomSuffix: false, allowOverwrite: true, token: getBlobToken() });
}

async function blobGet(key) {
  const { list } = require('@vercel/blob');
  try {
    const { blobs } = await list({ prefix: key, limit: 1, token: getBlobToken() });
    if (!blobs.length) return null;
    const resp = await fetch(blobs[0].url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// --- Storage abstraction ---

async function readCacheStore() {
  if (isVercel()) {
    const data = await blobGet(BLOB_CACHE_KEY);
    if (!data || !data.generatedAt) return null;
    if (Date.now() - new Date(data.generatedAt).getTime() < CACHE_TTL) return data;
    return null;
  }
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
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8'); } catch {}
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

async function appendToHistoryStore(card) {
  try {
    const history = await readHistoryStore();
    history.unshift(card);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    if (isVercel()) {
      await blobPut(BLOB_HISTORY_KEY, history);
    } else {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
    }
  } catch {}
}

const TOPICS = [
  'SAMR 模型', 'TPACK 框架', 'Bloom 數位分類學', '翻轉教室',
  '遊戲化教學', '差異化教學', 'UDL 通用學習設計', '形成性評量',
  '學習分析 Learning Analytics', '適性學習 Adaptive Learning',
  '微學習 Microlearning', '混成學習 Blended Learning',
  'OER 開放教育資源', 'MOOC 大規模開放課程', 'LMS 學習管理系統',
  'xAPI 經驗 API', '數位素養', '運算思維', 'STEAM 教育',
  'PBL 問題導向學習', '自主學習策略', '同儕評量',
  '教育科技倫理', 'AI 輔助評量', '數位徽章 Digital Badge',
  '社會情緒學習 SEL', '後設認知', '鷹架理論 Scaffolding',
  '建構主義教學', '情境學習理論',
];

function getApiKey() {
  return process.env.GROQ_API_KEY || '';
}

async function callGroq(prompt) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: `你是一位教育科技專家，擅長用簡單易懂的方式解釋複雜的教育理論和科技概念。
- 使用繁體中文
- 語氣親切但專業，像老師在課後跟學生聊天
- 舉例要貼近台灣教育現場`
      },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 500,
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
          if (data.choices && data.choices[0]) resolve(data.choices[0].message.content);
          else if (data.error) reject(new Error(data.error.message));
          else reject(new Error('Unexpected Groq response'));
        } catch (e) { reject(new Error('Groq parse error')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(body);
    req.end();
  });
}

async function pickTopic() {
  const history = await readHistoryStore();
  const recent = new Set(history.slice(0, 10).map(h => h.topic));
  const available = TOPICS.filter(t => !recent.has(t));
  const pool = available.length > 0 ? available : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function generateCard(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await readCacheStore();
    if (cached) return cached;
  }

  const topic = await pickTopic();

  const prompt = `請針對「${topic}」這個教育科技概念，製作一張知識卡片。

格式要求：
問題：用一個引人好奇的問題開場（15-25 字），讓讀者想知道答案
答案：用 80-120 字解釋這個概念，必須包含：
  1. 一句話定義
  2. 一個具體的教學應用場景（台灣課堂情境）
  3. 為什麼老師/學生應該關心這件事
延伸：推薦一個可以深入了解的方向或資源（一句話）

請嚴格用以下格式回覆：
問題：（問題內容）
答案：（答案內容）
延伸：（延伸內容）`;

  const result = await callGroq(prompt);

  let question = '', answer = '', further = '';
  const qMatch = result.match(/問題[：:]\s*(.+)/);
  const aMatch = result.match(/答案[：:]\s*([\s\S]+?)(?=延伸[：:]|$)/);
  const fMatch = result.match(/延伸[：:]\s*(.+)/);
  if (qMatch) question = qMatch[1].trim();
  if (aMatch) answer = aMatch[1].trim();
  if (fMatch) further = fMatch[1].trim();

  if (!question) {
    const lines = result.split('\n').filter(l => l.trim());
    question = lines[0] || topic;
    answer = lines.slice(1).join('\n').trim() || result;
  }

  const card = {
    topic,
    question,
    answer,
    further,
    generatedAt: new Date().toISOString(),
  };

  // Save previous to history
  try {
    const prev = await readCacheRaw();
    if (prev && prev.generatedAt) await appendToHistoryStore(prev);
  } catch {}

  await writeCacheStore(card);
  return card;
}

module.exports = { generateCard, readHistory: readHistoryStore };
