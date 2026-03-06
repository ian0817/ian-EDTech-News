const https = require('https');
const { parseStringPromise } = require('xml2js');

/**
 * Search Bing News RSS for articles matching query.
 * Bing News provides real article URLs (unlike Google News which encrypts them).
 * Returns array of { title, link, source, pubDate, snippet }
 */
async function searchNews(query, maxResults = 20) {
  const encodedQuery = encodeURIComponent(query);
  // qft=interval%3d"8" = past month; sortby=date = newest first
  const url = `https://www.bing.com/news/search?q=${encodedQuery}&format=rss&mkt=zh-TW&qft=interval%3d"8"&sortby=date`;

  const xml = await httpGet(url);
  const parsed = await parseStringPromise(xml, { explicitArray: false });

  const channel = parsed.rss && parsed.rss.channel;
  if (!channel || !channel.item) return [];

  const items = Array.isArray(channel.item) ? channel.item : [channel.item];

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  return items
    .map(item => {
      const bingLink = item.link || '';
      const realUrl = extractRealUrl(bingLink);
      const source = (item['news:source'] || '').trim();
      const title = (item.title || '').trim();
      const pubDate = item.pubDate || '';

      return {
        title,
        link: realUrl,
        source,
        pubDate,
        snippet: (item.description || '').replace(/<[^>]*>/g, '').trim(),
      };
    })
    .filter(a => {
      if (!a.pubDate) return true;
      return new Date(a.pubDate) >= sixMonthsAgo;
    })
    .sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0))
    .slice(0, maxResults);
}

/**
 * Extract real URL from Bing News redirect link.
 * Format: http://www.bing.com/news/apiclick.aspx?...&url=https%3a%2f%2freal.url...&...
 */
function extractRealUrl(bingUrl) {
  try {
    const match = bingUrl.match(/[?&]url=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch (e) { /* fall through */ }
  return bingUrl;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : require('http');
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/xml,text/xml,*/*',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = { searchNews };
