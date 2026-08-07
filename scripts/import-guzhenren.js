// 兼容入口 → 请优先使用: node scripts/import-novel.js --preset guzhenren
process.argv.push('--preset', 'guzhenren');
require('./import-novel.js');
