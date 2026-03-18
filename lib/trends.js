const fs = require('fs');
const path = require('path');
const { searchNews } = require('./news');

const { isVercel, blobPut, blobGet } = require('./blob');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'trends-cache.json');
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
const BLOB_CACHE_KEY = 'trends-cache.json';

// Keywords to track — matches the homepage tags
const KEYWORDS = [
  { key: 'digital-learning', label: '數位學習', query: '數位學習' },
  { key: 'edtech', label: 'EdTech', query: '教育科技 EdTech' },
  { key: 'ai-education', label: 'AI 教育', query: 'AI 教育' },
  { key: 'online-course', label: '線上課程', query: '線上課程 平台' },
  { key: 'edu-policy', label: '教育政策', query: '教育部 數位' },
  { key: 'self-learning', label: '自主學習', query: '自主學習' },
  { key: 'genai', label: '生成式 AI', query: '教育 AI 生成式' },
  { key: 'remote', label: '遠距教學', query: '遠距教學' },
];

async function readCache() {
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

async function writeCache(data) {
  if (isVercel()) {
    await blobPut(BLOB_CACHE_KEY, data);
    return;
  }
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

/**
 * Count articles per day bucket from search results.
 * Returns { '2026-03-10': 3, '2026-03-09': 5, ... }
 */
function countByDay(articles) {
  const counts = {};
  for (const a of articles) {
    if (!a.pubDate) continue;
    const d = new Date(a.pubDate);
    const key = d.toISOString().slice(0, 10);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * Generate last N days as array of date strings.
 */
function lastNDays(n) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Fetch trends for all keywords.
 * Returns { keywords: [...], days: [...], generatedAt, topKeywords: [...] }
 */
async function fetchTrends(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = await readCache();
    if (cached) return cached;
  }

  const days = lastNDays(7);
  const keywordResults = [];

  // Fetch all keywords in parallel for speed
  const results = await Promise.allSettled(
    KEYWORDS.map(kw => searchNews(kw.query, 40))
  );

  KEYWORDS.forEach((kw, i) => {
    const articles = results[i].status === 'fulfilled' ? results[i].value : [];
    const dailyCounts = countByDay(articles);
    const counts = days.map(d => dailyCounts[d] || 0);
    const total = counts.reduce((a, b) => a + b, 0);

    // Trend: compare last 3 days vs first 4 days
    const recent = counts.slice(4).reduce((a, b) => a + b, 0);
    const earlier = counts.slice(0, 4).reduce((a, b) => a + b, 0);
    const trend = earlier === 0 ? (recent > 0 ? 'up' : 'flat') :
      recent > earlier * 0.75 ? 'up' : recent < earlier * 0.25 ? 'down' : 'flat';

    keywordResults.push({
      key: kw.key,
      label: kw.label,
      query: kw.query,
      counts,
      total,
      trend,
    });
  });

  // Top 5 by total
  const topKeywords = [...keywordResults]
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)
    .map((kw, i) => ({ rank: i + 1, label: kw.label, total: kw.total, trend: kw.trend }));

  const result = {
    keywords: keywordResults,
    days,
    topKeywords,
    generatedAt: new Date().toISOString(),
  };

  await writeCache(result);
  return result;
}

module.exports = { fetchTrends, KEYWORDS };
