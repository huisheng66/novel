#!/usr/bin/env node
/**
 * 浮动 UI 元素自动化浏览器测试
 * 使用 Puppeteer 验证搜索框和返回顶部按钮的功能
 */

const http = require('http');
const fs = require('fs');

console.log('\n浮动 UI 元素自动化测试');
console.log('='.repeat(70));

// 检查服务器
function checkServer() {
  return new Promise((resolve, reject) => {
    const req = http.get('http://localhost:3008/healthz', (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('连接超时'));
    });
  });
}

async function main() {
  console.log('\n1️⃣ 检查服务器...');
  try {
    await checkServer();
    console.log('   ✅ 服务器运行中');
  } catch (err) {
    console.error('   ❌ 服务器未运行:', err.message);
    console.log('\n💡 请先启动: node server.js\n');
    process.exit(1);
  }

  console.log('\n2️⃣ 检查 Puppeteer...');
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
    console.log('   ✅ Puppeteer 已安装');
  } catch (err) {
    console.error('   ❌ Puppeteer 未安装，正在安装...\n');
    const { execSync } = require('child_process');
    try {
      execSync('npm install --save-dev puppeteer', { stdio: 'inherit', cwd: __dirname });
      puppeteer = require('puppeteer');
      console.log('\n   ✅ 安装成功');
    } catch (installErr) {
      console.error('\n   ❌ 安装失败:', installErr.message);
      process.exit(1);
    }
  }

  console.log('\n3️⃣ 读取测试令牌...');
  let token;
  try {
    token = fs.readFileSync('test-token.txt', 'utf8').trim();
    console.log('   ✅ 令牌已加载');
  } catch (err) {
    console.error('   ❌ 无法读取 test-token.txt');
    console.log('\n💡 请先运行: node generate-test-token.js\n');
    process.exit(1);
  }

  console.log('\n4️⃣ 启动浏览器...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 800 }
  });

  const page = await browser.newPage();
  console.log('   ✅ 浏览器已启动');

  // 设置 JWT Cookie（cn_jwt）
  await page.setCookie({
    name: 'cn_jwt',
    value: token,
    domain: 'localhost',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax'
  });
  console.log('   ✅ JWT Cookie 已设置');

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('   ⚠️  浏览器错误:', msg.text());
    }
  });

  console.log('\n5️⃣ 访问章节页...');
  const testUrl = 'http://localhost:3008/novel/1/1';

  try {
    await page.goto(testUrl, { waitUntil: 'networkidle0', timeout: 15000 });
    console.log(`   ✅ 页面加载完成`);
  } catch (err) {
    console.error('   ❌ 页面加载失败:', err.message);
    await browser.close();
    process.exit(1);
  }

  // 保存页面截图以供调试
  await page.screenshot({ path: 'test-screenshot-initial.png', fullPage: false });
  console.log('   ✅ 初始截图已保存: test-screenshot-initial.png');

  console.log('\n6️⃣ 检查元素是否存在...');
  const searchIsland = await page.$('#chapter-search-island');
  const backToTop = await page.$('#back-to-top');

  console.log(`   搜索框: ${searchIsland ? '✅ 存在' : '❌ 不存在'}`);
  console.log(`   返回按钮: ${backToTop ? '✅ 存在' : '❌ 不存在'}`);

  if (!searchIsland || !backToTop) {
    console.log('\n   ❌ 元素缺失！可能原因：');
    console.log('      1. views/chapter.ejs 未包含浮动 UI 代码');
    console.log('      2. 服务器缓存了旧模板（需要重启）');
    console.log('      3. EJS 渲染条件未满足');

    // 检查页面 HTML
    const html = await page.content();
    const hasSearchCode = html.includes('chapter-search-island');
    const hasBackCode = html.includes('back-to-top');
    console.log(`\n   页面源码检查:`);
    console.log(`      - 包含 'chapter-search-island': ${hasSearchCode ? '是' : '否'}`);
    console.log(`      - 包含 'back-to-top': ${hasBackCode ? '是' : '否'}`);

    await browser.close();
    process.exit(1);
  }

  console.log('\n7️⃣ 测试滚动触发...');

  // 初始状态（页面顶部）
  let isVisible = await page.$eval('#chapter-search-island', el => {
    return el.classList.contains('is-visible');
  });
  console.log(`   页面顶部，搜索框可见: ${isVisible ? '是' : '否'} ${!isVisible ? '✅' : '❌ 应该隐藏'}`);

  // 滚动到 400px
  await page.evaluate(() => window.scrollTo(0, 400));
  await new Promise(resolve => setTimeout(resolve, 500)); // 等待动画完成

  isVisible = await page.$eval('#chapter-search-island', el => {
    return el.classList.contains('is-visible');
  });
  console.log(`   滚动到 400px，搜索框可见: ${isVisible ? '是 ✅' : '否 ❌ 应该显示'}`);

  await page.screenshot({ path: 'test-screenshot-scrolled.png', fullPage: false });
  console.log('   ✅ 滚动截图已保存: test-screenshot-scrolled.png');

  // 测试返回顶部按钮
  const backVisible = await page.$eval('#back-to-top', el => {
    return el.classList.contains('is-visible');
  });
  console.log(`   滚动到 400px，返回按钮可见: ${backVisible ? '否' : '是'} ${!backVisible ? '✅' : '❌ 应该等到 500px'}`);

  // 滚动到 600px
  await page.evaluate(() => window.scrollTo(0, 600));
  await new Promise(resolve => setTimeout(resolve, 500));

  const backVisibleNow = await page.$eval('#back-to-top', el => {
    return el.classList.contains('is-visible');
  });
  console.log(`   滚动到 600px，返回按钮可见: ${backVisibleNow ? '是 ✅' : '否 ❌ 应该显示'}`);

  console.log('\n8️⃣ 测试搜索功能...');

  // 点击搜索框
  await page.click('#chapter-search-input');
  await page.type('#chapter-search-input', '测试');
  await new Promise(resolve => setTimeout(resolve, 300));

  const inputValue = await page.$eval('#chapter-search-input', el => el.value);
  console.log(`   输入文本: "${inputValue}" ${inputValue === '测试' ? '✅' : '❌'}`);

  // 点击清除按钮
  await page.click('#chapter-search-clear');
  await new Promise(resolve => setTimeout(resolve, 200));

  const cleared = await page.$eval('#chapter-search-input', el => el.value);
  console.log(`   清除后: "${cleared}" ${cleared === '' ? '✅' : '❌'}`);

  console.log('\n9️⃣ 测试返回顶部功能...');

  // 点击返回顶部按钮
  await page.click('#back-to-top');
  await new Promise(resolve => setTimeout(resolve, 600)); // 等待滚动动画

  const scrollY = await page.evaluate(() => window.scrollY);
  console.log(`   当前滚动位置: ${scrollY}px ${scrollY < 50 ? '✅ 已返回顶部' : '❌ 未返回顶部'}`);

  await page.screenshot({ path: 'test-screenshot-final.png', fullPage: false });
  console.log('   ✅ 最终截图已保存: test-screenshot-final.png');

  console.log('\n✅ 所有测试完成！');
  console.log('\n💡 检查截图文件：');
  console.log('   - test-screenshot-initial.png  (初始状态)');
  console.log('   - test-screenshot-scrolled.png (滚动后)');
  console.log('   - test-screenshot-final.png    (返回顶部后)');

  await browser.close();
}

main().catch(err => {
  console.error('\n❌ 测试失败:', err);
  process.exit(1);
});
