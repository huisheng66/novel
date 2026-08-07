// 兼容入口 → 请优先使用: node scripts/import-novel.js --preset yongsheng
process.argv.push('--preset', 'yongsheng');
require('./import-novel.js');
