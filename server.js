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
const { generateEditorial, readHistory } = require('./lib/editorial');
const { getConferences, refreshConferences } = require('./lib/conferences');
const exhibitionData = require('./data/exhibitions.json');
const { fetchTrends } = require('./lib/trends');
const { generateCard, readHistory: readMicroHistory } = require('./lib/microlearn');

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

// Editorial history API
app.get('/api/editorial/history', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const history = (await readHistory()).slice(0, limit);
  res.json({ ok: true, history });
});

// Cron: auto-generate editorial daily (force refresh, ignores cache)
app.get('/api/cron/editorial', async (req, res) => {
  // Vercel Cron sends this header; also allow manual trigger with token
  const isVercelCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const isTokenAuth = req.query.token === process.env.VERCEL_TOKEN;
  if (!isVercelCron && !isTokenAuth) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const editorial = await generateEditorial(true);
    res.json({ ok: true, editorial: { title: editorial.title, generatedAt: editorial.generatedAt } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Conferences API
app.get('/api/conferences', async (req, res) => {
  try {
    const data = await getConferences();
    res.json({ ok: true, ...data });
  } catch (err) {
    res.json({ ok: false, error: err.message, conferences: [] });
  }
});

// Conferences refresh (protected)
app.get('/api/conferences/refresh', async (req, res) => {
  const token = req.query.token;
  if (token !== process.env.VERCEL_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const data = await refreshConferences();
    res.json({ ok: true, ...data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Exhibitions API
app.get('/api/exhibitions', (req, res) => {
  res.json({ ok: true, ...exhibitionData });
});

// Trends API
app.get('/api/trends', async (req, res) => {
  try {
    const data = await fetchTrends();
    res.json({ ok: true, ...data });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Micro-learning API
app.get('/api/microlearn', async (req, res) => {
  try {
    const card = await generateCard();
    const history = (await readMicroHistory()).slice(0, 10);
    res.json({ ok: true, card, history });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// Cron: auto-generate microlearn card daily
app.get('/api/cron/microlearn', async (req, res) => {
  const isVercelCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const isTokenAuth = req.query.token === process.env.VERCEL_TOKEN;
  if (!isVercelCron && !isTokenAuth) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  try {
    const card = await generateCard(true);
    res.json({ ok: true, card: { topic: card.topic, generatedAt: card.generatedAt } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// AI Teaching Assistant API
app.post('/api/teach-assist', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.json({ ok: false, error: 'Missing prompt' });
  if (prompt.length > 500) return res.json({ ok: false, error: '輸入不可超過 500 字' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.json({ ok: false, error: 'API key not configured' });

  try {
    const https = require('https');
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `你是一位專業的台灣教育科技助手，協助老師完成各種教學任務。
- 使用繁體中文
- 回覆要實用、可直接使用
- 格式清晰，善用條列和標題
- 回覆控制在 400 字以內`
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const result = await new Promise((resolve, reject) => {
      const url = new URL('https://api.groq.com/openai/v1/chat/completions');
      const r = https.request({
        hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      }, (resp) => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (data.choices && data.choices[0]) resolve(data.choices[0].message.content);
          else reject(new Error(data.error?.message || 'Groq error'));
        });
        resp.on('error', reject);
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
      r.write(body);
      r.end();
    });

    res.json({ ok: true, result });
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
