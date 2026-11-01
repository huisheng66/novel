const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  console.log('\n🔍 测试：输入时搜索框保持显示\n' + '='.repeat(70) + '\n');

  const token = fs.readFileSync('test-token.txt', 'utf8').trim();
  const browser = await puppeteer.launch({
    headless: false,  // 显示浏览器以便观察
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

  console.log('📖 测试目录页: http://localhost:3008/novel/1\n');
  await page.goto('http://localhost:3008/novel/1', { waitUntil: 'networkidle0' });
  await new Promise(resolve => setTimeout(resolve, 500));

  // 滚动到触发浮动搜索框
  console.log('1️⃣ 滚动到 400px，触发浮动搜索框');
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise(resolve => setTimeout(resolve, 600));

  let state1 = await page.evaluate(() => {
    const island = document.getElementById('chapter-search-island');
    return {
      visible: island ? island.classList.contains('is-visible') : false,
      opacity: island ? window.getComputedStyle(island).opacity : null
    };
  });
  console.log('   浮动搜索框: ' + (state1.visible ? '✅ 显示' : '❌ 隐藏') + ' (opacity=' + state1.opacity + ')');

  // 输入内容
  console.log('\n2️⃣ 在浮动搜索框输入"第1章"');
  await page.type('#floating-chapter-search', '第1章');
  await new Promise(resolve => setTimeout(resolve, 500));

  // 截图
  await page.screenshot({ path: 'test-input-typed.png', fullPage: false });
  console.log('   📸 截图已保存: test-input-typed.png');

  // 滚动回顶部
  console.log('\n3️⃣ 滚动回顶部（0px）');
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(resolve => setTimeout(resolve, 600));

  let state2 = await page.evaluate(() => {
    const island = document.getElementById('chapter-search-island');
    const input = document.getElementById('floating-chapter-search');
    return {
      visible: island ? island.classList.contains('is-visible') : false,
      opacity: island ? window.getComputedStyle(island).opacity : null,
      inputValue: input ? input.value : '',
      scrollY: window.scrollY
    };
  });

  console.log('   滚动位置: ' + state2.scrollY + 'px');
  console.log('   输入框内容: "' + state2.inputValue + '"');
  console.log('   浮动搜索框: ' + (state2.visible ? '✅ 保持显示' : '❌ 已隐藏') + ' (opacity=' + state2.opacity + ')');

  await page.screenshot({ path: 'test-input-top.png', fullPage: false });
  console.log('   📸 截图已保存: test-input-top.png');

  console.log('\n' + '='.repeat(70));
  if (state2.visible && state2.inputValue === '第1章') {
    console.log('✅ 测试通过！输入内容后搜索框保持显示。');
  } else {
    console.log('❌ 测试失败：');
    if (!state2.visible) console.log('   - 搜索框应该保持显示但隐藏了');
    if (state2.inputValue !== '第1章') console.log('   - 输入内容丢失');
  }
  console.log('='.repeat(70) + '\n');

  await new Promise(resolve => setTimeout(resolve, 2000));
  await browser.close();
})();
