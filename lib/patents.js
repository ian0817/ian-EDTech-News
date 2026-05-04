const https = require('https');
const cheerio = require('cheerio');
const querystring = require('querystring');
const fs = require('fs');
const path = require('path');

const { isVercel, blobPut, blobGet } = require('./blob');
const { callGroq, getApiKey } = require('./groq');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'patents-cache.json');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const BLOB_CACHE_KEY = 'patents-cache.json';

// TIPO TWPAT3 search keywords (Chinese)
const SEARCH_KEYWORDS = [
  // 核心教育
  '數位學習', '教育科技', '教學平台', '學習平台', '智慧教育',
  '線上測驗', '線上評量', '自動批改', '出題系統', '校務系統',
  '教學系統', '學習系統',
  // AI/互動/輔助
  '互動教學', '智慧教學', '教學輔助', '學習輔助',
  '適性學習', '教育機器人', '課堂互動', '學習分析',
  '教學評量', '智慧課堂', '教學機器人', '聊天機器人教學',
  // 新興 AI 教育
  '元宇宙教育', '人工智慧教學', '人工智慧學習', '生成式AI教育',
  '自適應學習', '考題生成', 'AI教學', 'AI學習',
];

// Map keywords to categories for frontend filtering
const KEYWORD_CATEGORIES = {
  '學習': ['數位學習', '學習平台', '智慧教育', '學習系統', '適性學習', '學習輔助', '學習分析'],
  '教學': ['教育科技', '教學平台', '教學系統', '互動教學', '智慧教學', '教學輔助', '智慧課堂', '課堂互動', '教學機器人', '聊天機器人教學'],
  '考試評測': ['線上測驗', '線上評量', '自動批改', '出題系統', '教學評量'],
  '校務': ['校務系統'],
};

// Exclude non-education patents (machine learning, semiconductor, etc.)
const EXCLUDE_TERMS = [
  '基板', '半導體', '晶片', '晶圓', '蝕刻', '光罩', '電池',
  '積體電路', '記憶體', '顯示裝置', '觸控面板',
  '車輛', '引擎', '馬達', '泵浦', '閥', '管路',
  '醫療', '醫學', '藥物', '手術', '診斷', '治療',
  '食品', '飲料', '化妝品', '農業', '養殖',
  '建築', '土木', '橋梁', '鋼構',
  '紡織', '纖維', '染料', '塗料',
  '光線追蹤', '圖形處理', '基板製造', '基板處理',
  '導線', '焊接', '封裝', '散熱',
];

function isEducationRelated(title) {
  // Strong education indicators - if present, always include
  const strongTerms = ['教學', '教育', '課程', '學校', '學生', '老師', '教師',
    '考試', '測驗', '評量', '評測', '出題', '批改', '校務',
    '數位學習', '線上學習', '遠距教學', '互動教學',
    '教學平台', '學習平台', '教學系統', '學習系統',
    '教材', '教案', '學習輔助', '教育訓練',
    '適性學習', '智慧教學', '智慧課堂', '課堂互動',
    '教學機器人', '教育機器人', '學習分析', '教學評量'];
  const hasStrong = strongTerms.some(t => title.includes(t));
  if (hasStrong) return true;

  // AI/互動 terms — include if combined with interaction/analysis context
  const aiTerms = ['聊天機器人', '互動分析', '互動系統', '智慧輔助', '自適應'];
  const hasAi = aiTerms.some(t => title.includes(t));
  if (hasAi) {
    const excluded = EXCLUDE_TERMS.some(t => title.includes(t));
    if (!excluded) return true;
  }

  // If only contains generic "學習" without education context, check exclusions
  if (title.includes('學習')) {
    const excluded = EXCLUDE_TERMS.some(t => title.includes(t));
    if (excluded) return false;
    // "機器學習" alone is not education
    if (title.includes('機器學習') && !strongTerms.some(t => title.includes(t))) return false;
    return true;
  }

  return false;
}

function categorizeByTitle(title) {
  const categories = new Set();
  const matched = [];
  for (const [cat, keywords] of Object.entries(KEYWORD_CATEGORIES)) {
    for (const kw of keywords) {
      if (title.includes(kw)) {
        categories.add(cat);
        matched.push(kw);
      }
    }
  }
  // Default: check broader terms
  if (!categories.size) {
    if (title.includes('學習') || title.includes('教育')) categories.add('學習');
    if (title.includes('教學')) categories.add('教學');
    if (title.includes('考試') || title.includes('測驗') || title.includes('評量') || title.includes('批改') || title.includes('出題')) categories.add('考試評測');
    if (title.includes('校務')) categories.add('校務');
  }
  if (!categories.size) categories.add('教學'); // fallback
  return { categories: [...categories], matchedKeywords: [...new Set(matched)] };
}

// ── Cache ──

// Bundled cache loaded via require so @vercel/node includes it in the bundle
let bundledCache = null;
try { bundledCache = require('../data/patents-cache.json'); } catch {}

async function readCache() {
  // Try Blob first on Vercel
  if (isVercel()) {
    try {
      const blob = await blobGet(BLOB_CACHE_KEY);
      if (blob && blob.patents && blob.patents.length) return blob;
    } catch {}
    // Fall back to bundled cache
    if (bundledCache) return bundledCache;
  }
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch { return null; }
}

async function writeCache(data) {
  if (isVercel()) {
    await blobPut(BLOB_CACHE_KEY, data);
    return;
  }
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

// ── HTTP helpers ──

function postForm(hostname, formPath, formData, timeoutMs = 10000, returnCookies = false, cookies = '') {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(formData);
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'zh-TW,zh;q=0.9',
    };
    if (cookies) headers['Cookie'] = cookies;
    const req = https.request({
      hostname,
      path: formPath,
      method: 'POST',
      headers,
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        if (returnCookies) {
          const setCookies = res.headers['set-cookie'] || [];
          resolve({ body: html, cookies: setCookies.map(c => c.split(';')[0]).join('; ') });
        } else {
          resolve(html);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function getPage(hostname, pagePath, cookies = '', timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html',
      'Accept-Language': 'zh-TW,zh;q=0.9',
    };
    if (cookies) headers['Cookie'] = cookies;
    const req = https.request({ hostname, path: pagePath, method: 'GET', headers, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        const setCookies = res.headers['set-cookie'] || [];
        resolve({ html, cookies: setCookies.map(c => c.split(';')[0]).join('; ') });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── TIPO TWPAT3 Scraper ──

function parseTWPATResults(html) {
  const $ = cheerio.load(html);
  const patents = [];

  // Use CSS class selectors for reliable parsing regardless of column order
  // Each patent is in a row containing td.sumtd2_PN, td.sumtd2_TI, etc.
  $('td.sumtd2_PN').each((_, pnCell) => {
    const row = $(pnCell).closest('tr');
    const patentNumber = $(pnCell).text().trim();
    const title = row.find('td.sumtd2_TI').text().trim();
    if (!patentNumber || !title) return;

    const pubDateRaw = row.find('td.sumtd2_ID').text().trim();
    const appNumber = row.find('td.sumtd2_AN').text().trim();
    const appDateRaw = row.find('td.sumtd2_AD').text().trim();
    const status = row.find('td.sumtd2_LS').first().text().trim().split(/\n/)[0].trim();

    // Extract inventors (發明人) — keep only Chinese names
    const inventorsRaw = row.find('td.sumtd2_IN').text().trim();
    const inventors = inventorsRaw
      ? [...new Set(
          inventorsRaw.split(/[;\n]/)
            .map(s => s.replace(/\(.*?\)/g, '').trim())
            .filter(s => /[\u4e00-\u9fff]/.test(s))
            .map(s => s.replace(/[A-Z,.\-\s]+$/g, '').trim())
            .filter(s => s.length > 0)
        )]
      : [];

    // Extract abstract (摘要)
    const abstract = row.find('td.sumtd2_AB').text().trim().replace(/^\uFEFF/, '');


    // Normalize dates: YYYY/MM/DD → YYYY-MM-DD
    const pubDate = pubDateRaw.replace(/\//g, '-');
    const appDate = appDateRaw.replace(/\//g, '-');

    // Determine patent type from number prefix
    let patentType = '發明';
    if (patentNumber.startsWith('M')) patentType = '新型';
    else if (patentNumber.startsWith('D')) patentType = '設計';

    // Build detail URL
    const detailUrl = `https://tiponet.tipo.gov.tw/twpat3/twpatc/twpatkm?@@0.0^${patentNumber}`;

    patents.push({
      patentNumber, title, pubDate, appNumber, appDate, status, patentType,
      detailUrl, inventors, abstract,
    });
  });

  // Fallback: if no CSS-class-based cells found, try legacy positional parsing
  if (!patents.length) {
    $('tr').each((_, row) => {
      const cells = [];
      $(row).find('td').each((_, td) => { cells.push($(td).text().trim()); });
      if (cells.length < 6) return;
      if (!/^\d+$/.test(cells[0])) return;
      const patentNumber = cells[1] || '';
      const title = cells[5] || '';
      if (!patentNumber || !title) return;
      let patentType = '發明';
      if (patentNumber.startsWith('M')) patentType = '新型';
      else if (patentNumber.startsWith('D')) patentType = '設計';
      patents.push({
        patentNumber, title,
        pubDate: (cells[2] || '').replace(/\//g, '-'),
        appNumber: cells[3] || '',
        appDate: (cells[4] || '').replace(/\//g, '-'),
        status: cells[cells.length - 1] || '',
        patentType,
        detailUrl: `https://tiponet.tipo.gov.tw/twpat3/twpatc/twpatkm?@@0.0^${patentNumber}`,
        inventors: [], abstract: '',
      });
    });
  }

  return patents;
}

// Cached session for TIPO (reuse within one fetchTIPO() call)
let tipoSession = null;

async function getTIPOSession(timeoutMs = 10000) {
  if (tipoSession) return tipoSession;
  const r = await getPage('tiponet.tipo.gov.tw', '/twpat3/twpatc/twpatkm?@@1674640309', '', timeoutMs);
  const infoMatch = r.html.match(/name=INFO\s+value=([0-9a-fA-F]+)/);
  const actionMatch = r.html.match(/action="(\/twpat3\/twpatc\/twpatkm\?@@[^"]+)"/);
  if (!infoMatch || !actionMatch) throw new Error('TIPO session init failed: INFO or action not found');
  tipoSession = { info: infoMatch[1], action: actionMatch[1], cookies: r.cookies };
  return tipoSession;
}

// Three-step TIPO fetch: init session → search → expand display columns
async function fetchTIPOExpanded(keyword, timeoutMs = 15000) {
  // Step 0: get valid session INFO token and form action
  const session = await getTIPOSession();

  // Step 1: keyword search
  const searchData = {
    'INFO': session.info,
    'BUTTON': '檢索',
    '@_5_5_T': 'T_XX',
    '_5_5_T': keyword,
    '@_5_6_K': 'K_DATETYPE',
    '@_5_7_T': 'T_XX',
    '_5_7_T': '',
    '@_5_8_T': 'T_XX',
    '_5_8_T': '',
  };

  const searchHtml = await postForm(
    'tiponet.tipo.gov.tw',
    session.action,
    searchData,
    timeoutMs,
    true,
    session.cookies,
  );

  const html1 = searchHtml.body || searchHtml;
  const cookies = searchHtml.cookies || '';

  // Extract form action and INFO for step 2
  const actionMatch = html1.match(/action="([^"]+)"/);
  const infoMatch = html1.match(/name=INFO value=([0-9a-fA-F]+)/);

  if (!actionMatch || !infoMatch) {
    // Fall back to parsing step 1 results directly
    return parseTWPATResults(html1);
  }

  // Step 2: re-submit with expanded display columns
  const expandData = {
    'INFO': infoMatch[1],
    'BUTTON': '顯示結果',
    '_0_11_S_IN': 'on',   // 發明人
    '_0_11_S_AB': 'on',   // 摘要
    '_0_11_S_LS': 'on',   // 案件狀態
  };

  const expandHtml = await postForm(
    'tiponet.tipo.gov.tw',
    actionMatch[1],
    expandData,
    timeoutMs,
    false,
    cookies,
  );

  return parseTWPATResults(expandHtml);
}

async function fetchTIPO(existingIds) {
  tipoSession = null; // reset session cache for fresh login each refresh
  const results = [];
  const seenNumbers = new Set();

  for (const keyword of SEARCH_KEYWORDS) {
    try {
      const patents = await fetchTIPOExpanded(keyword);

      for (const p of patents) {
        if (seenNumbers.has(p.patentNumber)) continue;
        seenNumbers.add(p.patentNumber);

        const id = `tipo-${p.patentNumber}`;
        if (existingIds.has(id)) continue;

        // Filter: must be education-related
        if (!isEducationRelated(p.title)) continue;

        const { categories, matchedKeywords } = categorizeByTitle(p.title);

        results.push({
          id,
          title: p.title,
          patentNumber: p.patentNumber,
          filingDate: p.appDate,
          publicationDate: p.pubDate,
          url: p.detailUrl,
          source: 'TIPO',
          patentType: p.patentType,
          inventors: p.inventors,
          abstract: p.abstract,
          classifications: [],
          matchedKeywords: matchedKeywords.length ? matchedKeywords : [keyword],
          categories,
          status: p.status,
          scrapedAt: new Date().toISOString(),
        });
      }

      await delay(800); // Be polite to TIPO (slightly longer for 2-step)
    } catch (err) {
      console.error(`TIPO keyword "${keyword}" error:`, err.message);
    }
  }

  console.log(`TIPO: found ${results.length} new patents`);

  // Generate insight for new patents using LLM
  if (results.length && getApiKey()) {
    await generateInsights(results);
  }

  return results;
}

async function generateInsights(patents) {
  const BATCH_SIZE = 5;
  for (let i = 0; i < patents.length; i += BATCH_SIZE) {
    const batch = patents.slice(i, i + BATCH_SIZE);
    const entries = batch
      .filter(p => p.abstract || p.title)
      .map((p, idx) => `[${idx}] 標題：${p.title.split('\n')[0]}\n摘要：${p.abstract || '(無摘要)'}`)
      .join('\n\n');

    if (!entries) continue;

    try {
      const result = await callGroq(
        '你是教育科技產業分析師。針對每一筆專利，用一句白話中文描述它的「應用情境」——誰會在什麼場景下用它、解決什麼問題。不要用專利術語，要讓非技術背景的人秒懂。格式：每行 [編號] 應用情境描述',
        entries,
        { temperature: 0.3, maxTokens: 800 }
      );

      // Parse results: [0] ..., [1] ...
      const lines = result.split('\n').filter(l => /^\[?\d+\]/.test(l.trim()));
      for (const line of lines) {
        const match = line.match(/^\[?(\d+)\]?\s*(.+)/);
        if (match) {
          const idx = parseInt(match[1]);
          const insight = match[2].trim();
          if (batch[idx]) batch[idx].insight = insight;
        }
      }
    } catch (err) {
      console.error('Insight generation error:', err.message);
    }

    await delay(300);
  }
}

// ── Main functions ──

async function getPatents() {
  const cached = await readCache();
  if (cached && cached.updatedAt && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL) {
    return cached;
  }
  return refreshPatents();
}

async function refreshPatents() {
  const cached = await readCache();
  const existing = cached ? cached.patents || [] : [];
  const existingIds = new Set(existing.map(p => p.id));

  let newItems = [];
  try {
    newItems = await fetchTIPO(existingIds);
  } catch (err) {
    console.error('Patent refresh error:', err.message);
  }

  const all = [...newItems, ...existing];

  // Deduplicate by patent number
  const seen = new Set();
  const deduped = all.filter(p => {
    if (seen.has(p.patentNumber)) return false;
    seen.add(p.patentNumber);
    return true;
  });

  // Sort by publication date descending
  deduped.sort((a, b) => {
    if (!a.publicationDate && !b.publicationDate) return 0;
    if (!a.publicationDate) return 1;
    if (!b.publicationDate) return -1;
    return b.publicationDate.localeCompare(a.publicationDate);
  });

  // Keep max 1000 patents
  const trimmed = deduped.slice(0, 1000);

  // Build month index for frontend
  const months = new Set();
  for (const p of trimmed) {
    if (p.publicationDate) {
      months.add(p.publicationDate.slice(0, 7)); // YYYY-MM
    }
  }

  const data = {
    patents: trimmed,
    updatedAt: new Date().toISOString(),
    sources: { tipo: newItems.length },
    months: [...months].sort().reverse(), // newest first
    total: trimmed.length,
  };

  await writeCache(data);
  return data;
}

module.exports = { getPatents, refreshPatents, readCache };
