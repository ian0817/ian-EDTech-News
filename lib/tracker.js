const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_FILE = path.join(DATA_DIR, 'pageviews.jsonl');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Middleware: log every page view
function trackPageView(req, res, next) {
  // Only track page requests (not API, not static assets)
  const p = req.path;
  if (p.startsWith('/api/') || (p.includes('.') && !p.endsWith('.html'))) {
    return next();
  }

  const entry = {
    ts: new Date().toISOString(),
    path: p,
    ref: req.headers.referer || req.headers.referrer || '',
    ua: req.headers['user-agent'] || '',
    lang: req.headers['accept-language'] || '',
    ip: (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  };

  // Async append, don't block response
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('Tracker write error:', err.message);
  });
  next();
}

// Read all pageview logs
function readLogs(daysBack) {
  if (!fs.existsSync(LOG_FILE)) return [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (daysBack || 30));

  return fs.readFileSync(LOG_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(e => e && new Date(e.ts) >= cutoff);
}

// Generate report data
function generateReport(daysBack) {
  const logs = readLogs(daysBack || 7);
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (daysBack || 7));

  // Total views & unique IPs
  const totalViews = logs.length;
  const uniqueIPs = new Set(logs.map(e => e.ip)).size;

  // Views by page
  const byPage = {};
  logs.forEach(e => { byPage[e.path] = (byPage[e.path] || 0) + 1; });
  const topPages = Object.entries(byPage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Views by date
  const byDate = {};
  logs.forEach(e => {
    const d = e.ts.slice(0, 10);
    byDate[d] = (byDate[d] || 0) + 1;
  });
  const dailyViews = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));

  // Referrers
  const byRef = {};
  logs.forEach(e => {
    if (!e.ref) return;
    try {
      const host = new URL(e.ref).hostname;
      if (host) byRef[host] = (byRef[host] || 0) + 1;
    } catch {}
  });
  const topRefs = Object.entries(byRef)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Browsers (simple extraction)
  const byBrowser = {};
  logs.forEach(e => {
    const ua = e.ua;
    let browser = 'Other';
    if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('Chrome/')) browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Firefox/')) browser = 'Firefox';
    byBrowser[browser] = (byBrowser[browser] || 0) + 1;
  });
  const browsers = Object.entries(byBrowser).sort((a, b) => b[1] - a[1]);

  return {
    period: { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), days: daysBack || 7 },
    totalViews,
    uniqueVisitors: uniqueIPs,
    topPages,
    dailyViews,
    topRefs,
    browsers
  };
}

// Format report as Markdown
function reportToMarkdown(report) {
  const lines = [];
  lines.push(`---`);
  lines.push(`id: ${new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 12)}`);
  lines.push(`title: "EdTech Analytics — ${report.period.from} ~ ${report.period.to}"`);
  lines.push(`created: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`tags: [type/report, topic/edtech, topic/analytics, status/unreviewed]`);
  lines.push(`---`);
  lines.push(``);
  lines.push(`# EdTech Analytics Report`);
  lines.push(`> ${report.period.from} ~ ${report.period.to}（${report.period.days} 天）`);
  lines.push(``);
  lines.push(`## 總覽`);
  lines.push(`| 指標 | 數值 |`);
  lines.push(`|------|------|`);
  lines.push(`| Page Views | ${report.totalViews} |`);
  lines.push(`| 獨立訪客 | ${report.uniqueVisitors} |`);
  lines.push(`| 日均瀏覽 | ${(report.totalViews / report.period.days).toFixed(1)} |`);
  lines.push(``);

  lines.push(`## 每日瀏覽量`);
  lines.push(`| 日期 | 瀏覽數 |`);
  lines.push(`|------|--------|`);
  report.dailyViews.forEach(([d, n]) => lines.push(`| ${d} | ${n} |`));
  lines.push(``);

  lines.push(`## 熱門頁面`);
  lines.push(`| 頁面 | 瀏覽數 |`);
  lines.push(`|------|--------|`);
  report.topPages.forEach(([p, n]) => lines.push(`| ${p} | ${n} |`));
  lines.push(``);

  if (report.topRefs.length) {
    lines.push(`## 流量來源`);
    lines.push(`| 來源 | 次數 |`);
    lines.push(`|------|------|`);
    report.topRefs.forEach(([r, n]) => lines.push(`| ${r} | ${n} |`));
    lines.push(``);
  }

  lines.push(`## 瀏覽器分佈`);
  lines.push(`| 瀏覽器 | 次數 |`);
  lines.push(`|--------|------|`);
  report.browsers.forEach(([b, n]) => lines.push(`| ${b} | ${n} |`));
  lines.push(``);

  return lines.join('\n');
}

module.exports = { trackPageView, readLogs, generateReport, reportToMarkdown };
