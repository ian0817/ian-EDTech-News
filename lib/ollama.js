const http = require('http');

const MODEL = 'qwen3:8b';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

/**
 * Send article to local Ollama for summarization.
 */
async function summarize(title, content) {
  const prompt = `你是一位教育科技領域的新聞編輯。請用繁體中文為以下新聞產生摘要。

要求：
1. 3~5 句話概述重點
2. 標出關鍵人物、機構、數據
3. 最後一句給出這則新聞對「數位學習」或「教育科技」的啟示

標題：${title}

內文：
${content}

摘要：`;

  const body = JSON.stringify({
    model: MODEL,
    prompt,
    stream: false,
    options: {
      temperature: 0.3,
      num_predict: 500,
    },
  });

  return new Promise((resolve, reject) => {
    const url = new URL(OLLAMA_URL);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve(data.response || '摘要生成失敗');
        } catch (e) {
          reject(new Error('Ollama response parse error'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Ollama timeout (120s)')); });
    req.write(body);
    req.end();
  });
}

module.exports = { summarize };
