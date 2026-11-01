// 验证悬浮 UI 元素是否正确添加
const fs = require('fs');
const path = require('path');

console.log('🔍 验证悬浮搜索框和返回顶部按钮...\n');

// 1. 检查 chapter.ejs
const chapterEjs = fs.readFileSync(path.join(__dirname, 'views', 'chapter.ejs'), 'utf8');

const checks = [
  {
    name: '章节页 - 悬浮搜索框 HTML',
    file: 'views/chapter.ejs',
    pattern: /class="chapter-search-island"/,
    exists: /class="chapter-search-island"/.test(chapterEjs)
  },
  {
    name: '章节页 - 返回顶部按钮 HTML',
    file: 'views/chapter.ejs',
    pattern: /class="back-to-top"/,
    exists: /class="back-to-top"/.test(chapterEjs)
  },
  {
    name: '章节页 - 搜索框 JavaScript',
    file: 'views/chapter.ejs',
    pattern: /getElementById\('chapter-search-island'\)/,
    exists: /getElementById\('chapter-search-island'\)/.test(chapterEjs)
  },
  {
    name: '章节页 - 返回顶部 JavaScript',
    file: 'views/chapter.ejs',
    pattern: /getElementById\('back-to-top'\)/,
    exists: /getElementById\('back-to-top'\)/.test(chapterEjs)
  },
  {
    name: '章节页 - 滚动监听',
    file: 'views/chapter.ejs',
    pattern: /addEventListener\('scroll', handleScroll/,
    exists: /addEventListener\('scroll', handleScroll/.test(chapterEjs)
  }
];

// 2. 检查 novel.ejs
const novelEjs = fs.readFileSync(path.join(__dirname, 'views', 'novel.ejs'), 'utf8');
checks.push({
  name: '目录页 - sessionStorage 接收逻辑',
  file: 'views/novel.ejs',
  pattern: /sessionStorage\.getItem\('chapter-search-query'\)/,
  exists: /sessionStorage\.getItem\('chapter-search-query'\)/.test(novelEjs)
});

// 3. 检查 main.css
const mainCss = fs.readFileSync(path.join(__dirname, 'public', 'css', 'main.css'), 'utf8');
checks.push(
  {
    name: 'CSS - 悬浮搜索框基础样式',
    file: 'public/css/main.css',
    pattern: /\.chapter-search-island \{/,
    exists: /\.chapter-search-island \{/.test(mainCss)
  },
  {
    name: 'CSS - 返回顶部按钮基础样式',
    file: 'public/css/main.css',
    pattern: /\.back-to-top \{/,
    exists: /\.back-to-top \{/.test(mainCss)
  },
  {
    name: 'CSS - 深色主题搜索框',
    file: 'public/css/main.css',
    pattern: /html\[data-reader-theme="dark"\] \.chapter-search-island/,
    exists: /html\[data-reader-theme="dark"\] \.chapter-search-island/.test(mainCss)
  },
  {
    name: 'CSS - 深色主题返回顶部',
    file: 'public/css/main.css',
    pattern: /html\[data-reader-theme="dark"\] \.back-to-top/,
    exists: /html\[data-reader-theme="dark"\] \.back-to-top/.test(mainCss)
  }
);

// 输出结果
let allPassed = true;
checks.forEach((check, i) => {
  const status = check.exists ? '✅' : '❌';
  console.log(`${i + 1}. ${status} ${check.name}`);
  if (!check.exists) {
    console.log(`   文件: ${check.file}`);
    console.log(`   缺失: ${check.pattern}\n`);
    allPassed = false;
  }
});

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✅ 所有检查通过！悬浮 UI 元素已正确添加。');
  console.log('\n💡 如果浏览器看不到变化，请尝试：');
  console.log('   1. 硬刷新浏览器：Ctrl+Shift+R (Win) 或 Cmd+Shift+R (Mac)');
  console.log('   2. 清除浏览器缓存');
  console.log('   3. 重启 Node 服务器');
  console.log('   4. 访问章节页并滚动超过 300px');
} else {
  console.log('❌ 部分检查失败，请检查上述缺失的元素。');
}
console.log('='.repeat(60));

process.exit(allPassed ? 0 : 1);
