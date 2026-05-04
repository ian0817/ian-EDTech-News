#!/bin/bash
# 本機專利更新腳本：爬取 TIPO → commit → deploy → 同步 Blob
# 用法：bash scripts/refresh-patents.sh
# 建議每週一由 LaunchD 自動執行

set -e
cd "$(dirname "$0")/.."

source .env

echo "[$(date)] 開始爬取 TIPO..."
node -e "
const { refreshPatents } = require('./lib/patents');
refreshPatents().then(d => {
  console.log('找到', d.total, '筆專利，最新月份:', d.months[0]);
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
"

echo "[$(date)] 提交 + 部署..."
git add data/patents-cache.json
git commit -m "chore: 更新專利 cache $(date +%Y-%m-%d)" --no-verify 2>/dev/null || echo "(no changes to commit)"
git push

npx vercel --prod --yes 2>&1 | tail -3

echo "[$(date)] 同步 Blob..."
sleep 5
curl -s "https://edtech-news.vercel.app/api/patents/import-bundled?token=${VERCEL_TOKEN}"

echo ""
echo "[$(date)] 完成"
