// Load .env for local development
const fs = require('fs');
const envPath = require('path').join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const express = require('express');
const path = require('path');
const { searchNews } = require('./lib/news');
const { fetchArticle } = require('./lib/scraper');
const { summarize } = require('./lib/ollama');
const examData = require('./data/exams.json');
const { version } = require('./package.json');
const { trackPageView, generateReport, reportToMarkdown } = require('./lib/tracker');
const { generateEditorial } = require('./lib/editorial');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(trackPageView);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Search news
app.get('/api/search', async (req, res) => {
  const query = req.query.q || '數位學習 教育科技';
  try {
    const articles = await searchNews(query);
    res.json({ ok: true, articles });
  } catch (err) {
    res.json({ ok: false, error: err.message, articles: [] });
  }
});

// Fetch full article + summarize
app.post('/api/summarize', async (req, res) => {
  const { url, title } = req.body;
  if (!url) return res.json({ ok: false, error: 'Missing url' });

  try {
    const content = await fetchArticle(url);
    if (!content || content.length < 50) {
      return res.json({ ok: false, error: '無法擷取文章內容（可能被擋或需登入）' });
    }
    const summary = await summarize(title, content);
    res.json({ ok: true, summary, contentLength: content.length });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Exam calendar API
app.get('/api/exams', (req, res) => {
  const category = req.query.category;
  let exams = examData.exams;
  if (category) {
    exams = exams.filter(e => e.category === category);
  }
  res.json({ ok: true, ...examData, exams });
});

// Editorial API
app.get('/api/editorial', async (req, res) => {
  try {
    const editorial = await generateEditorial();
    res.json({ ok: true, editorial });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Version API
app.get('/api/version', (req, res) => {
  res.json({ version });
});

// Analytics report API (protected by token)
app.get('/api/analytics', (req, res) => {
  const token = req.query.token;
  if (token !== process.env.VERCEL_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const days = parseInt(req.query.days) || 7;
  const format = req.query.format || 'json';
  const report = generateReport(days);
  if (format === 'md') {
    res.type('text/markdown').send(reportToMarkdown(report));
  } else {
    res.json({ ok: true, report });
  }
});

// Local dev
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`EdTech News running at http://localhost:${PORT}`);
  });
}

// Vercel serverless export
module.exports = app;
