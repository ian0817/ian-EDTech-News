#!/usr/bin/env node
// 為所有專利生成完整情資分析（做什麼、為什麼重要、技術領先功能、架構圖、四個訊號）
// 用法：node scripts/generate-all-analysis.js
// 跑完後：git add data/patents-cache.json && git commit && git push && vercel --prod && /api/patents/import-bundled

const path = require('path');
const fs0 = require('fs');
const envPath = path.join(__dirname, '../.env');
if (fs0.existsSync(envPath)) {
  fs0.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  });
}

const fs = require('fs');
const { callGroq } = require('../lib/groq');

const CACHE_FILE = path.join(__dirname, '../data/patents-cache.json');

const SYSTEM = `你是台灣教育科技產業情報分析師，專門解讀台灣專利對 EdTech 市場的意義。
針對一筆台灣教育科技專利，輸出完整情資分析，格式為純 JSON（不要加 markdown code block、不要加反引號）。

規則：
- 繁體中文，言簡意賅
- 分析市場外部訊號，不要提及讀者自己的產品或正在進行的專案
- 系統架構圖用文字表示，以編號、▼、→ 呈現資料流

輸出格式（嚴格 JSON）：
{
  "what": "一句話點出這項專利「解決什麼問題」。\\n• 要點1\\n• 要點2\\n• 要點3",
  "why": "標題：為什麼這件事重要。\\n說明：2-3句具體說明市場意義，說明這項技術帶來的本質改變。",
  "features": ["技術領先功能1（15字內）", "技術領先功能2", "技術領先功能3"],
  "arch": "10 [第一個模組/輸入]\\n▼\\n20 [第二個處理模組]\\n  細節說明\\n▼\\n30 [輸出/結果]",
  "signals": [
    {"tag": "COMPETITOR", "title": "競爭者訊號標題", "body": "2-3句說明"},
    {"tag": "MARKET SHIFT", "title": "市場趨勢訊號標題", "body": "2-3句說明"},
    {"tag": "STRATEGY", "title": "策略/橋接訊號標題", "body": "2-3句說明"},
    {"tag": "MOAT", "title": "護城河/卡位訊號標題", "body": "2-3句說明"}
  ]
}`;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const patents = data.patents;

  // Only regenerate patents without a full report
  const forceAll = process.argv.includes('--force');
  const todo = forceAll
    ? patents
    : patents.filter(p => !p.report || !p.report.signals);

  console.log(`待生成：${todo.length} / 總計：${patents.length}${forceAll ? ' (--force)' : ''}`);

  let done = 0, failed = 0;

  for (const p of todo) {
    const title = (p.title || '').split('\n')[0].trim();
    const user = `標題：${title}\n專利類型：${p.patentType || '發明'}\n發明人：${(p.inventors || []).join('、')}\n摘要：${(p.abstract || '').substring(0, 600)}`;

    try {
      const raw = await callGroq(SYSTEM, user, { temperature: 0.4, maxTokens: 1100, model: 'llama-3.1-8b-instant' });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      const obj = JSON.parse(match[0]);
      if (!obj.what || !obj.why || !obj.features || !obj.arch || !obj.signals) throw new Error('Missing fields');
      p.report = obj;
      done++;
      process.stdout.write(`\r[${done + failed}/${todo.length}] ✅ ${title.substring(0, 35)}...`);
    } catch (e) {
      failed++;
      process.stdout.write(`\r[${done + failed}/${todo.length}] ❌ ${title.substring(0, 35)}: ${e.message}\n`);
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
    await delay(16000); // 16s to stay within 6000 TPM (each req ~1500 tokens)
  }

  console.log(`\n\n完成：${done} 生成，${failed} 失敗`);
  console.log('下一步：git add data/patents-cache.json && git commit -m "feat: 96筆專利完整情資分析" && git push');
  console.log('      source .env && vercel --token "$VERCEL_TOKEN" --prod --yes');
  console.log('      curl "https://edtech-news.vercel.app/api/patents/import-bundled?token=$VERCEL_TOKEN"');
}

main().catch(console.error);
