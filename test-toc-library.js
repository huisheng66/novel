const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('\n📚 目录页和书库页 - 浮动搜索框测试\n' + '='.repeat(70) + '\n');

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

  // 测试 1: 书库页
  console.log('🏠 测试书库页 (http://localhost:3008/)\n');
  await page.goto('http://localhost:3008/', { waitUntil: 'networkidle0' });
  await new Promise(resolve => setTimeout(resolve, 500));

  // 初始状态
  console.log('📸 截图 1/6: 书库页顶部');
  await page.screenshot({ path: 'test-library-1-top.png', fullPage: false });

  // 滚动触发浮动搜索框
  console.log('📸 截图 2/6: 书库页滚动 400px（浮动搜索框出现）');
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise(resolve => setTimeout(resolve, 600));
  await page.screenshot({ path: 'test-library-2-floating.png', fullPage: false });

  // 检查元素
  const libraryReport = await page.evaluate(() => {
    const island = document.getElementById('library-search-island');
    const backBtn = document.getElementById('back-to-top');
    return {
      scrollY: window.scrollY,
      island: {
        exists: !!island,
        visible: island ? island.classList.contains('is-visible') : false,
        opacity: island ? window.getComputedStyle(island).opacity : null
      },
      backBtn: {
        exists: !!backBtn,
        visible: backBtn ? backBtn.classList.contains('is-visible') : false
      }
    };
  });

  console.log('\n📊 书库页元素状态:');
  console.log('  浮动搜索框: 存在=' + (libraryReport.island.exists ? '✅' : '❌') +
              ', 可见=' + (libraryReport.island.visible ? '✅' : '❌') +
              ', opacity=' + libraryReport.island.opacity);
  console.log('  返回顶部: 存在=' + (libraryReport.backBtn.exists ? '✅' : '❌') +
              ', 可见=' + (libraryReport.backBtn.visible ? '✅' : '❌'));

  // 滚动到 600px 显示返回顶部按钮
  console.log('\n📸 截图 3/6: 书库页滚动 600px（返回顶部也出现）');
  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.screenshot({ path: 'test-library-3-both.png', fullPage: false });

  // 测试 2: 目录页
  console.log('\n📖 测试目录页 (http://localhost:3008/novel/1)\n');
  await page.goto('http://localhost:3008/novel/1', { waitUntil: 'networkidle0' });
  await new Promise(resolve => setTimeout(resolve, 500));

  // 初始状态
  console.log('📸 截图 4/6: 目录页顶部');
  await page.screenshot({ path: 'test-toc-1-top.png', fullPage: false });

  // 滚动触发
  console.log('📸 截图 5/6: 目录页滚动 400px（浮动搜索框出现）');
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise(resolve => setTimeout(resolve, 600));
  await page.screenshot({ path: 'test-toc-2-floating.png', fullPage: false });

  const tocReport = await page.evaluate(() => {
    const island = document.getElementById('chapter-search-island');
    const backBtn = document.getElementById('back-to-top');
    return {
      scrollY: window.scrollY,
      island: {
        exists: !!island,
        visible: island ? island.classList.contains('is-visible') : false,
        opacity: island ? window.getComputedStyle(island).opacity : null
      },
      backBtn: {
        exists: !!backBtn,
        visible: backBtn ? backBtn.classList.contains('is-visible') : false
      }
    };
  });

  console.log('\n📊 目录页元素状态:');
  console.log('  浮动搜索框: 存在=' + (tocReport.island.exists ? '✅' : '❌') +
              ', 可见=' + (tocReport.island.visible ? '✅' : '❌') +
              ', opacity=' + tocReport.island.opacity);
  console.log('  返回顶部: 存在=' + (tocReport.backBtn.exists ? '✅' : '❌') +
              ', 可见=' + (tocReport.backBtn.visible ? '✅' : '❌'));

  // 滚动到 600px
  console.log('\n📸 截图 6/6: 目录页滚动 600px（两个元素都显示）');
  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.screenshot({ path: 'test-toc-3-both.png', fullPage: false });

  console.log('\n✅ 所有测试完成！');
  console.log('\n📁 生成的截图:');
  console.log('   书库页:');
  console.log('   - test-library-1-top.png');
  console.log('   - test-library-2-floating.png');
  console.log('   - test-library-3-both.png');
  console.log('   目录页:');
  console.log('   - test-toc-1-top.png');
  console.log('   - test-toc-2-floating.png');
  console.log('   - test-toc-3-both.png\n');

  await browser.close();
})();
