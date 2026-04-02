const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { callGroq, getApiKey } = require('./groq');
const { isVercel, blobPut, blobGet } = require('./blob');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'market-data.json');
const BLOB_KEY = 'market-data.json';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

// Sources to crawl — URL + scope + id
const CRAWL_SOURCES = [
  { id: 'grand-view', name: 'Grand View Research', url: 'https://www.grandviewresearch.com/industry-analysis/education-technology-market', scope: 'global' },
  { id: 'markets-and-markets', name: 'MarketsandMarkets', url: 'https://www.marketsandmarkets.com/Market-Reports/educational-technology-ed-tech-market-1066.html', scope: 'global' },
  { id: 'mordor', name: 'Mordor Intelligence', url: 'https://www.mordorintelligence.com/industry-reports/digital-education-market', scope: 'global' },
  { id: 'research-nester', name: 'Research Nester', url: 'https://www.researchnester.com/tw/reports/education-technology-market/3403', scope: 'global' },
  { id: 'fortune-bi', name: 'Fortune Business Insights', url: 'https://www.fortunebusinessinsights.com/edtech-market-111377', scope: 'global' },
  { id: 'imarc-global', name: 'IMARC Group', url: 'https://www.imarcgroup.com/edtech-market', scope: 'global' },
  { id: 'imarc-taiwan', name: 'IMARC Group (Taiwan)', url: 'https://www.imarcgroup.com/taiwan-edtech-market', scope: 'taiwan' },
  { id: 'precedence', name: 'Precedence Research', url: 'https://www.precedenceresearch.com/educational-technology-market', scope: 'global' },
  { id: 'allied', name: 'Allied Market Research', url: 'https://www.alliedmarketresearch.com/edtech-market-A323685', scope: 'global' },
  { id: 'straits', name: 'Straits Research', url: 'https://straitsresearch.com/report/education-technology-market', scope: 'global' },
  { id: 'mrf', name: 'Market Research Future', url: 'https://www.marketresearchfuture.com/reports/edtech-market-16213', scope: 'global' },
  { id: 'technavio', name: 'Technavio', url: 'https://www.technavio.com/report/edtech-market-industry-analysis', scope: 'global' },
  { id: 'market-us-apac', name: 'Market.us (Asia Pacific)', url: 'https://market.us/report/asia-pacific-edtech-market/', scope: 'asia-pacific' },
];

// Fetch URL content as text (follow redirects, timeout 12s)
function fetchPage(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'zh-TW,en;q=0.9',
      },
      timeout: timeoutMs,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf-8');
        // Strip HTML tags, keep text only (rough extraction)
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 6000); // Limit for LLM context
        resolve(text);
      });
      res.on('error', reject);
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Use LLM to extract structured market data from page text
async function extractMarketData(pageText, sourceName) {
  const prompt = `從以下「${sourceName}」網頁內容中，提取 EdTech/Education Technology 市場數據。
請回傳嚴格 JSON 格式（不要 markdown code block），欄位如下：
{
  "marketSizeYear": 基準年(數字或null),
  "marketSizeValue": 基準年市場規模(USD Billion數字或null),
  "projectedYear": 預測目標年(數字或null),
  "projectedValue": 預測市場規模(USD Billion數字或null),
  "cagr": 年複合成長率百分比(數字或null),
  "forecastFrom": 預測起始年(數字或null),
  "forecastTo": 預測結束年(數字或null),
  "northAmericaShare": 北美市場佔比百分比(數字或null),
  "k12Share": K-12佔比百分比(數字或null),
  "hardwareShare": 硬體佔比百分比(數字或null),
  "access": "paid"或"free"
}
注意：金額單位統一為 USD Billion（十億美元），如果原文是 Million 請換算。

網頁內容：
${pageText.substring(0, 4000)}`;

  const result = await callGroq(
    '你是資料提取助手。只回傳純 JSON，不加任何解釋文字或 markdown。如果找不到數據就填 null。',
    prompt,
    { temperature: 0, maxTokens: 400 }
  );

  // Parse JSON from response (handle potential markdown wrapping)
  const jsonStr = result.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(jsonStr);
}

// ── Cache ──

let bundledData = null;
try { bundledData = require('../data/market-data.json'); } catch {}

async function readMarketCache() {
  if (isVercel()) {
    try {
      const blob = await blobGet(BLOB_KEY);
      if (blob && blob.sources && blob.sources.length) return blob;
    } catch {}
    if (bundledData) return bundledData;
  }
  try {
    if (!fs.existsSync(CACHE_FILE)) return bundledData || null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch { return bundledData || null; }
}

async function writeMarketCache(data) {
  if (isVercel()) {
    await blobPut(BLOB_KEY, data);
    return;
  }
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

// ── Main ──

async function getMarketData() {
  const cached = await readMarketCache();
  if (cached && cached.updatedAt) {
    const age = Date.now() - new Date(cached.updatedAt).getTime();
    if (age < CACHE_TTL) return cached;
  }
  // Return cached data even if stale (refresh via cron)
  return cached || { sources: [], updatedAt: null };
}

async function refreshMarketData() {
  if (!getApiKey()) {
    console.error('Market refresh: GROQ_API_KEY not set');
    return await readMarketCache();
  }

  const existing = await readMarketCache();
  const existingMap = {};
  if (existing && existing.sources) {
    for (const s of existing.sources) existingMap[s.id] = s;
  }

  let updated = 0;
  for (const src of CRAWL_SOURCES) {
    try {
      console.log(`Market: crawling ${src.name}...`);
      const text = await fetchPage(src.url);

      if (text.length < 200) {
        console.log(`  Skipped: too short (${text.length} chars)`);
        continue;
      }

      const data = await extractMarketData(text, src.name);

      // Merge into existing record
      const record = existingMap[src.id] || {
        id: src.id, name: src.name, url: src.url, scope: src.scope,
        segments: {}, regions: {}, tags: [src.scope],
      };

      // Only update fields that have non-null values
      if (data.marketSizeYear != null) {
        record.marketSize = { year: data.marketSizeYear, value: data.marketSizeValue, unit: 'B' };
      }
      if (data.projectedYear != null && data.projectedValue != null) {
        record.projected = { year: data.projectedYear, value: data.projectedValue };
      }
      if (data.cagr != null) record.cagr = data.cagr;
      if (data.forecastFrom != null && data.forecastTo != null) {
        record.forecast = { from: data.forecastFrom, to: data.forecastTo };
      }
      if (data.northAmericaShare != null) {
        record.regions = record.regions || {};
        record.regions['North America'] = data.northAmericaShare;
      }
      if (data.k12Share != null) {
        record.segments = record.segments || {};
        record.segments.bySector = record.segments.bySector || {};
        record.segments.bySector['K-12'] = data.k12Share;
      }
      if (data.hardwareShare != null) {
        record.segments = record.segments || {};
        record.segments.byType = record.segments.byType || {};
        record.segments.byType['Hardware'] = data.hardwareShare;
      }
      if (data.access) record.access = data.access;

      record.scrapedAt = new Date().toISOString();
      existingMap[src.id] = record;
      updated++;

      await delay(1500); // Avoid Groq rate limit (12k TPM)
    } catch (err) {
      console.error(`  Error ${src.name}:`, err.message);
    }
  }

  // Also keep sources not in CRAWL_SOURCES (manually added ones like HolonIQ, 數位產業署)
  const allSources = Object.values(existingMap);

  const result = {
    updatedAt: new Date().toISOString(),
    sources: allSources,
    categories: existing?.categories || {
      byScope: ['global', 'asia-pacific', 'taiwan'],
      byType: ['Hardware', 'Software', 'Content', 'LMS', 'AI Adaptive'],
      bySector: ['K-12', 'Higher Education', 'Corporate', 'Preschool'],
      byDeployment: ['Cloud', 'On-premises'],
    },
  };

  await writeMarketCache(result);
  console.log(`Market: refreshed ${updated}/${CRAWL_SOURCES.length} sources, total ${allSources.length}`);
  return result;
}

module.exports = { getMarketData, refreshMarketData };
