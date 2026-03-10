const https = require('https');
const http = require('http');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'data', 'conferences-cache.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Keywords that indicate education/EdTech relevance
// Require at least one education-domain keyword
const EDTECH_KEYWORDS = [
  '教育', '數位學習', 'EdTech', 'e-learning', '開放式課程', '遠距教學',
  'STEM', '課程', '教學', '師資', '教保', '素養', '學習',
  'AI教育', 'E時代', '通識教育',
];

// Exclude terms that match broadly but aren't EdTech
const EXCLUDE_KEYWORDS = [
  '冶金', '冷凍', '空調', '珊瑚', '冷氣', '積體電路', '紡織',
  '粉末', '細胞培養', '外泌體', '電池', '微菌', '材料',
  '精密機械', '房地產', '貿易', '會計', '體育', '運動',
  '照護', '醫', '護理', '藥', '經濟', '觀光', '休閒',
  '建築', '文化遺產', '藝術', '美術', '設計', '圖像',
  '環境安全', '衛生', '消防', '水域',
];

function isEdTechRelated(title) {
  const t = title;
  // Must match at least one EdTech keyword
  const hasEdTech = EDTECH_KEYWORDS.some(k => t.includes(k));
  if (!hasEdTech) return false;
  // Exclude non-education topics
  const excluded = EXCLUDE_KEYWORDS.some(k => t.includes(k));
  return !excluded;
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  } catch { return null; }
}

function writeCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

function fetchUrl(url, redirectCount = 0) {
  if (redirectCount > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (redirectUrl.startsWith('/')) {
          const u = new URL(url);
          redirectUrl = `${u.protocol}//${u.host}${redirectUrl}`;
        }
        return fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── NSTC Scraper ──
// HTML structure: a wraps the whole item, containing div.date + h3 with title
async function scrapeNSTC(existingIds) {
  const results = [];
  const baseUrl = 'https://www.nstc.gov.tw/folksonomy/list/e25373b0-6a33-4a48-ae74-85cae48f1b72';

  for (let page = 1; page <= 4; page++) {
    try {
      const url = `${baseUrl}?pageNum=${page}&view_mode=listView&l=ch`;
      const html = await fetchUrl(url);
      const $ = cheerio.load(html);

      $('div.date').each((_, dateEl) => {
        const date = $(dateEl).text().trim();
        const $wrapper = $(dateEl).closest('a');
        const href = $wrapper.attr('href') || '';
        const $h3 = $wrapper.find('h3').first();
        const title = $h3.text().trim();

        if (!title || title.length < 5) return;
        if (title.includes('免責聲明')) return;

        const fullUrl = href.startsWith('http') ? href : `https://www.nstc.gov.tw${href}`;
        const id = 'nstc-' + (href.match(/([a-f0-9-]{36})/)?.[1] || fullUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-40));

        if (existingIds.has(id)) return;
        if (!isEdTechRelated(title)) return;

        // Try to extract conference date from title (e.g., "舉辦日期: 2026年5月29日")
        let confDate = date;
        const confDateMatch = title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (confDateMatch) {
          confDate = `${confDateMatch[1]}-${confDateMatch[2].padStart(2,'0')}-${confDateMatch[3].padStart(2,'0')}`;
        }

        results.push({
          id, title, date: confDate, postDate: date,
          source: 'NSTC', url: fullUrl,
          scrapedAt: new Date().toISOString(),
        });
      });

      if (page < 4) await delay(300);
    } catch (err) {
      console.error(`NSTC page ${page} error:`, err.message);
    }
  }
  return results;
}

// ── NTTU Scraper ──
// List page: div.d-item > div.mbox > div.d-txt > div.mtitle > a[href, title]
// Article page: "最後更新日期" with YYYY-MM-DD
async function scrapeNTTU(existingIds) {
  const results = [];
  const maxPages = 8;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const url = page === 1
        ? 'https://rd.nttu.edu.tw/p/412-1007-3107.php?Lang=zh-tw'
        : `https://rd.nttu.edu.tw/p/412-1007-3107-${page}.php?Lang=zh-tw`;
      const html = await fetchUrl(url);
      const $ = cheerio.load(html);

      const links = [];
      $('a[href*="405-1007-"]').each((_, el) => {
        const $el = $(el);
        const rawTitle = ($el.attr('title') || $el.text()).trim();
        if (!rawTitle || rawTitle.length < 5) return;

        const href = $el.attr('href') || '';
        const fullUrl = href.startsWith('http') ? href : `https://rd.nttu.edu.tw${href}`;
        const idMatch = fullUrl.match(/405-1007-(\d+)/);
        const id = 'nttu-' + (idMatch ? idMatch[1] : fullUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-40));

        if (existingIds.has(id)) return;

        const cleanTitle = rawTitle.replace(/^【[^】]*】\s*/, '');
        if (!isEdTechRelated(cleanTitle)) return;

        links.push({ id, title: cleanTitle, url: fullUrl });
      });

      // Fetch each article page for date (batch of 3)
      for (let i = 0; i < links.length; i += 3) {
        const batch = links.slice(i, i + 3);
        await Promise.allSettled(
          batch.map(async (item) => {
            try {
              const articleHtml = await fetchUrl(item.url);
              // Get the last updated date
              const dateMatch = articleHtml.match(/最後更新日期\s*[：:]\s*[\s\S]*?(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                item.date = dateMatch[1];
              } else {
                // Fallback: try to find a conference date in the title
                const titleDate = item.title.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                if (titleDate) {
                  item.date = `${titleDate[1]}-${titleDate[2].padStart(2,'0')}-${titleDate[3].padStart(2,'0')}`;
                } else {
                  item.date = '';
                }
              }
            } catch {
              item.date = '';
            }
          })
        );
        if (i + 3 < links.length) await delay(200);
      }

      for (const item of links) {
        results.push({
          id: item.id,
          title: item.title,
          date: item.date,
          source: 'NTTU',
          url: item.url,
          scrapedAt: new Date().toISOString(),
        });
      }

      if (page < maxPages) await delay(300);
    } catch (err) {
      console.error(`NTTU page ${page} error:`, err.message);
    }
  }
  return results;
}

async function getConferences() {
  const cached = readCache();
  if (cached && Date.now() - new Date(cached.updatedAt).getTime() < CACHE_TTL) {
    return cached;
  }
  return refreshConferences();
}

async function refreshConferences() {
  const cached = readCache();
  const existing = cached ? cached.conferences || [] : [];
  const existingIds = new Set(existing.map(c => c.id));

  const [nstcNew, nttuNew] = await Promise.allSettled([
    scrapeNSTC(existingIds),
    scrapeNTTU(existingIds),
  ]);

  const newItems = [
    ...(nstcNew.status === 'fulfilled' ? nstcNew.value : []),
    ...(nttuNew.status === 'fulfilled' ? nttuNew.value : []),
  ];

  const all = [...newItems, ...existing];

  // Sort by date descending (newest first), undated at the end
  all.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  const data = {
    conferences: all,
    updatedAt: new Date().toISOString(),
    sources: {
      nstc: nstcNew.status === 'fulfilled' ? nstcNew.value.length : 0,
      nttu: nttuNew.status === 'fulfilled' ? nttuNew.value.length : 0,
    },
    total: all.length,
  };

  writeCache(data);
  return data;
}

module.exports = { getConferences, refreshConferences };
