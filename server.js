const express = require('express');
const path = require('path');
const { searchNews } = require('./lib/news');
const { fetchArticle } = require('./lib/scraper');
const { summarize } = require('./lib/ollama');

const app = express();
const PORT = 3000;

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

app.listen(PORT, () => {
  console.log(`EdTech News running at http://localhost:${PORT}`);
});
