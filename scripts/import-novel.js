#!/usr/bin/env node
// 通用导入 CLI:
//   node scripts/import-novel.js --file "path.txt" --title 书名 --author 作者 [--desc 简介]
// 也可用预设:
//   node scripts/import-novel.js --preset guzhenren
//   node scripts/import-novel.js --preset yongsheng

const path = require('path');
const { pool } = require('../db');
const { importNovelFromTxt } = require('../lib/importNovel');

const PRESETS = {
  guzhenren: {
    file: 'C:/Users/huishengli/Desktop/蛊真人.txt',
    title: '蛊真人',
    author: '蛊真人',
    description: [
      '人是万物之灵，蛊是天地真精。',
      '一个穿越者不断重生的故事。',
      '一个养蛊、炼蛊、用蛊的奇特世界。'
    ].join('\n')
  },
  yongsheng: {
    file: 'C:/Users/huishengli/Desktop/永生 作者：梦入神机.txt',
    title: '永生',
    author: '梦入神机',
    description: [
      '肉身，神通，长生，成仙，永生，五重境界。',
      '一个卑微的生灵，怎么样一步步打开永生之门？',
      '天地之间，肉身的结构，神通的奥秘，长生的逍遥，成仙的力量，永生的希望，尽在其中。'
    ].join('\n')
  }
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node scripts/import-novel.js --file <path.txt> --title <书名> --author <作者> [--desc <简介>]
  node scripts/import-novel.js --preset guzhenren|yongsheng

Presets: ${Object.keys(PRESETS).join(', ')}`);
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  let options;

  if (args.preset) {
    options = PRESETS[args.preset];
    if (!options) {
      console.error('unknown preset:', args.preset);
      usage();
      process.exit(1);
    }
  } else if (args.file && args.title && args.author) {
    options = {
      file: path.resolve(args.file),
      title: args.title,
      author: args.author,
      description: args.desc || ''
    };
  } else {
    usage();
    process.exit(1);
  }

  try {
    const result = await importNovelFromTxt(options);
    console.log('first3=', result.first3);
    console.log('last=', result.last);
  } finally {
    await pool.end();
  }
})().catch(err => {
  console.error('IMPORT FAILED', err);
  process.exit(1);
});
