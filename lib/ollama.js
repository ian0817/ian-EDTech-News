const https = require('https');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

function getApiKey() {
  return process.env.GROQ_API_KEY || '';
}

async function summarize(title, content) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一位教育科技領域的新聞編輯，專門用繁體中文撰寫新聞摘要。',
      },
      {
        role: 'user',
        content: `請為以下新聞產生摘要。

要求：
1. 3~5 句話概述重點
2. 標出關鍵人物、機構、數據
3. 最後一句給出這則新聞對「數位學習」或「教育科技」的啟示

標題：${title}

內文：
${content}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 500,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(GROQ_API_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          if (data.choices && data.choices[0]) {
            resolve(data.choices[0].message.content);
          } else if (data.error) {
            reject(new Error(data.error.message));
          } else {
            reject(new Error('Unexpected Groq response'));
          }
        } catch (e) {
          reject(new Error('Groq response parse error'));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { summarize };
