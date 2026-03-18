const https = require('https');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

function getApiKey() {
  return process.env.GROQ_API_KEY || '';
}

async function callGroq(systemPrompt, userPrompt, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const body = JSON.stringify({
    model: options.model || MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens || 600,
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
          if (data.choices && data.choices[0]) resolve(data.choices[0].message.content);
          else if (data.error) reject(new Error(data.error.message));
          else reject(new Error('Unexpected Groq response'));
        } catch { reject(new Error('Groq response parse error')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { callGroq, getApiKey, MODEL };
