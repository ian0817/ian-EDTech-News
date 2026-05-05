#!/usr/bin/env node
// 一次性為全部既有專利生成四維情資報告
// 用法：node scripts/generate-all-insights.js
// 建議在本機跑完後 commit + deploy + blob sync

const path = require('path');
// Load .env manually without requiring dotenv package
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

const SYSTEM = `你是台灣教育科技產業情報分析師。
針對一筆台灣專利，輸出四維情報分析，格式為純 JSON（不要加 markdown code block）。
規則：
- 分析外部市場訊號，不要提及使用者自己的產品
- 每個維度 2-4 句，言簡意賅，繁體中文
- 輸出格式：
{"competitor":"競爭者或申請人背景與市場卡位分析","maturity":"發明/新型類型反映的技術成熟度訊號","trend":"這項技術揭示的商業趨勢或市場方向","moat":"護城河分析：對競爭者的威脅與繞過難度"}`;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  const patents = data.patents;

  const todo = patents.filter(p => !p.insight || typeof p.insight === 'string');
  console.log(`待生成：${todo.length} / 總計：${patents.length}`);

  let done = 0, failed = 0;

  for (const p of todo) {
    const title = (p.title || '').split('\n')[0].trim();
    const user = `標題：${title}\n專利類型：${p.patentType || '發明'}\n發明人：${(p.inventors || []).join('、')}\n摘要：${(p.abstract || '').substring(0, 500)}`;

    try {
      const raw = await callGroq(SYSTEM, user, { temperature: 0.4, maxTokens: 700 });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const obj = JSON.parse(match[0]);
      if (!obj.competitor || !obj.maturity || !obj.trend || !obj.moat) throw new Error('Missing fields');
      p.insight = obj;
      done++;
      process.stdout.write(`\r進度：${done + failed}/${todo.length}  ✅ ${title.substring(0, 30)}...`);
    } catch (e) {
      failed++;
      process.stdout.write(`\r進度：${done + failed}/${todo.length}  ❌ ${title.substring(0, 30)}: ${e.message}\n`);
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2)); // save after each to avoid losing progress
    await delay(2500);
  }

  console.log(`\n\n完成：${done} 生成，${failed} 失敗`);
}

main().catch(console.error);
