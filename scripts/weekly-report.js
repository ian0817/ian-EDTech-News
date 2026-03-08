#!/usr/bin/env node
/**
 * Weekly Analytics Report Generator
 * Reads pageview logs and saves a Markdown report to Obsidian.
 *
 * Usage: node scripts/weekly-report.js [days]
 * Default: 7 days
 */

const fs = require('fs');
const path = require('path');
const { generateReport, reportToMarkdown } = require('../lib/tracker');

const days = parseInt(process.argv[2]) || 7;
const report = generateReport(days);
const md = reportToMarkdown(report);

// Save to Obsidian
const obsidianDir = path.join(
  process.env.HOME,
  'SynologyDrive/Obsidian/zettelkasten/4-project/edtech/reports'
);

if (!fs.existsSync(obsidianDir)) {
  fs.mkdirSync(obsidianDir, { recursive: true });
}

const filename = `edtech-analytics-${report.period.from}-to-${report.period.to}.md`;
const filepath = path.join(obsidianDir, filename);

fs.writeFileSync(filepath, md, 'utf-8');

console.log(`Report saved: ${filepath}`);
console.log(`Period: ${report.period.from} ~ ${report.period.to}`);
console.log(`Total views: ${report.totalViews}, Unique visitors: ${report.uniqueVisitors}`);
