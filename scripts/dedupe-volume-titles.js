// 清洗已入库章节标题：同一卷内「第N卷…」只保留第一章
//   node --env-file=.env scripts/dedupe-volume-titles.js
//   node --env-file=.env scripts/dedupe-volume-titles.js --novel 9

const { pool } = require('../db');
const { dedupeVolumePrefixes } = require('../lib/chapterText');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--novel' && argv[i + 1]) {
      out.novelId = Number(argv[++i]);
    }
  }
  return out;
}

(async () => {
  const { novelId } = parseArgs(process.argv.slice(2));
  const params = [];
  let where = '';
  if (Number.isInteger(novelId) && novelId > 0) {
    where = 'WHERE id = ?';
    params.push(novelId);
  }

  const [novels] = await pool.execute(
    `SELECT id, title FROM novels ${where} ORDER BY id ASC`,
    params
  );

  let updatedTotal = 0;
  for (const novel of novels) {
    const [chapters] = await pool.execute(
      'SELECT id, chapter_number, title FROM chapters WHERE novel_id = ? ORDER BY chapter_number ASC',
      [novel.id]
    );
    if (!chapters.length) continue;

    const cleaned = dedupeVolumePrefixes(chapters.map(c => c.title));
    let changed = 0;
    for (let i = 0; i < chapters.length; i++) {
      if (cleaned[i] === chapters[i].title) continue;
      await pool.execute('UPDATE chapters SET title = ? WHERE id = ?', [cleaned[i], chapters[i].id]);
      changed += 1;
    }
    if (changed > 0) {
      // 本脚本是独立进程，内存缓存（lib/memoryCache）与线上服务不共享，
      // 这里 clear 无意义。改完标题后需重启服务，或等待 HTML 缓存 TTL 自然过期。
      console.log(`novel ${novel.id} ${novel.title}: updated ${changed}/${chapters.length}`);
      updatedTotal += changed;
    } else {
      console.log(`novel ${novel.id} ${novel.title}: no change`);
    }
  }

  console.log('DONE updated_titles=', updatedTotal);
  await pool.end();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
