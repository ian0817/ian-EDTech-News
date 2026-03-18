const fs = require('fs');
const path = require('path');
const { searchNews } = require('./news');
const { isVercel, blobPut, blobGet } = require('./blob');
const { callGroq } = require('./groq');

const SUMMARIES_FILE = path.join(__dirname, '..', 'data', 'conference-summaries.json');
const BLOB_SUMMARIES_KEY = 'conference-summaries.json';

// --- Storage abstraction ---

async function readSummaries() {
  if (isVercel()) {
    const data = await blobGet(BLOB_SUMMARIES_KEY);
    return Array.isArray(data) ? data : [];
  }
  try {
    if (!fs.existsSync(SUMMARIES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf-8'));
  } catch { return []; }
}

async function writeSummaries(summaries) {
  if (isVercel()) {
    await blobPut(BLOB_SUMMARIES_KEY, summaries);
    return;
  }
  try {
    fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2), 'utf-8');
  } catch {}
}

const SUMMARY_SYSTEM_PROMPT = `你是一位教育科技領域的活動觀察者，專門撰寫學術活動的事後摘要報導。
- 使用繁體中文
- 根據新聞報導整理活動的重點成果與亮點
- 文字簡潔有力，像在跟同事分享「這場活動有什麼值得注意的」
- 如果資訊不足，誠實說明而非編造`;

// --- Core: generate summary for one activity ---

async function generateSummaryForActivity(activity) {
  // Search Bing News with the activity title
  const query = activity.title;
  let articles;
  try {
    articles = await searchNews(query, 10);
  } catch {
    articles = [];
  }

  // Filter: only keep articles somewhat relevant (title overlap)
  // At least 1 article needed
  if (!articles.length) return null;

  const headlines = articles.slice(0, 5).map((a, i) =>
    `${i + 1}. ${a.title}（${a.source || '未知來源'}）\n   ${a.snippet || ''}`
  ).join('\n');

  const prompt = `以下是關於「${activity.title}」（日期：${activity.date}）這場${activity.type === 'exhibition' ? '展覽' : '研討會'}的相關新聞報導：

${headlines}

請根據這些報導，撰寫一篇活動後摘要：

要求：
1. 200～300 字
2. 概述活動的主要亮點、重要發表或成果
3. 標出關鍵數據、人物或機構
4. 最後一句話給出對教育科技領域的意義或啟示
5. 如果新聞內容與該活動關聯度低，請誠實說明「相關報導有限」並僅就找到的資訊摘要`;

  const summary = await callGroq(SUMMARY_SYSTEM_PROMPT, prompt, { temperature: 0.4 });

  return {
    activityId: activity.id,
    activityTitle: activity.title,
    activityDate: activity.date,
    activityType: activity.type,
    summary,
    articles: articles.slice(0, 5).map(a => ({ title: a.title, source: a.source, link: a.link })),
    generatedAt: new Date().toISOString(),
  };
}

// --- Public: generate or regenerate for one activity ---

async function generateSummary(activity) {
  const result = await generateSummaryForActivity(activity);
  if (!result) return null;

  const summaries = await readSummaries();
  const idx = summaries.findIndex(s => s.activityId === activity.id);
  if (idx >= 0) {
    summaries[idx] = result;
  } else {
    summaries.push(result);
  }
  await writeSummaries(summaries);
  return result;
}

// --- Public: get all summaries ---

async function getSummaries() {
  return await readSummaries();
}

// --- Cron: auto-generate summaries for ended activities from 2026+ ---

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function cronGenerateSummaries(allActivities) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const summaries = await readSummaries();
  const existingIds = new Set(summaries.map(s => s.activityId));

  // Filter: ended, 2026+, not yet summarized
  const targets = allActivities.filter(a => {
    if (!a.date) return false;
    // Must be 2026 or later
    if (a.date < '2026-01-01') return false;
    // Must be ended
    const endDate = new Date(a.endDate || a.date);
    if (endDate >= now) return false;
    // Not yet summarized
    if (existingIds.has(a.id)) return false;
    return true;
  });

  if (!targets.length) return { generated: 0, targets: [] };

  const results = [];
  for (const activity of targets) {
    try {
      const result = await generateSummaryForActivity(activity);
      if (result) {
        summaries.push(result);
        results.push({ id: activity.id, title: activity.title, status: 'ok' });
      } else {
        results.push({ id: activity.id, title: activity.title, status: 'no_articles' });
      }
    } catch (err) {
      results.push({ id: activity.id, title: activity.title, status: 'error', error: err.message });
    }
    // Delay between API calls to avoid rate limiting
    if (targets.indexOf(activity) < targets.length - 1) await delay(2000);
  }

  await writeSummaries(summaries);
  return { generated: results.filter(r => r.status === 'ok').length, results };
}

module.exports = { generateSummary, getSummaries, cronGenerateSummaries };
