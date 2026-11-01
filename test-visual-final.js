const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('\n🎬 视觉验证测试 - 生成最终演示截图\n' + '='.repeat(70) + '\n');

  // 读取令牌
  const token = fs.readFileSync('test-token.txt', 'utf8').trim();
  console.log('✅ JWT 令牌已加载\n');

  // 启动浏览器
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // 设置 JWT Cookie
  await page.setCookie({
    name: 'cn_jwt',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    secure: false
  });

  console.log('🌐 访问章节页面: http://localhost:3008/novel/1/1\n');
  await page.goto('http://localhost:3008/novel/1/1', { waitUntil: 'networkidle0' });

  // 等待页面完全渲染
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 截图 1: 初始状态（顶部）
  console.log('📸 截图 1/5: 页面顶部（浮动元素隐藏）');
  await page.screenshot({ path: 'demo-1-top.png', fullPage: false });

  // 滚动到 400px
  console.log('📸 截图 2/5: 滚动到 400px（搜索框出现）');
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.screenshot({ path: 'demo-2-search-visible.png', fullPage: false });

  // 滚动到 600px
  console.log('📸 截图 3/5: 滚动到 600px（返回顶部按钮也出现）');
  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.screenshot({ path: 'demo-3-both-visible.png', fullPage: false });

  // 点击搜索框并输入
  console.log('📸 截图 4/5: 搜索框获得焦点');
  await page.click('#chapter-search-input');
  await new Promise(resolve => setTimeout(resolve, 300));
  await page.screenshot({ path: 'demo-4-search-focus.png', fullPage: false });

  // 滚动到底部
  console.log('📸 截图 5/5: 滚动到页面底部');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.screenshot({ path: 'demo-5-bottom.png', fullPage: false });

  // 生成元素状态报告
  const report = await page.evaluate(() => {
    const searchIsland = document.getElementById('chapter-search-island');
    const backToTop = document.getElementById('back-to-top');
    const searchInput = document.getElementById('chapter-search-input');

    return {
      scrollY: window.scrollY,
      searchIsland: {
        exists: !!searchIsland,
        visible: searchIsland ? window.getComputedStyle(searchIsland).opacity !== '0' : false,
        hasClass: searchIsland ? searchIsland.classList.contains('is-visible') : false,
        transform: searchIsland ? window.getComputedStyle(searchIsland).transform : null
      },
      backToTop: {
        exists: !!backToTop,
        visible: backToTop ? window.getComputedStyle(backToTop).opacity !== '0' : false,
        hasClass: backToTop ? backToTop.classList.contains('is-visible') : false
      },
      searchInput: {
        exists: !!searchInput,
        value: searchInput ? searchInput.value : null
      }
    };
  });

  console.log('\n📊 元素状态报告:\n');
  console.log('滚动位置:', report.scrollY + 'px');
  console.log('\n搜索框:');
  console.log('  - 存在:', report.searchIsland.exists ? '✅' : '❌');
  console.log('  - 可见:', report.searchIsland.visible ? '✅' : '❌');
  console.log('  - CSS类:', report.searchIsland.hasClass ? 'is-visible ✅' : '无');
  console.log('  - Transform:', report.searchIsland.transform);
  console.log('\n返回顶部:');
  console.log('  - 存在:', report.backToTop.exists ? '✅' : '❌');
  console.log('  - 可见:', report.backToTop.visible ? '✅' : '❌');
  console.log('  - CSS类:', report.backToTop.hasClass ? 'is-visible ✅' : '无');

  console.log('\n✅ 所有截图已保存:');
  console.log('   - demo-1-top.png (初始状态)');
  console.log('   - demo-2-search-visible.png (搜索框显示)');
  console.log('   - demo-3-both-visible.png (两个元素都显示)');
  console.log('   - demo-4-search-focus.png (搜索框聚焦)');
  console.log('   - demo-5-bottom.png (页面底部)');

  await browser.close();
  console.log('\n🎉 视觉验证完成！\n');
})();
