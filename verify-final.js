const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('\n✅ 最终验证：目录页只有浮动搜索框\n' + '='.repeat(70) + '\n');

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

  console.log('📖 访问目录页: http://localhost:3008/novel/1\n');
  await page.goto('http://localhost:3008/novel/1', { waitUntil: 'networkidle0' });
  await new Promise(resolve => setTimeout(resolve, 500));

  // 检查元素
  const report = await page.evaluate(() => {
    return {
      // 正文区域的搜索框（应该被删除）
      mainSearch: {
        form: !!document.getElementById('chapter-search-form'),
        input: !!document.getElementById('chapter-search-input'),
        clear: !!document.getElementById('chapter-search-clear'),
        count: !!document.getElementById('chapter-search-count')
      },
      // 浮动搜索框（应该存在）
      floating: {
        island: !!document.getElementById('chapter-search-island'),
        input: !!document.getElementById('floating-chapter-search'),
        clear: !!document.getElementById('floating-chapter-clear'),
        count: !!document.getElementById('floating-chapter-count')
      }
    };
  });

  console.log('📊 元素检查结果:\n');
  console.log('正文区域搜索框（应全部不存在）:');
  console.log('  表单: ' + (report.mainSearch.form ? '❌ 存在' : '✅ 已删除'));
  console.log('  输入框: ' + (report.mainSearch.input ? '❌ 存在' : '✅ 已删除'));
  console.log('  清除按钮: ' + (report.mainSearch.clear ? '❌ 存在' : '✅ 已删除'));
  console.log('  计数显示: ' + (report.mainSearch.count ? '❌ 存在' : '✅ 已删除'));

  console.log('\n浮动搜索框（应全部存在）:');
  console.log('  容器: ' + (report.floating.island ? '✅ 存在' : '❌ 不存在'));
  console.log('  输入框: ' + (report.floating.input ? '✅ 存在' : '❌ 不存在'));
  console.log('  清除按钮: ' + (report.floating.clear ? '✅ 存在' : '❌ 不存在'));
  console.log('  计数显示: ' + (report.floating.count ? '✅ 存在' : '❌ 不存在'));

  // 截图：顶部状态
  console.log('\n📸 截图 1/2: 页面顶部（浮动搜索框隐藏）');
  await page.screenshot({ path: 'final-toc-top.png', fullPage: false });

  // 截图：滚动后
  console.log('📸 截图 2/2: 滚动 400px（浮动搜索框显示）');
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise(resolve => setTimeout(resolve, 600));
  await page.screenshot({ path: 'final-toc-floating.png', fullPage: false });

  const floatingVisible = await page.evaluate(() => {
    const island = document.getElementById('chapter-search-island');
    return {
      exists: !!island,
      visible: island ? island.classList.contains('is-visible') : false,
      opacity: island ? window.getComputedStyle(island).opacity : null
    };
  });

  console.log('\n浮动搜索框状态:');
  console.log('  存在: ' + (floatingVisible.exists ? '✅' : '❌'));
  console.log('  可见: ' + (floatingVisible.visible ? '✅' : '❌'));
  console.log('  透明度: ' + floatingVisible.opacity);

  const allCorrect =
    !report.mainSearch.form && !report.mainSearch.input &&
    report.floating.island && report.floating.input &&
    floatingVisible.visible;

  console.log('\n' + '='.repeat(70));
  if (allCorrect) {
    console.log('✅ 所有检查通过！目录页只保留浮动搜索框。');
  } else {
    console.log('⚠️ 存在问题，请检查上面的详细信息。');
  }
  console.log('='.repeat(70) + '\n');

  await browser.close();
})();
