const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

/**
 * Fetch and extract main article text from a URL.
 * Uses common article selectors, falls back to <p> tags.
 */
async function fetchArticle(url, maxLen = 3000) {
  const html = await fetchUrl(url);
  const $ = cheerio.load(html);

  // Remove noise
  $('script, style, nav, header, footer, aside, .ad, .advertisement, .sidebar, .menu, .nav, .comment, .social-share').remove();

  // Try common article selectors
  const selectors = [
    'article',
    '[itemprop="articleBody"]',
    '.article-content',
    '.article-body',
    '.post-content',
    '.entry-content',
    '.story-body',
    '.content-body',
    'main',
  ];

  let text = '';
  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      text = el.find('p').map((_, p) => $(p).text().trim()).get().join('\n');
      if (text.length > 100) break;
    }
  }

  // Fallback: all <p> tags
  if (text.length < 100) {
    text = $('p').map((_, p) => $(p).text().trim()).get().join('\n');
  }

  // Truncate to avoid sending too much to LLM
  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + '...（截斷）';
  }

  return text;
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

module.exports = { fetchArticle };
