const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('\n📖 验证：目录页只显示纯粹的章节列表\n' + '='.repeat(70) + '\n');

  const token = fs.readFileSync('test-token.txt', 'utf8').trim();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setCookie({
    name: 'cn_jwt',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false
  });

  await page.goto('http://localhost:3008/novel/1', { waitUntil: 'networkidle0' });
  await new Promise(resolve => setTimeout(resolve, 500));

  const report = await page.evaluate(() => {
    return {
      // 应该不存在的元素
      removed: {
        cover: !!document.querySelector('.novel-cover'),
        meta: !!document.querySelector('.novel-meta'),
        summary: !!document.querySelector('.novel-summary'),
        startBtn: !!document.getElementById('start-reading'),
        actions: !!document.querySelector('.novel-actions')
      },
      // 应该存在的元素
      kept: {
        chapterList: !!document.getElementById('chapter-list'),
        heading: !!document.getElementById('chapter-list-title'),
        ol: !!document.getElementById('chapter-list-ol'),
        chapters: document.querySelectorAll('#chapter-list-ol li').length
      }
    };
  });

  console.log('🗑️  已删除的元素（应全为 ✅）:');
  console.log('  封面图: ' + (report.removed.cover ? '❌ 仍存在' : '✅ 已删除'));
  console.log('  书籍详情容器: ' + (report.removed.meta ? '❌ 仍存在' : '✅ 已删除'));
  console.log('  简介区域: ' + (report.removed.summary ? '❌ 仍存在' : '✅ 已删除'));
  console.log('  开始阅读按钮: ' + (report.removed.startBtn ? '❌ 仍存在' : '✅ 已删除'));
  console.log('  操作按钮组: ' + (report.removed.actions ? '❌ 仍存在' : '✅ 已删除'));

  console.log('\n📋 保留的元素（应全为 ✅）:');
  console.log('  章节列表区域: ' + (report.kept.chapterList ? '✅ 存在' : '❌ 不存在'));
  console.log('  章节目录标题: ' + (report.kept.heading ? '✅ 存在' : '❌ 不存在'));
  console.log('  章节列表 <ol>: ' + (report.kept.ol ? '✅ 存在' : '❌ 不存在'));
  console.log('  章节数量: ' + report.kept.chapters + ' 章');

  await page.screenshot({ path: 'verify-toc-clean.png', fullPage: true });
  console.log('\n📸 截图已保存: verify-toc-clean.png');

  const allCorrect =
    !report.removed.cover && !report.removed.meta && !report.removed.summary &&
    !report.removed.startBtn && !report.removed.actions &&
    report.kept.chapterList && report.kept.heading && report.kept.ol;

  console.log('\n' + '='.repeat(70));
  if (allCorrect) {
    console.log('✅ 验证通过！目录页只显示纯粹的章节列表。');
  } else {
    console.log('⚠️ 验证失败，请检查上面的详细信息。');
  }
  console.log('='.repeat(70) + '\n');

  await browser.close();
})();
